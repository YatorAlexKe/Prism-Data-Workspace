import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';

// Profile page: data-quality summary + per-column profile cards. Reads the
// currently-selected table from AppContext (set by Sidebar/Dashboard/Ingest).
export default function Profile() {
  const navigate = useNavigate();
  const { currentTable } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTable) { setData(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API}/profile/${currentTable}`);
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
  }, [currentTable]);

  return (
    <div className="page active">
      <div className="profile-page">
        {!currentTable && (
          <div className="empty-state" style={{ height: '60vh' }}>
            <div className="empty-icon">◉</div>
            <div className="empty-text">Select a dataset to view its profile</div>
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => navigate('/ingest')}>Import Data</button>
          </div>
        )}
        {currentTable && loading && (
          <div className="empty-state">
            <div className="empty-icon">⟳</div>
            <div className="empty-text">Loading profile...</div>
          </div>
        )}
        {currentTable && error && <div className="error-box">⚠ Failed to load profile: {error}</div>}
        {currentTable && data && <ProfileBody data={data} />}
      </div>
    </div>
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
