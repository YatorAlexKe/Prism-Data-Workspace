import { SOURCE_KINDS } from './sources.js';

// Still composition of the welcome scene, used when WebGL is unavailable, the
// device looks too weak, or the GL context is lost. Same story as the 3D
// version: coloured sources converge into the prism, a spectrum leaves it.
const SPECTRUM = ['#f87171', '#fb923c', '#fbbf24', '#4ade80', '#60a5fa', '#a78bfa'];

export default function PrismFallback({ items }) {
  const cx = 300, cy = 250;
  const n = items.length || 1;
  const sources = items.map((it, i) => {
    const a = (i / n) * Math.PI * 2 + 0.4;
    return {
      x: cx + Math.cos(a) * 230,
      y: cy + Math.sin(a) * 70 - 10,
      color: SOURCE_KINDS[it.kind].color,
    };
  });

  return (
    <svg className="welcome-fallback" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <radialGradient id="pf-halo">
          <stop offset="0" stopColor="#5b5fd6" stopOpacity="0.35" />
          <stop offset="1" stopColor="#5b5fd6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="pf-core">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pf-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c7d2fe" stopOpacity="0.16" />
          <stop offset="1" stopColor="#1c2030" stopOpacity="0.5" />
        </linearGradient>
        {SPECTRUM.map((c, k) => (
          <linearGradient key={c} id={`pf-band-${k}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={c} stopOpacity="0.75" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      <circle cx={cx} cy={cy} r="220" fill="url(#pf-halo)" />

      {SPECTRUM.map((c, k) => {
        const y0 = cy - 6 + k * 2;
        const top = cy - 130 + k * 40, bottom = top + 40;
        return <polygon key={c} points={`${cx + 30},${y0} 790,${top} 790,${bottom}`} fill={`url(#pf-band-${k})`} />;
      })}

      {sources.map((s, i) => (
        <g key={i}>
          <path
            d={`M${s.x},${s.y} Q${(s.x + cx) / 2},${(s.y + cy) / 2 - 30} ${cx},${cy}`}
            fill="none" stroke={s.color} strokeOpacity="0.4" strokeWidth="1"
          />
          <circle cx={s.x} cy={s.y} r="6" fill={s.color} />
          <circle cx={s.x} cy={s.y} r="14" fill={s.color} opacity="0.15" />
        </g>
      ))}

      <polygon
        points={`${cx},${cy - 110} ${cx + 95},${cy + 55} ${cx - 95},${cy + 55}`}
        fill="url(#pf-glass)" stroke="#e6ecff" strokeOpacity="0.7" strokeWidth="1.5" strokeLinejoin="round"
      />
      <circle cx={cx} cy={cy} r="48" fill="url(#pf-core)" />
    </svg>
  );
}
