import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { API, PAGE_TITLES } from '../api.js';
import { useApp } from '../AppContext.jsx';
import BackButton from './BackButton.jsx';

// Topbar: back button + breadcrumb + LLM picker (provider/model/API key).
// LLM config lives in AppContext so any page can read it via
// useApp().getLLMConfig().
export default function TopBar() {
  const location = useLocation();
  // "/profile/sales_data" -> ["profile", "sales_data"]
  const [pageKey = 'dashboard', detail] = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const title = PAGE_TITLES[pageKey] || 'Page not found';
  const isHome = pageKey === 'dashboard';

  const { llmProvider, setLlmProvider, llmModel, setLlmModel, llmApiKey, setLlmApiKey } = useApp();

  // Installed Ollama models for the picker: {available, default, models, error}.
  const [ollama, setOllama] = useState(null);
  useEffect(() => {
    if (llmProvider !== 'ollama') return;
    let cancelled = false;
    fetch(`${API}/llm/models`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setOllama(d); })
      .catch(() => { if (!cancelled) setOllama({ available: false, models: [] }); });
    return () => { cancelled = true; };
  }, [llmProvider]);

  const modelPlaceholder =
    llmProvider === 'openai' ? 'gpt-4o-mini'
    : llmProvider === 'anthropic' ? 'claude-haiku-4-5-20251001'
    : 'qwen2.5-coder:7b';
  const showPicker = llmProvider === 'ollama' && ollama?.available && ollama.models.some(m => m.installed);

  return (
    <div className="topbar">
      {!isHome && <BackButton />}
      <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
        {detail ? (
          <>
            <Link to={`/${pageKey}`} className="topbar-crumb">{title}</Link>
            <span aria-hidden="true">/</span>
            <span className="topbar-title">{detail}</span>
          </>
        ) : (
          <span className="topbar-title">{title}</span>
        )}
      </nav>
      <div className="spacer"></div>
      <div className="llm-config">
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>LLM:</span>
        <select
          title="llm-selection"
          value={llmProvider}
          onChange={e => setLlmProvider(e.target.value)}
        >
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
        {showPicker ? (
          <ModelPicker models={ollama.models} value={llmModel || ollama.default} onChange={setLlmModel} />
        ) : llmProvider === 'ollama' && ollama === null ? (
          // Asking Ollama which models are installed; same control, so the bar doesn't jump.
          <select title="Local model" disabled style={{ maxWidth: 320 }}>
            <option>Loading models…</option>
          </select>
        ) : (
          <input
            type="text"
            value={llmModel}
            onChange={e => setLlmModel(e.target.value)}
            placeholder={modelPlaceholder}
            title={llmProvider === 'ollama' && ollama?.error ? ollama.error : 'Model name'}
            style={{ width: 130 }}
          />
        )}
        {llmProvider !== 'ollama' && (
          <input
            type="password"
            value={llmApiKey}
            onChange={e => setLlmApiKey(e.target.value)}
            placeholder="API key"
            style={{ width: 110 }}
          />
        )}
      </div>
    </div>
  );
}

// Ollama models: installed ones are selectable; known-but-missing ones are
// listed disabled with the command that installs them.
function ModelPicker({ models, value, onChange }) {
  const known = models.some(m => m.name === value);
  return (
    <select title="Local model" value={value} onChange={e => onChange(e.target.value)} style={{ maxWidth: 320 }}>
      {!known && <option value={value}>{value}</option>}
      {models.map(m => (
        <option key={m.name} value={m.name} disabled={!m.installed}>
          {m.name}
          {m.installed && m.parameters ? ` · ${m.parameters}` : ''}
          {m.tag ? ` · ${m.tag}` : ''}
          {!m.installed ? ` · not installed (${m.pull})` : ''}
        </option>
      ))}
    </select>
  );
}
