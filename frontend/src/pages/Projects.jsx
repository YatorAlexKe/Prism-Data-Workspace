import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';
import NewProjectModal from '../components/NewProjectModal.jsx';

// Projects + saved queries page. Cards on top, saved-queries list below.
export default function Projects() {
  const navigate = useNavigate();
  const { setSelectedTables, setCurrentTable, setCurrentSQL } = useApp();
  const [projects, setProjects] = useState([]);
  const [queries, setQueries] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [pRes, qRes] = await Promise.all([
        fetch(`${API}/projects`),
        fetch(`${API}/queries/saved`),
      ]);
      const pData = await pRes.json();
      const qData = await qRes.json();
      setProjects(pData.projects || []);
      setQueries(qData.queries || []);
    } catch (e) { }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const loadSavedQuery = (sql, tableName) => {
    setCurrentSQL(sql);
    if (tableName) {
      setSelectedTables([tableName]);
      setCurrentTable(tableName);
    }
    navigate('/query');
  };

  const deleteQuery = async (id, e) => {
    e.stopPropagation();
    await fetch(`${API}/queries/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div className="page active">
      <div className="projects-page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div className="section-title" style={{ fontSize: 18, margin: 0 }}>Projects</div>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ New Project</button>
        </div>
        <div className="project-grid">
          {projects.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No projects yet</div>
          ) : projects.map(p => (
            <div key={p.id} className="project-card">
              <div className="project-color-bar" style={{ background: p.color }} />
              <div className="project-name">{p.name}</div>
              <div className="project-desc">{p.description || 'No description'}</div>
              <div className="project-meta">
                <span>{p.dataset_count} datasets</span>
                <span>{p.query_count} queries</span>
              </div>
            </div>
          ))}
        </div>

        <div className="section-title">All Saved Queries</div>
        <div>
          {queries.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No saved queries yet</div>
          ) : queries.map(q => (
            <div key={q.id} className="saved-query-item" onClick={() => loadSavedQuery(q.sql_query, q.table_name)}>
              <div>
                <div className="sq-name">{q.name}</div>
                <div className="sq-meta">{q.table_name} · {q.result_row_count} rows</div>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                {q.sql_query}
              </div>
              <button className="btn btn-red btn-sm" onClick={(e) => deleteQuery(q.id, e)}>×</button>
            </div>
          ))}
        </div>
      </div>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={reload} />
    </div>
  );
}
