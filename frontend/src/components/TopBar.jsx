import { useLocation } from 'react-router-dom';
import { PAGE_TITLES } from '../api.js';
import { useApp } from '../AppContext.jsx';

// Topbar: page title + LLM picker (provider/model/API key). Replaces the old
// llm.js helpers — LLM config now lives in AppContext so any page can read it
// via useApp().getLLMConfig().
export default function TopBar() {
  const location = useLocation();
  const pageKey = location.pathname.replace('/', '') || 'dashboard';
  const title = PAGE_TITLES[pageKey] || 'Prism';

  const { llmProvider, setLlmProvider, llmModel, setLlmModel, llmApiKey, setLlmApiKey } = useApp();

  const modelPlaceholder =
    llmProvider === 'openai' ? 'gpt-4o-mini'
    : llmProvider === 'anthropic' ? 'claude-haiku-4-5-20251001'
    : 'llama3.2';

  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
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
