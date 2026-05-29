import { useEffect, useState } from 'react';
import { API, PROJECT_COLORS } from '../api.js';

// New Project modal: name + description + color picker. Calls POST /projects
// then invokes onCreated() so the Projects page can re-fetch its list.
export default function NewProjectModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);

  // Reset state every time the modal opens so leftover values from a prior
  // open don't bleed through.
  useEffect(() => {
    if (open) {
      setName(''); setDesc(''); setColor(PROJECT_COLORS[0]);
    }
  }, [open]);

  if (!open) return null;

  const onCreate = async () => {
    const n = name.trim();
    if (!n) { alert('Enter a project name.'); return; }
    await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, description: desc, color }),
    });
    onClose();
    if (onCreated) onCreated();
  };

  return (
    <div className="modal-overlay open">
      <div className="modal">
        <div className="modal-title">New Project</div>
        <div className="form-field">
          <label className="form-label">Project Name</label>
          <input
            type="text" className="form-input"
            placeholder="e.g. Sales Analysis"
            value={name} onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Description</label>
          <input
            type="text" className="form-input"
            placeholder="Optional description"
            value={desc} onChange={e => setDesc(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Color</label>
          <div className="color-picker">
            {PROJECT_COLORS.map(c => (
              <div
                key={c}
                className={`color-swatch${c === color ? ' selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}
