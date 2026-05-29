import { useEffect, useState } from 'react';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';
import { useEditDataset } from './EditDatasetContext.jsx';

// Edit Dataset modal — ports the in-place edit experience (cell + column
// renaming, dirty-state highlight, Enter-to-confirm, save).
//
// Differences from the vanilla version (kept behaviorally identical):
//  - Cell/column values live in React state (rowValues / headerValues) so the
//    dirty highlight comes from `value !== original` rather than a CSS class
//    toggled by an event delegate.
//  - data-original / data-old map directly to the originals state objects;
//    save logic mirrors the old saveEditedDataset() including position-based
//    rename mapping in the backend payload.
export default function EditDatasetModal() {
  const { openTable, closeEditDataset } = useEditDataset();
  const { refreshDatasets } = useApp();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [headerValues, setHeaderValues] = useState([]);       // current column names
  const [headerOriginals, setHeaderOriginals] = useState([]); // original names — used for rename detection
  const [rowValues, setRowValues] = useState([]);             // [{col: value, ...}] keyed by original col names
  const [rowOriginals, setRowOriginals] = useState([]);       // matching shape, frozen at load time
  const [saving, setSaving] = useState(false);

  // Load dataset whenever the modal opens for a new table.
  useEffect(() => {
    if (!openTable) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await fetch(`${API}/datasets/${encodeURIComponent(openTable)}/rows`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || 'Failed to load dataset');
        if (cancelled) return;
        setData(body);
        const colNames = body.columns.map(c => c.name);
        setHeaderOriginals(colNames);
        setHeaderValues(colNames.slice());
        // Row payload from backend uses ORIGINAL column names as keys —
        // preserve that so saveEditedDataset can do the position-based rename
        // mapping the backend expects.
        const rows = body.rows.map(r => {
          const obj = {};
          colNames.forEach(c => {
            obj[c] = r[c] !== undefined && r[c] !== null ? String(r[c]) : '';
          });
          return obj;
        });
        setRowValues(rows);
        setRowOriginals(rows.map(r => ({ ...r })));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [openTable]);

  if (!openTable) return null;

  const onClose = () => {
    closeEditDataset();
    // Reset internal state so the next open starts fresh.
    setData(null);
    setHeaderValues([]); setHeaderOriginals([]);
    setRowValues([]); setRowOriginals([]);
    setError(null);
  };

  const onHeaderChange = (i, v) => {
    setHeaderValues(prev => {
      const next = prev.slice();
      next[i] = v;
      return next;
    });
  };

  const onCellChange = (rowIdx, colName, v) => {
    setRowValues(prev => {
      const next = prev.slice();
      next[rowIdx] = { ...next[rowIdx], [colName]: v };
      return next;
    });
  };

  // Treat Enter as "I'm done editing this cell" — blur the input, same effect
  // as clicking elsewhere. Matches the vanilla keydown delegate.
  const onCellKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const saveEdited = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const column_renames = [];
      headerOriginals.forEach((old, i) => {
        const newName = (headerValues[i] || '').trim();
        if (newName && newName !== old) column_renames.push({ old, new: newName });
      });
      const res = await fetch(
        `${API}/datasets/${encodeURIComponent(openTable)}/rows`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: rowValues, column_renames }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || 'Save failed');
      onClose();
      refreshDatasets();
    } catch (e) {
      alert('Failed to save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay open" id="edit-dataset-modal">
      <div className="modal modal-wide">
        <div className="modal-title">Edit Dataset — {openTable}</div>
        <div className="edit-row-actions">
          {data && !loading && !error && <EditMeta data={data} />}
        </div>
        <div className="edit-table-wrap">
          {loading && (
            <div className="empty-state" style={{ minHeight: 120 }}>
              <div className="empty-icon" style={{ animation: 'spin 1s linear infinite' }}>⟳</div>
              <div className="empty-text">Loading...</div>
            </div>
          )}
          {error && <div className="error-box" style={{ margin: 16 }}>⚠ {error}</div>}
          {data && !loading && !error && (
            <table>
              <thead>
                <tr>
                  {data.columns.map((c, i) => {
                    const edited = headerValues[i] !== headerOriginals[i];
                    return (
                      <th key={i} title={c.type}>
                        <input
                          className={`edit-col-header-input${edited ? ' edited' : ''}`}
                          value={headerValues[i] || ''}
                          spellCheck="false"
                          onChange={e => onHeaderChange(i, e.target.value)}
                          onKeyDown={onCellKeyDown}
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rowValues.map((row, ri) => (
                  <tr key={ri}>
                    {headerOriginals.map((colName, ci) => {
                      const val = row[colName] || '';
                      const orig = rowOriginals[ri]?.[colName] || '';
                      const edited = val !== orig;
                      return (
                        <td key={ci}>
                          <input
                            className={`edit-cell-input${edited ? ' edited' : ''}`}
                            value={val}
                            onChange={e => onCellChange(ri, colName, e.target.value)}
                            onKeyDown={onCellKeyDown}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEdited} disabled={saving || loading}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMeta({ data }) {
  if (data.capped) {
    return (
      <>
        <span>
          Showing first <span style={{ color: 'var(--yellow)' }}>{data.returned_rows}</span> of {data.total_rows} rows (edit cap = {data.limit}); rows beyond the cap are preserved unchanged.
        </span>
        <span style={{ color: 'var(--muted)' }}>Click a header to rename · click a cell to edit · Enter to confirm</span>
      </>
    );
  }
  return (
    <>
      <span>{data.returned_rows} rows · {data.columns.length} columns</span>
      <span style={{ color: 'var(--muted)' }}>Click a header to rename · click a cell to edit · Enter to confirm</span>
    </>
  );
}
