import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';
import { useEditDataset } from '../components/EditDatasetContext.jsx';

// Profile page: data-quality summary + per-column profile cards.
// The dataset is part of the address (/profile/sales_data), so refresh,
// bookmarks and the back button all show the right one. /profile on its own
// reopens the current dataset, or lists datasets to pick from.
export default function Profile() {
  const navigate = useNavigate();
  const { tableName } = useParams();
  const { allDatasets, currentTable, setCurrentTable, setSelectedTables } = useApp();
  const { openEditDataset } = useEditDataset();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Keep the rest of the app (sidebar highlight, Query schema panel) in step.
  useEffect(() => {
    if (tableName && tableName !== currentTable) setCurrentTable(tableName);
  }, [tableName, currentTable, setCurrentTable]);

  useEffect(() => {
    if (!tableName) { setData(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      // Keep showing this dataset's profile while it reloads; clear it when switching.
      setData(prev => (prev && prev.table_name === tableName ? prev : null));
      try {
        const res = await fetch(`${API}/profile/${encodeURIComponent(tableName)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || 'Failed to load profile');
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // allDatasets is replaced after an edit is saved (refreshDatasets), so the
    // profile reloads with the edited data.
  }, [tableName, allDatasets]);

  // /profile with a dataset already selected elsewhere: show that one.
  if (!tableName && currentTable) {
    return <Navigate to={`/profile/${encodeURIComponent(currentTable)}`} replace />;
  }

  const queryThis = () => {
    setSelectedTables([tableName]);
    navigate('/query');
  };

  return (
    <div className="page active">
      <div className="profile-page">
        {!tableName && <DatasetPicker datasets={allDatasets} onPick={t => navigate(`/profile/${encodeURIComponent(t)}`)} onImport={() => navigate('/ingest')} />}

        {tableName && (
          <div className="profile-toolbar">
            <label className="profile-switch">
              <span>Dataset</span>
              <select value={tableName} onChange={e => navigate(`/profile/${encodeURIComponent(e.target.value)}`)}>
                {!allDatasets.some(d => d.table_name === tableName) && <option value={tableName}>{tableName}</option>}
                {allDatasets.map(d => <option key={d.table_name} value={d.table_name}>{d.table_name}</option>)}
              </select>
            </label>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => openEditDataset(tableName)}>✎ Edit</button>
            <button className="btn btn-primary btn-sm" onClick={queryThis}>Query this dataset →</button>
          </div>
        )}
        {tableName && loading && !data && (
          <div className="empty-state">
            <div className="empty-icon">⟳</div>
            <div className="empty-text">Loading profile...</div>
          </div>
        )}
        {tableName && error && <div className="error-box">⚠ Failed to load profile: {error}</div>}
        {tableName && data && <ProfileBody data={data} />}
      </div>
    </div>
  );
}

function DatasetPicker({ datasets, onPick, onImport }) {
  if (datasets.length === 0) {
    return (
      <div className="empty-state" style={{ height: '60vh' }}>
        <div className="empty-icon">◉</div>
        <div className="empty-text">No datasets yet — import one to see its profile</div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onImport}>Import Data</button>
      </div>
    );
  }
  return (
    <>
      <div className="section-title">Choose a dataset to profile</div>
      <div className="profile-picker">
        {datasets.map(d => (
          <button key={d.table_name} className="profile-pick" onClick={() => onPick(d.table_name)}>
            <span className="profile-pick-name">{d.table_name}</span>
            <span className="profile-pick-meta">{d.row_count} rows · {d.col_count} cols</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ProfileBody({ data }) {
  const q = data.quality_score;
  const qColor = q > 80 ? 'var(--green)' : q > 60 ? 'var(--yellow)' : 'var(--red)';
  return (
    <>
      <div className="profile-header">
        <div>
          <div className="profile-title">{data.table_name}</div>
          <div className="profile-sub">{data.row_count} rows · {data.col_count} columns · {data.duplicate_rows} duplicates</div>
        </div>
        <div className="quality-ring-wrap">
          <div className="quality-score-num" style={{ color: qColor }}>{q}%</div>
          <div className="quality-label">Data Quality</div>
        </div>
      </div>
      {data.warnings.length > 0 && (
        <div className="warnings-block">
          {data.warnings.map((w, i) => <div key={i} className="warning-item">⚠ {w}</div>)}
        </div>
      )}
      <div className="section-title">Column Profiles</div>
      <div className="col-profile-grid">
        {data.columns.map((c, i) => <ColumnCard key={i} c={c} />)}
      </div>
    </>
  );
}

function ColumnCard({ c }) {
  const typeClass = c.type === 'integer' || c.type === 'float' ? `ct-${c.type}` : 'ct-text';
  return (
    <div className="col-card">
      <div className="col-card-header">
        <span className="col-card-name">{c.name}</span>
        <span className={`schema-col-type ${typeClass}`}>{c.type}</span>
      </div>
      <Stat label="Nulls" val={`${c.null_count} (${c.null_pct}%)`} valColor={c.null_pct > 20 ? 'var(--red)' : 'var(--text)'} />
      <Stat label="Unique" val={`${c.unique_count} (${c.unique_pct}%)`} />
      {c.min !== undefined && (
        <>
          <Stat label="Min" val={c.min} />
          <Stat label="Max" val={c.max} />
          <Stat label="Mean" val={c.mean} />
        </>
      )}
      {c.top_values && (
        <>
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>TOP VALUES</div>
          {c.top_values.map((v, i) => (
            <div key={i} className="col-stat">
              <span className="col-stat-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{v.value}</span>
              <span className="col-stat-val">{v.count}</span>
            </div>
          ))}
        </>
      )}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 4 }}>QUALITY</div>
        <div className="quality-bar">
          <div className="quality-fill" style={{ width: `${c.quality_score}%`, background: c.quality_score > 80 ? 'var(--green)' : c.quality_score > 60 ? 'var(--yellow)' : 'var(--red)' }} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, val, valColor }) {
  return (
    <div className="col-stat">
      <span className="col-stat-label">{label}</span>
      <span className="col-stat-val" style={valColor ? { color: valColor } : undefined}>{val}</span>
    </div>
  );
}
