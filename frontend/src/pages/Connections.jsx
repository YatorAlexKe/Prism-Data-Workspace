import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';

export default function Connections() {
  const navigate = useNavigate();
  const { refreshDatasets, setCurrentTable, setSelectedTables } = useApp();

  const [connections, setConnections] = useState([]);
  const [tab, setTab] = useState('list'); // list | add
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Add connection form state
  const [form, setForm] = useState({
    name: '', host: 'localhost', port: 3306,
    database: '', username: '', password: ''
  });
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  // Selected connection for schema browsing
  const [selectedConn, setSelectedConn] = useState(null);
  const [schema, setSchema] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await fetch(`${API}/connections`);
      const data = await res.json();
      setConnections(data.connections || []);
    } catch (e) { console.error(e); }
  };

  const handleFormChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/connections/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.host, port: Number(form.port),
          database: form.database, username: form.username, password: form.password
        })
      });
      const data = await res.json();
      if (!res.ok) setTestResult({ success: false, message: data.detail });
      else setTestResult({ success: true, message: data.message, version: data.version });
    } catch (e) {
      setTestResult({ success: false, message: e.message });
    }
    setTesting(false);
  };

  const saveConnection = async () => {
    if (!form.name || !form.host || !form.database || !form.username || !form.password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, host: form.host, port: Number(form.port),
          database: form.database, username: form.username, password: form.password
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to save');
      setSuccess(`"${form.name}" connected successfully!`);
      setForm({ name: '', host: 'localhost', port: 3306, database: '', username: '', password: '' });
      setTestResult(null);
      fetchConnections();
      setTab('list');
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const deleteConnection = async (id, name) => {
    if (!window.confirm(`Remove connection "${name}"?`)) return;
    await fetch(`${API}/connections/${id}`, { method: 'DELETE' });
    fetchConnections();
    if (selectedConn?.id === id) { setSelectedConn(null); setSchema(null); }
  };

  const browseSchema = async (conn) => {
    setSelectedConn(conn);
    setSchema(null);
    setSchemaLoading(true);
    try {
      const res = await fetch(`${API}/connections/${conn.id}/schema`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setSchema(data);
    } catch (e) { setError(e.message); }
    setSchemaLoading(false);
  };

  const goQueryWithConnection = (conn, tableName) => {
    // Store connection context in sessionStorage for query execution
    sessionStorage.setItem('mysql_connection', JSON.stringify({
      connection_id: conn.id,
      connection_name: conn.name,
      table_name: tableName
    }));
    // Set app state so Query page knows what's selected
    setCurrentTable(tableName);
    setSelectedTables([tableName]);
    navigate('/query');
  };

  return (
    <div className="page active">
      <div style={{ padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Database Connections</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              Connect to live MySQL databases and query them directly
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => { setTab('add'); setError(null); setSuccess(null); }}>
            + Add Connection
          </button>
        </div>

        {/* Success / Error banners */}
        {success && (
          <div style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--green)', display: 'flex', justifyContent: 'space-between' }}>
            ✓ {success}
            <span style={{ cursor: 'pointer' }} onClick={() => setSuccess(null)}>×</span>
          </div>
        )}
        {error && (
          <div className="error-box" style={{ marginBottom: 16 }}>
            ⚠ {error}
            <span style={{ float: 'right', cursor: 'pointer' }} onClick={() => setError(null)}>×</span>
          </div>
        )}

        {/* Tabs */}
        <div className="ingest-tabs" style={{ marginBottom: 20 }}>
          <button className={`itab${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>
            My Connections ({connections.length})
          </button>
          <button className={`itab${tab === 'add' ? ' active' : ''}`} onClick={() => setTab('add')}>
            Add Connection
          </button>
        </div>

        {/* LIST TAB */}
        {tab === 'list' && (
          <div style={{ display: 'grid', gridTemplateColumns: selectedConn ? '1fr 1fr' : '1fr', gap: 20 }}>
            {/* Connections list */}
            <div>
              {connections.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
                  <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>🔌</div>
                  <div style={{ fontSize: 13 }}>No connections yet</div>
                  <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setTab('add')}>
                    Add your first connection
                  </button>
                </div>
              ) : (
                connections.map(conn => (
                  <div key={conn.id} style={{
                    background: selectedConn?.id === conn.id ? 'rgba(74,222,128,0.06)' : 'var(--surface)',
                    border: `1px solid ${selectedConn?.id === conn.id ? 'rgba(74,222,128,0.3)' : 'var(--border)'}`,
                    borderRadius: 8, padding: 16, marginBottom: 10, cursor: 'pointer',
                    transition: 'all 0.15s'
                  }} onClick={() => browseSchema(conn)}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ background: 'rgba(96,165,250,0.15)', color: 'var(--blue)', fontSize: 10, padding: '2px 6px', borderRadius: 3, fontFamily: 'var(--mono)' }}>MySQL</span>
                          {conn.name}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                          {conn.username}@{conn.host}:{conn.port} / {conn.database_name}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-blue btn-sm" onClick={(e) => { e.stopPropagation(); browseSchema(conn); }}>
                          Browse
                        </button>
                        <button className="btn btn-red btn-sm" onClick={(e) => { e.stopPropagation(); deleteConnection(conn.id, conn.name); }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Schema panel */}
            {selectedConn && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedConn.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{selectedConn.database_name}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedConn(null); setSchema(null); }}>×</button>
                </div>

                {schemaLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>Loading schema...</div>
                ) : schema ? (
                  <div style={{ overflowY: 'auto', maxHeight: 500 }}>
                    {schema.tables.map((table, i) => (
                      <TableRow key={i} table={table} conn={selectedConn} onQuery={goQueryWithConnection} />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* ADD TAB */}
        {tab === 'add' && (
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ background: 'rgba(96,165,250,0.15)', color: 'var(--blue)', fontSize: 10, padding: '2px 6px', borderRadius: 3, fontFamily: 'var(--mono)' }}>MySQL</span>
                New Connection
              </div>

              <FormField label="Connection Name" placeholder="e.g. Sales Database" value={form.name} onChange={v => handleFormChange('name', v)} />
              <FormField label="Host" placeholder="localhost or IP address" value={form.host} onChange={v => handleFormChange('host', v)} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <FormField label="Port" placeholder="3306" value={form.port} onChange={v => handleFormChange('port', v)} type="number" />
                <FormField label="Database Name" placeholder="my_database" value={form.database} onChange={v => handleFormChange('database', v)} />
              </div>

              <FormField label="Username" placeholder="db_user" value={form.username} onChange={v => handleFormChange('username', v)} />
              <FormField label="Password" placeholder="••••••••" value={form.password} onChange={v => handleFormChange('password', v)} type="password" />

              {/* Security note */}
              <div style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 6, padding: '10px 12px', marginBottom: 16, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                🔒 Passwords are encrypted before storage. For best security, use a read-only database user with SELECT permissions only.
              </div>

              {/* Test result */}
              {testResult && (
              <div style={{
                  background: testResult.success ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
                  border: `1px solid ${testResult.success ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                  borderRadius: 6, padding: '12px 14px', marginBottom: 16,
                  fontSize: 12, color: testResult.success ? 'var(--green)' : 'var(--red)',
                  fontFamily: 'var(--mono)', lineHeight: 1.6
              }}>
                  {testResult.success
                  ? `✓ ${testResult.message} — MySQL ${testResult.version}`
                  : (
                      <>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>✗ Connection Failed</div>
                      <div style={{ color: 'var(--red)', marginBottom: 8 }}>{testResult.message}</div>
                      {testResult.message?.includes('Wrong username') && (
                          <div style={{ color: 'var(--yellow)', fontSize: 11 }}>
                          💡 Tip: Verify credentials in MySQL Workbench:<br />
                          SELECT user, host FROM mysql.user;
                          </div>
                      )}
                      {testResult.message?.includes('no access') && (
                          <div style={{ color: 'var(--yellow)', fontSize: 11 }}>
                          💡 Run this in MySQL Workbench to grant access:<br />
                          GRANT SELECT ON {form.database}.* TO '{form.username}'@'{form.host}';<br />
                          FLUSH PRIVILEGES;
                          </div>
                      )}
                      {testResult.message?.includes('Cannot reach') && (
                          <div style={{ color: 'var(--yellow)', fontSize: 11 }}>
                          💡 Make sure MySQL is running and the host/port are correct.
                          </div>
                      )}
                      {testResult.message?.includes('Authentication') && (
                          <div style={{ color: 'var(--yellow)', fontSize: 11 }}>
                          💡 Run this in MySQL Workbench:<br />
                          ALTER USER '{form.username}'@'{form.host}'<br />
                          IDENTIFIED WITH mysql_native_password<br />
                          BY 'your_password';<br />
                          FLUSH PRIVILEGES;
                          </div>
                      )}
                      </>
                  )
                  }
              </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-ghost" onClick={testConnection} disabled={testing}>
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button className="btn btn-primary" onClick={saveConnection} disabled={loading}>
                  {loading ? 'Saving...' : 'Save & Connect'}
                </button>
                <button className="btn btn-ghost" onClick={() => setTab('list')}>Cancel</button>
              </div>
            </div>

            {/* Best practice tip */}
            <div style={{ marginTop: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Recommended Setup
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                Create a dedicated read-only user for Prism in MySQL:
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '10px 12px', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11, color: '#a8d8b8', lineHeight: 1.8 }}>
                CREATE USER 'prism_user'@'localhost'<br />
                IDENTIFIED BY 'strong_password';<br /><br />
                GRANT SELECT ON your_database.*<br />
                TO 'prism_user'@'localhost';<br /><br />
                FLUSH PRIVILEGES;
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Table row in schema browser ──
function TableRow({ table, conn, onQuery }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', cursor: 'pointer', transition: 'background 0.15s' }}
        onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
        onMouseOut={e => e.currentTarget.style.background = ''}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', flex: 1 }}>
          {expanded ? '▾' : '▸'} {table.table_name}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginRight: 12 }}>
          {table.columns.length} cols
        </span>
        <button
          className="btn btn-primary btn-sm"
          onClick={e => { e.stopPropagation(); onQuery(conn, table.table_name); }}
        >
          Query →
        </button>
      </div>

      {expanded && (
        <div style={{ background: 'var(--surface2)', padding: '8px 16px 12px' }}>
          {table.columns.map((col, i) => {
            const typeClass = ['int','bigint','smallint','tinyint'].includes(col.type) ? 'ct-integer'
              : ['float','double','decimal'].includes(col.type) ? 'ct-float'
              : ['date','datetime','timestamp'].includes(col.type) ? 'ct-datetime'
              : 'ct-text';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {col.key === 'PRI' && <span style={{ color: 'var(--yellow)', fontSize: 10 }}>🔑</span>}
                  {col.name}
                </span>
                <span className={`schema-col-type ${typeClass}`}>{col.type}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Reusable form field ──
function FormField({ label, placeholder, value, onChange, type = 'text' }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
      />
    </div>
  );
}
