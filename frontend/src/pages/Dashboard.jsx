import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';
import { useEditDataset } from '../components/EditDatasetContext.jsx';

// Dashboard: 4 stat cards + recent datasets grid + recent queries strip.
// Loads everything in parallel like the old loadDashboard().
export default function Dashboard() {
  const navigate = useNavigate();
  const { openEditDataset } = useEditDataset();
  const { setAllDatasets, setSelectedTables, setCurrentTable, setHistoryCount } = useApp();

  const [datasets, setDatasets] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({ datasets: 0, queries: 0, saved: 0, projects: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [dsRes, hRes, pRes, qRes] = await Promise.all([
          fetch(`${API}/datasets`),
          fetch(`${API}/query/history`),
          fetch(`${API}/projects`),
          fetch(`${API}/queries/saved`),
        ]);
        const ds = (await dsRes.json()).datasets || [];
        const hist = (await hRes.json()).history || [];
        const proj = (await pRes.json()).projects || [];
        const saved = (await qRes.json()).queries || [];
        setDatasets(ds);
        setHistory(hist);
        setStats({ datasets: ds.length, queries: hist.length, saved: saved.length, projects: proj.length });
        // Push datasets into AppContext so the sidebar updates too.
        setAllDatasets(ds);
        setHistoryCount(hist.length);
      } catch (e) { }
    })();
  }, [setAllDatasets, setHistoryCount]);

  // Equivalent of the old goQueryWith()/goProfileWith()/replayQuery() helpers.
  const goQueryWith = (tableName) => {
    setSelectedTables([tableName]);
    setCurrentTable(tableName);
    navigate('/query');
  };
  const goProfileWith = (tableName) => {
    setCurrentTable(tableName);
    navigate('/profile');
  };
  const replayQuery = (question, tableName) => {
    if (tableName) {
      setSelectedTables([tableName]);
      setCurrentTable(tableName);
    }
    // Preserve the question so the query page can pre-fill its input.
    sessionStorage.setItem('prism:replay-question', question || '');
    navigate('/query');
  };

  return (
    <div className="page active">
      <div className="dashboard">
        <div className="stat-grid">
          <StatCard label="Datasets" value={stats.datasets} sub="uploaded files" />
          <StatCard label="Queries Run" value={stats.queries} sub="total executions" />
          <StatCard label="Saved Queries" value={stats.saved} sub="across projects" />
          <StatCard label="Projects" value={stats.projects} sub="workspaces" />
        </div>

        <div className="section-title">Recent Datasets</div>
        <div className="dataset-grid">
          {datasets.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>
              No datasets yet —{' '}
              <span style={{ color: 'var(--green)', cursor: 'pointer' }} onClick={() => navigate('/ingest')}>
                import one to get started
              </span>
            </div>
          ) : datasets.map(d => {
            const q = d.data_quality_score || 0;
            const qc = q > 80 ? 'var(--green)' : q > 60 ? 'var(--yellow)' : 'var(--red)';
            const fmt = d.file_format || 'csv';
            return (
              <div key={d.table_name} className="dataset-card" onClick={() => goQueryWith(d.table_name)}>
                <div className="dataset-card-name">
                  <span>{d.name || d.table_name}</span>
                  <span className={`format-badge fmt-${fmt}`}>{fmt}</span>
                </div>
                <div className="dataset-card-meta">
                  <span>{d.row_count} rows</span>
                  <span>{d.col_count} cols</span>
                </div>
                <div className="quality-bar">
                  <div className="quality-fill" style={{ width: `${q}%`, background: qc }} />
                </div>
                <div className="dataset-card-actions">
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); goQueryWith(d.table_name); }}>Query</button>
                  <button className="btn btn-blue btn-sm" onClick={e => { e.stopPropagation(); goProfileWith(d.table_name); }}>Profile</button>
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEditDataset(d.table_name); }}>✎ Edit</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="section-title">Recent Queries</div>
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {history.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No queries yet</div>
          ) : history.slice(0, 5).map((h, i) => (
            <div key={i} className="history-item" onClick={() => replayQuery(h.question, h.table_name)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="hi-q">{h.question || '[Direct SQL]'}</div>
                <div className="hi-sql">{h.sql_query}</div>
              </div>
              <div className="hi-meta"><div>{h.row_count} rows</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
