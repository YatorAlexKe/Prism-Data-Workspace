import { useEffect, useState } from 'react';
import { API } from '../api.js';

// Save Query modal — used by the Query page. Loads project list on open so
// the dropdown is current. Closes on cancel / successful save.
export default function SaveQueryModal({ open, currentSQL, question, tableName, resultRowCount, onClose }) {
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setProjectId('');
    (async () => {
      try {
        const res = await fetch(`${API}/projects`);
        const data = await res.json();
        setProjects(data.projects || []);
      } catch (e) { setProjects([]); }
    })();
  }, [open]);

  if (!open) return null;

  const onSave = async () => {
    const n = name.trim();
    if (!n) { alert('Please enter a query name.'); return; }
    try {
      await fetch(`${API}/queries/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: n,
          sql_query: currentSQL,
          question: question,
          table_name: tableName || '',
          project_id: projectId ? parseInt(projectId) : null,
          result_row_count: resultRowCount || 0,
        }),
      });
      onClose();
    } catch (e) { alert('Failed to save: ' + e.message); }
  };

  return (
    <div className="modal-overlay open">
      <div className="modal">
        <div className="modal-title">Save Query</div>
        <div className="form-field">
          <label className="form-label">Query Name</label>
          <input
            type="text" className="form-input"
            placeholder="e.g. Top 10 by Revenue"
            value={name} onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Project (optional)</label>
          <select
            className="form-input" title="save-project" style={{ width: '100%' }}
            value={projectId} onChange={e => setProjectId(e.target.value)}
          >
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
