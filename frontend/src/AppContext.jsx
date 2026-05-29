import { createContext, useCallback, useContext, useState } from 'react';
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

  // LLM picker (was previously bound to topbar inputs via getLLMConfig())
  const [llmProvider, setLlmProvider] = useState('ollama');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');

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

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
