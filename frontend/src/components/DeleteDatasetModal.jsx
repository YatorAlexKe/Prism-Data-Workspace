import { useState } from 'react';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';
import { useDeleteDataset } from './DeleteDatasetContext.jsx';

// Delete-dataset confirmation modal. Calls DELETE /datasets/{table_name} and
// filters the table out of allDatasets directly so every consumer re-renders
// the instant the request returns — no second GET /datasets round trip.
export default function DeleteDatasetModal() {
  const { pendingTable, closeDeleteDataset } = useDeleteDataset();
  const {
    setAllDatasets,
    setSelectedTables,
    currentTable, setCurrentTable,
    setCurrentResult, setCurrentSQL,
  } = useApp();
  const [deleting, setDeleting] = useState(false);

  if (!pendingTable) return null;

  const onConfirm = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${API}/datasets/${encodeURIComponent(pendingTable)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || 'Delete failed');
      }
      setAllDatasets(prev => prev.filter(d => d.table_name !== pendingTable));
      setSelectedTables(prev => prev.filter(t => t !== pendingTable));
      if (currentTable === pendingTable) {
        setCurrentTable(null);
        setCurrentResult(null);
        setCurrentSQL('');
      }
      closeDeleteDataset();
    } catch (e) {
      alert('Failed to delete: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay open" id="delete-dataset-modal">
      <div className="modal">
        <div className="modal-title">Delete Dataset</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
          Permanently delete <span style={{ color: 'var(--red)', fontFamily: 'var(--mono)' }}>{pendingTable}</span>?
          <br />
          This drops the underlying table and removes all rows. This cannot be undone.
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={closeDeleteDataset} disabled={deleting}>Cancel</button>
          <button className="btn btn-red" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
