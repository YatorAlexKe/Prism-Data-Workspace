import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';

// Query history page. Clicking a row replays the question on the Query page;
// "Clear All" wipes the server history.
export default function History() {
  const navigate = useNavigate();
  const { setSelectedTables, setCurrentTable, loadHistoryCount } = useApp();
  const [items, setItems] = useState([]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API}/query/history`);
      const data = await res.json();
      setItems(data.history || []);
    } catch (e) { }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const replayQuery = (question, tableName) => {
    if (tableName) {
      setSelectedTables([tableName]);
      setCurrentTable(tableName);
    }
    sessionStorage.setItem('prism:replay-question', question || '');
    navigate('/query');
  };

  const clearAll = async () => {
    await fetch(`${API}/query/history`, { method: 'DELETE' });
    reload();
    loadHistoryCount();
  };

  return (
    <div className="page active">
      <div className="history-page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div className="section-title" style={{ fontSize: 18, margin: 0 }}>Query History</div>
          <button className="btn btn-red btn-sm" onClick={clearAll}>Clear All</button>
        </div>
        <div>
          {items.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No history yet</div>
          ) : items.map((h, i) => (
            <div key={i} className="history-item" onClick={() => replayQuery(h.question, h.table_name)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hi-q">{h.question || '[Direct SQL]'}</div>
                <div className="hi-sql">{h.sql_query}</div>
              </div>
              <div className="hi-meta">
                <div>{h.table_name}</div>
                <div style={{ color: 'var(--green)' }}>{h.row_count} rows</div>
                <div>{h.created_at?.split('T')[0] || ''}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
