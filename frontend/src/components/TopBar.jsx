import { Link, useLocation } from 'react-router-dom';
import { PAGE_TITLES } from '../api.js';
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

  const modelPlaceholder =
    llmProvider === 'openai' ? 'gpt-4o-mini'
    : llmProvider === 'anthropic' ? 'claude-haiku-4-5-20251001'
    : 'llama3.2';

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
        <input
          type="text"
          value={llmModel}
          onChange={e => setLlmModel(e.target.value)}
          placeholder={modelPlaceholder}
          style={{ width: 100 }}
        />
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
