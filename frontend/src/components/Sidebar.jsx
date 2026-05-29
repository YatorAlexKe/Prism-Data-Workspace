import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext.jsx';

// Sidebar navigation + datasets list. Same DOM/class structure as the vanilla
// version — preserves all existing CSS selectors.
export default function Sidebar() {
  const { allDatasets, historyCount, currentTable, selectedTables, setSelectedTables, setCurrentTable } = useApp();
  const navigate = useNavigate();

  // Equivalent of the old goQueryWith(): select the dataset and route to the
  // query page. Sets currentTable so the schema panel knows what to load.
  const goQueryWith = (tableName) => {
    if (!selectedTables.includes(tableName)) {
      setSelectedTables([tableName]);
      setCurrentTable(tableName);
    }
    navigate('/query');
  };

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">P</div>
        <div className="logo-text">Pri<span>sm</span></div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Workspace</div>
        <NavItem to="/dashboard" icon="◈" label="Dashboard" />
        <NavItem to="/ingest" icon="⬆" label="Import Data" />
        <NavItem to="/query" icon="⚡" label="Query" />
        <NavItem to="/profile" icon="◉" label="Profile" />

        <div className="nav-section-label">Organize</div>
        <NavItem to="/projects" icon="▣" label="Projects" />
        <NavItem to="/history" icon="◷" label="History" badge={historyCount} />
      </nav>

      <div className="sidebar-datasets">
        <div style={{ padding: '8px 16px 4px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
          Datasets
        </div>
        <div id="sidebar-datasets-list">
          {allDatasets.length === 0 ? (
            <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--border2)', fontFamily: 'var(--mono)' }}>
              No datasets yet
            </div>
          ) : (
            allDatasets.map(d => (
              <div
                key={d.table_name}
                className={`dataset-item ${currentTable === d.table_name ? 'active' : ''}`}
                onClick={() => goQueryWith(d.table_name)}
              >
                <div className="dataset-dot"></div>
                <span className="dataset-name">{d.table_name}</span>
                <span className="dataset-rows">{d.row_count}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function NavItem({ to, icon, label, badge }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      <span className="nav-icon">{icon}</span> {label}
      {badge !== undefined && <span className="nav-badge">{badge}</span>}
    </NavLink>
  );
}
