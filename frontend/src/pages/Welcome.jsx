import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SOURCE_KINDS, ORBIT_KINDS, OUTPUTS } from '../welcome/sources.js';
import PrismFallback from '../welcome/PrismFallback.jsx';

// Welcome page at "/". A full-screen scene (lazy-loaded three.js) tells the
// product's story — data sources converge into the prism, a spectrum leaves
// it as chart / table / map — with real DOM text and controls layered on top.
// The orbiting objects are the source types Prism supports.

const SEEN_KEY = 'prism:welcome-seen';
// Keep in sync with the wide-layout media query in css/pages/welcome.css.
const WIDE_QUERY = '(min-width: 900px) and (min-aspect-ratio: 5/4), (max-height: 520px) and (min-aspect-ratio: 5/4)';

const ORBIT = ORBIT_KINDS.map(kind => ({ kind, ...SOURCE_KINDS[kind] }));

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode etc. */ }
}

// 'high' | 'low' | 'none'. three.js r163+ needs WebGL2. Cached so the probe
// context is only created once per page load.
let cachedTier = null;
function detectTier() {
  if (!cachedTier) cachedTier = probeTier();
  return cachedTier;
}
function probeTier() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'none';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'none';
  }
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  if (mem <= 2 && cores <= 2) return 'none';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (mem <= 4 || cores <= 4 || coarse) return 'low';
  return 'high';
}

export default function Welcome() {
  const navigate = useNavigate();

  const [returning] = useState(readSeen);
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [mode, setMode] = useState(() => (detectTier() === 'none' ? 'fallback' : 'webgl'));
  const [revealed, setRevealed] = useState(false);

  const canvasRef = useRef(null);
  const copyRef = useRef(null);
  const sceneRef = useRef(null);
  const skipRequested = useRef(false);   // a skip pressed before the scene finished loading
  const labelRefs = useRef([]);
  const outputRefs = useRef([]);

  const reveal = useCallback(() => {
    setRevealed(true);
    markSeen();
  }, []);

  // Write projected label positions straight to the DOM — no React render per frame.
  const onProject = useCallback(({ items, outputs }) => {
    items.forEach((p, i) => place(labelRefs.current[i], p));
    outputs.forEach((p, i) => place(outputRefs.current[i], p));
  }, []);

  // ── mount the 3D scene ────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'webgl' || !canvasRef.current) return;
    let disposed = false;
    let handle = null;
    const tier = detectTier();

    import('../welcome/prismScene.js')
      .then(({ createPrismScene }) => {
        if (disposed) return;
        handle = createPrismScene(canvasRef.current, {
          items: ORBIT.map(k => ({ shape: k.shape, color: k.color, size: 1 })),
          outputs: OUTPUTS,
          returning,
          reducedMotion,
          tier: tier === 'high' ? 'high' : 'low',
          wideQuery: window.matchMedia(WIDE_QUERY),
          safeLeft: () => copyRef.current?.getBoundingClientRect().right ?? 0,
          onReveal: reveal,
          onProject,
          onLost: () => setMode('fallback'),
        });
        sceneRef.current = handle;
        if (skipRequested.current) handle.skip();
      })
      .catch(() => { if (!disposed) setMode('fallback'); });

    return () => {
      disposed = true;
      handle?.dispose();
      sceneRef.current = null;
    };
  }, [mode, returning, reducedMotion, reveal, onProject]);

  // Fallback has no intro to wait for.
  useEffect(() => {
    if (mode === 'fallback') reveal();
  }, [mode, reveal]);

  const skip = useCallback(() => {
    skipRequested.current = true;
    sceneRef.current?.skip();
  }, []);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') skip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skip]);

  const highlight = i => sceneRef.current?.setHighlight(i);

  return (
    <div className={`welcome${revealed ? ' is-revealed' : ''}${mode === 'fallback' ? ' is-fallback' : ''}`}>
      {mode === 'webgl' && (
        <canvas
          ref={canvasRef}
          className="welcome-canvas"
          aria-hidden="true"
          onClick={() => { if (!revealed) skip(); }}
        />
      )}
      {mode === 'fallback' && <PrismFallback items={ORBIT} />}
      <div className="welcome-vignette" aria-hidden="true" />

      <header className="welcome-top">
        <div className="welcome-brand">
          <div className="logo-mark">P</div>
          <div className="logo-text">Pri<span>sm</span></div>
        </div>
        {!revealed && mode === 'webgl' && (
          <button type="button" className="welcome-skip" onClick={skip}>
            Skip intro <kbd>Esc</kbd>
          </button>
        )}
      </header>

      <main ref={copyRef} className="welcome-copy" onFocusCapture={() => { if (!revealed) skip(); }}>
        <p className="welcome-eyebrow">AI data workspace</p>
        <h1 className="welcome-title">
          Every source, <span className="welcome-accent">brought into focus.</span>
        </h1>
        <p className="welcome-lede">
          Load your dataset. Link a database — ask a question in English and Prism handles the rest.
        </p>
        <div className="welcome-actions">
          <Link to="/dashboard" className="welcome-primary">Open workspace →</Link>
        </div>

        {mode === 'fallback' && (
          <ul className="welcome-sources-static" aria-label="Supported sources">
            {ORBIT.map(k => (
              <li key={k.kind}>
                <span className="welcome-dot" style={{ background: k.color }} />
                {k.label}
              </li>
            ))}
          </ul>
        )}
      </main>

      {mode === 'webgl' && (
        <>
          <ul className="welcome-labels" aria-label="Supported sources">
            {ORBIT.map((k, i) => (
              <li key={k.kind} ref={el => { labelRefs.current[i] = el; }} className="welcome-label" data-visible="0">
                <button
                  type="button"
                  onClick={() => navigate(k.to)}
                  onMouseEnter={() => highlight(i)}
                  onMouseLeave={() => highlight(-1)}
                  onFocus={() => highlight(i)}
                  onBlur={() => highlight(-1)}
                  style={{ '--c': k.color }}
                >
                  <span className="welcome-label-name">{k.label}</span>
                  <span className="welcome-label-meta">{k.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="welcome-outputs" aria-hidden="true">
            {OUTPUTS.map((o, i) => (
              <span
                key={o.key}
                ref={el => { outputRefs.current[i] = el; }}
                className="welcome-output"
                data-visible="0"
                style={{ '--c': o.color }}
              >
                <span>{o.label}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function place(el, p) {
  if (!el) return;
  el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
  const vis = p.visible ? '1' : '0';
  if (el.dataset.visible !== vis) el.dataset.visible = vis;
  if (p.front !== undefined) {
    const front = p.front ? '1' : '0';
    if (el.dataset.front !== front) el.dataset.front = front;
  }
}
