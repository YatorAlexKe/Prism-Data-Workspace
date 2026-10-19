import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { API } from './api.js';

// Replaces the vanilla globals from frontend/js/state.js. One context so any
// page can read/mutate shared state (selected tables, datasets list, last
// query result/SQL, chart suggestion, LLM config) without prop drilling.
const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Shared workspace state
  const [allDatasets, setAllDatasets] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [currentTable, setCurrentTable] = useState(null);
  const [currentResult, setCurrentResult] = useState(null);
  const [currentSQL, setCurrentSQL] = useState('');
  const [chartSuggestion, setChartSuggestion] = useState(null);
  const [historyCount, setHistoryCount] = useState(0);

  // LLM picker (topbar). Provider and model are remembered between visits;
  // the API key deliberately is not. An empty model means "server default".
  const [llmProvider, setLlmProvider] = useState(() => readPref('prism:llm-provider', 'ollama'));
  const [llmModel, setLlmModel] = useState(() => readPref('prism:llm-model', ''));
  const [llmApiKey, setLlmApiKey] = useState('');

  useEffect(() => { writePref('prism:llm-provider', llmProvider); }, [llmProvider]);
  useEffect(() => { writePref('prism:llm-model', llmModel); }, [llmModel]);

  const getLLMConfig = useCallback(() => ({
    provider: llmProvider,
    model: llmModel.trim() || null,
    api_key: llmApiKey.trim() || null,
  }), [llmProvider, llmModel, llmApiKey]);

  // Re-fetch /datasets and update sidebar + dashboard counts. Equivalent of
  // the old refreshDatasets() helper.
  const refreshDatasets = useCallback(async () => {
    try {
      const res = await fetch(`${API}/datasets`);
      const data = await res.json();
      setAllDatasets(data.datasets || []);
    } catch (e) {
      // swallow — old code also failed silently to avoid breaking UI on
      // transient backend failures
    }
  }, []);

  const loadHistoryCount = useCallback(async () => {
    try {
      const res = await fetch(`${API}/query/history`);
      const data = await res.json();
      setHistoryCount((data.history || []).length);
    } catch (e) { }
  }, []);

  const value = {
    allDatasets, setAllDatasets,
    selectedTables, setSelectedTables,
    currentTable, setCurrentTable,
    currentResult, setCurrentResult,
    currentSQL, setCurrentSQL,
    chartSuggestion, setChartSuggestion,
    historyCount, setHistoryCount,
    llmProvider, setLlmProvider,
    llmModel, setLlmModel,
    llmApiKey, setLlmApiKey,
    getLLMConfig,
    refreshDatasets,
    loadHistoryCount,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: preference just isn't kept */ }
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
