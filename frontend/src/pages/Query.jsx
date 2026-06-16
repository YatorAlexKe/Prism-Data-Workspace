import { useEffect, useRef, useState } from 'react';
import { API } from '../api.js';
import { useApp } from '../AppContext.jsx';
import { useEditDataset } from '../components/EditDatasetContext.jsx';
import { useDeleteDataset } from '../components/DeleteDatasetContext.jsx';
import SaveQueryModal from '../components/SaveQueryModal.jsx';
import ResultMap from '../components/ResultMap.jsx';

// Query page: sidebar (table picker + schema) on the left, query input + tabbed
// results on the right. Replaces the old frontend/js/pages/query.js — all
// behaviors preserved (templates dropdown, Ctrl/Cmd+Enter run, JOIN suggestion
// helper, multi-tab results: Table / Chart / SQL, CSV+XLSX export).

const QUERY_TEMPLATES = [
  'Show the first 10 rows',
  'Count total rows',
  'Show top 10 records by highest value',
  'List all unique values in each text column',
  'Find rows with missing values',
  'Show summary statistics for all numeric columns',
  'Group by the first text column and count',
  'Show rows where any value is above average',
];

export default function Query() {
  const { openEditDataset } = useEditDataset();
  const { openDeleteDataset } = useDeleteDataset();
  const {
    allDatasets, setAllDatasets,
    selectedTables, setSelectedTables,
    currentTable, setCurrentTable,
    currentResult, setCurrentResult,
    currentSQL, setCurrentSQL,
    chartSuggestion, setChartSuggestion,
    getLLMConfig,
    loadHistoryCount,
  } = useApp();

  const [question, setQuestion] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [schemaColumns, setSchemaColumns] = useState([]);
  const [resultTab, setResultTab] = useState('table');
  const [joinSuggestions, setJoinSuggestions] = useState(null); // null | [] | [...]
  const [saveOpen, setSaveOpen] = useState(false);
  const [locationInfo, setLocationInfo] = useState(null);
  const inputRef = useRef(null);

  // Initial load: fetch tables (datasets).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/datasets`);
        const data = await res.json();
        setAllDatasets(data.datasets || []);
      } catch (e) { }
    })();
    // Replay-from-dashboard support: dashboard pushes a question into
    // sessionStorage then routes here; consume it once on mount.
    const replay = sessionStorage.getItem('prism:replay-question');
    if (replay !== null) {
      setQuestion(replay);
      sessionStorage.removeItem('prism:replay-question');
    }
  }, [setAllDatasets]);

  // Re-load schema panel whenever currentTable changes.
useEffect(() => {
    if (!currentTable) { setSchemaColumns([]); return; }
    
    // Check if this is a MySQL connection
    const mysqlCtx = sessionStorage.getItem('mysql_connection');
    if (mysqlCtx) {
      const ctx = JSON.parse(mysqlCtx);
      // Fetch schema from MySQL connection
      (async () => {
        try {
          const res = await fetch(`${API}/connections/${ctx.connection_id}/schema`);
          const data = await res.json();
          const table = (data.tables || []).find(t => t.table_name === ctx.table_name);
          setSchemaColumns(table?.columns || []);
        } catch (e) { setSchemaColumns([]); }
      })();
      return;
    }

    // Regular uploaded dataset
    (async () => {
      try {
        const res = await fetch(`${API}/schema/${currentTable}`);
        const data = await res.json();
        setSchemaColumns(data.columns || []);
      } catch (e) { setSchemaColumns([]); }
    })();
  }, [currentTable]);

  // Ctrl/Cmd+Enter to run.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onKey = e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runQuery();
    };
    input.addEventListener('keydown', onKey);
    return () => input.removeEventListener('keydown', onKey);
  });

  const toggleTableSelect = (name) => {
    let next;
    if (selectedTables.includes(name)) {
      next = selectedTables.filter(t => t !== name);
    } else {
      next = [...selectedTables, name];
    }
    setSelectedTables(next);
    setCurrentTable(next[next.length - 1] || null);
  };

  const useTemplate = (t) => {
    setQuestion(t);
    setTemplatesOpen(false);
  };

  const runQuery = async () => {
    const q = question.trim();
    if (!q || selectedTables.length === 0) return;
    const llm = getLLMConfig();
    setLoading(true);
    setError(null);
    setJoinSuggestions(null);
    setCurrentResult(null);
    setCurrentSQL('');
    try {
      let url, body;

      // Check if this is a MySQL connection query
      const mysqlCtx = sessionStorage.getItem('mysql_connection');
      if (mysqlCtx) {
        const ctx = JSON.parse(mysqlCtx);
        url = `${API}/connections/query`;
        body = {
          connection_id: ctx.connection_id,
          table_name: ctx.table_name,
          question: q,
          ...llm
        };
        sessionStorage.removeItem('mysql_connection');
      } else if (selectedTables.length > 1) {
        url = `${API}/query/multi-table`;
        body = { table_names: selectedTables, question: q, ...llm };
      } else {
        url = `${API}/query`;
        body = { table_name: selectedTables[0], question: q, ...llm };
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Query failed');
      setCurrentResult(data.result);
      setCurrentSQL(data.sql);
      setChartSuggestion(data.chart_suggestion || null);
      setLocationInfo(data.location_info || null);
      setResultTab('table');
      loadHistoryCount();
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const clearQuery = () => {
    setQuestion('');
    setCurrentResult(null);
    setCurrentSQL('');
    setError(null);
  };

  const detectJoins = async () => {
    if (selectedTables.length < 2) {
      alert('Select at least 2 tables to detect JOINs.');
      return;
    }
    const llm = getLLMConfig();
    try {
      const res = await fetch(`${API}/schema/detect-joins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_names: selectedTables, ...llm }),
      });
      const data = await res.json();
      setJoinSuggestions(data.joins || []);
    } catch (e) { setJoinSuggestions([]); }
  };

  const useJoinTemplate = (t1, c1, t2, c2) => {
    setQuestion(`Show all data joining ${t1} and ${t2} on ${c1} = ${c2}`);
  };

  const exportResults = async (format) => {
    if (!currentSQL || !currentTable) return;
    try {
      const res = await fetch(`${API}/query/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: currentSQL,
          table_name: currentTable,
          filename: `prism_${currentTable}_${new Date().toISOString().split('T')[0]}`,
          format,
          connection_id: (() => {
            const ctx = sessionStorage.getItem('mysql_connection');
            return ctx ? JSON.parse(ctx).connection_id : null;
          })()
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prism_${currentTable}_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { alert('Export failed: ' + e.message); }
  };

  return (
    // id="page-query" must be present — query.css uses the selector
    // `#page-query.active { flex-direction: row }` to switch the page to a
    // horizontal sidebar+main split. Without the id, the query page would
    // stack everything vertically.
    <div className="page active" id="page-query">
      <div className="query-layout">
        <div className="query-sidebar">
          <div className="qs-header">Tables</div>
          <div className="table-selector">
            {allDatasets.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--muted)', padding: 8, fontFamily: 'var(--mono)' }}>
                No tables — import data first
              </div>
            ) : allDatasets.map(d => (
              <div
                key={d.table_name}
                className={`table-chip${selectedTables.includes(d.table_name) ? ' selected' : ''}`}
                onClick={() => toggleTableSelect(d.table_name)}
              >
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{d.table_name}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>{d.row_count}r</span>
                {selectedTables.includes(d.table_name) && <span className="table-chip-check">✓</span>}
                <span
                  className="table-chip-edit"
                  title="Edit dataset"
                  onClick={e => { e.stopPropagation(); openEditDataset(d.table_name); }}
                >✎</span>
                <span
                  className="table-chip-delete"
                  title="Delete dataset"
                  onClick={e => { e.stopPropagation(); openDeleteDataset(d.table_name); }}
                >🗑</span>
              </div>
            ))}
          </div>
          <div className="qs-header" style={{ borderTop: '1px solid var(--border)' }}>Schema</div>
          <div className="schema-panel">
            {!currentTable ? (
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', padding: 8 }}>Select a table</div>
            ) : schemaColumns.map((c, i) => {
              const cls =
                c.type === 'integer' ? 'ct-integer' :
                c.type === 'float' ? 'ct-float' :
                c.type === 'datetime' ? 'ct-datetime' : 'ct-text';
              return (
                <div key={i} className="schema-col-row">
                  <span className="schema-col-name">{c.name}</span>
                  <span className={`schema-col-type ${cls}`}>{c.type}</span>
                </div>
              );
            })}
          </div>
          <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-blue btn-sm" style={{ width: '100%' }} onClick={detectJoins}>🔗 Detect JOINs</button>
          </div>
        </div>

        <div className="query-main">
          <div className="query-input-area">
            <textarea
              ref={inputRef}
              placeholder="Ask a question in plain English... (Ctrl+Enter to run)"
              rows={2}
              value={question}
              onChange={e => setQuestion(e.target.value)}
            />
            {loading && <div style={{ margin: '6px 0' }}><div className="loading-strip"></div></div>}
            <div className="query-actions">
              <button className="btn btn-primary" onClick={runQuery} disabled={loading || selectedTables.length === 0}>⚡ Run Query</button>
              <button className="btn btn-ghost" onClick={clearQuery}>Clear</button>
              <button className="btn btn-ghost" onClick={() => setTemplatesOpen(v => !v)}>Templates</button>
              <div className="save-query-btn">
                <button className="btn btn-ghost" onClick={() => setSaveOpen(true)} disabled={!currentSQL}>+ Save</button>
              </div>
            </div>
            {templatesOpen && (
              <div style={{ marginTop: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {QUERY_TEMPLATES.map((t, i) => (
                  <TemplateRow key={i} t={t} onPick={useTemplate} />
                ))}
              </div>
            )}
            {joinSuggestions !== null && (
              <div style={{ marginTop: 10 }}>
                {joinSuggestions.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>No obvious JOIN columns found between selected tables.</div>
                ) : (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>JOIN OPPORTUNITIES</div>
                    {joinSuggestions.map((j, i) => (
                      <div key={i} className="join-card">
                        <div className="join-card-header">
                          <span style={{ color: 'var(--blue)' }}>{j.table1}.{j.col1}</span>
                          <span style={{ color: 'var(--muted)' }}>→</span>
                          <span style={{ color: 'var(--purple)' }}>{j.table2}.{j.col2}</span>
                          <span className={`join-confidence conf-${j.confidence || 'medium'}`}>{j.confidence || 'medium'}</span>
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => useJoinTemplate(j.table1, j.col1, j.table2, j.col2)}>Use in query</button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
            {error && <div style={{ marginTop: 10 }}><div className="error-box">⚠ {error}</div></div>}
          </div>

          <div className="results-area">
            {currentResult && (
              <div className="results-tabs">
                <button className={`rtab${resultTab === 'table' ? ' active' : ''}`} onClick={() => setResultTab('table')}>Table</button>
                <button className={`rtab${resultTab === 'chart' ? ' active' : ''}`} onClick={() => setResultTab('chart')}>Chart</button>
                {locationInfo?.type && (
                  <button className={`rtab${resultTab === 'map' ? ' active' : ''}`} onClick={() => setResultTab('map')}>🗺️ Map</button>
                )}
                <button className={`rtab${resultTab === 'sql' ? ' active' : ''}`} onClick={() => setResultTab('sql')}>SQL</button>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => exportResults('csv')}>↓ CSV</button>
                  <button className="btn btn-blue btn-sm" onClick={() => exportResults('xlsx')}>↓ Excel</button>
                </div>
              </div>
            )}
            <div className="results-content">
              {loading && (
                <div className="empty-state">
                  <div className="empty-icon" style={{ animation: 'spin 1s linear infinite' }}>⟳</div>
                  <div className="empty-text">Generating SQL...</div>
                </div>
              )}
              {!loading && !currentResult && (
                <div className="empty-state">
                  <div className="empty-icon">⚡</div>
                  <div className="empty-text">Run a query to see results</div>
                </div>
              )}
              {!loading && currentResult && resultTab === 'table' && <ResultTable result={currentResult} />}
              {!loading && currentResult && resultTab === 'chart' && <ResultChart result={currentResult} suggestion={chartSuggestion} />}
              {!loading && currentResult && resultTab === 'sql' && <ResultSQL sql={currentSQL} />}
              {!loading && currentResult && resultTab === 'map' && <ResultMap result={currentResult} locationInfo={locationInfo} />}
            </div>
          </div>
        </div>
      </div>

      <SaveQueryModal
        open={saveOpen}
        currentSQL={currentSQL}
        question={question}
        tableName={currentTable}
        resultRowCount={currentResult?.row_count || 0}
        onClose={() => setSaveOpen(false)}
      />
    </div>
  );
}

function TemplateRow({ t, onPick }) {
  return (
    <div
      onClick={() => onPick(t)}
      style={{ padding: '9px 14px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'all 0.15s' }}
      onMouseOver={e => { e.currentTarget.style.background = 'var(--surface3)'; e.currentTarget.style.color = 'var(--text)'; }}
      onMouseOut={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--muted)'; }}
    >
      {t}
    </div>
  );
}

function ResultTable({ result }) {
  if (!result) return null;
  const cols = result.columns.map(c => c.name || c);
  if (!result.rows.length) {
    return (
      <>
        <div className="result-meta">
          <span>Returned <span className="count">{result.row_count}</span> rows</span>
          <span>{result.columns.length} columns</span>
        </div>
        <div className="empty-state"><div className="empty-icon">∅</div><div className="empty-text">No rows returned</div></div>
      </>
    );
  }
  return (
    <>
      <div className="result-meta">
        <span>Returned <span className="count">{result.row_count}</span> rows</span>
        <span>{result.columns.length} columns</span>
      </div>
      <div className="table-container">
        <table>
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {result.rows.map((row, ri) => (
              <tr key={ri}>
                {cols.map(c => <td key={c} title={row[c]}>{row[c]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ResultSQL({ sql }) {
  const formatted = formatSQL(sql);
  const html = highlightSQL(formatted);
  const copy = (e) => {
    navigator.clipboard.writeText(sql);
    e.currentTarget.textContent = 'Copied!';
    setTimeout(() => { e.currentTarget.textContent = 'Copy'; }, 2000);
  };
  return (
    <div className="sql-block">
      <div className="sql-block-header">
        <span>Generated SQL</span>
        <button className="btn btn-ghost btn-sm" onClick={copy}>Copy</button>
      </div>
      <div className="sql-code" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function ResultChart({ result, suggestion }) {
  const cols = result.columns.map(c => c.name || c);
  const sug = suggestion || { chart_type: 'bar', x_column: cols[0], y_column: cols[cols.length - 1] };
  const [chartType, setChartType] = useState(sug.chart_type);
  const [xCol, setXCol] = useState(sug.x_column);
  const [yCol, setYCol] = useState(sug.y_column);
  const divRef = useRef(null);

  useEffect(() => {
    drawChart(divRef.current, result, chartType, xCol, yCol);
  }, [result, chartType, xCol, yCol]);

  if (!result.rows.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <div className="empty-text">No data to chart</div>
      </div>
    );
  }
  return (
    <>
      <div className="chart-controls">
        <span className="ctrl-label">Type:</span>
        <select value={chartType} onChange={e => setChartType(e.target.value)}>
          {['bar', 'line', 'scatter', 'pie', 'histogram'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="ctrl-label">X:</span>
        <select value={xCol} onChange={e => setXCol(e.target.value)}>
          {cols.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="ctrl-label">Y:</span>
        <select value={yCol} onChange={e => setYCol(e.target.value)}>
          {cols.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {sug.reason && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
            💡 {sug.reason}
          </span>
        )}
      </div>
      <div ref={divRef}></div>
    </>
  );
}

function drawChart(target, result, type, xCol, yCol) {
  if (!target || !result?.rows?.length || !window.Plotly) return;
  const xVals = result.rows.map(r => r[xCol]);
  const yVals = result.rows.map(r => parseFloat(r[yCol]) || 0);

  const layout = {
    paper_bgcolor: '#141720', plot_bgcolor: '#141720',
    font: { color: '#e2e8f0', family: 'IBM Plex Mono, monospace', size: 11 },
    margin: { t: 20, r: 20, b: 60, l: 60 },
    xaxis: { gridcolor: '#2a2e42', color: '#64748b', tickfont: { size: 10 } },
    yaxis: { gridcolor: '#2a2e42', color: '#64748b' },
    showlegend: false, height: 360,
  };

  let trace;
  const c = '#4ade80';
  if (type === 'pie') {
    trace = { type: 'pie', labels: xVals, values: yVals, marker: { colors: ['#4ade80', '#60a5fa', '#a78bfa', '#fb923c', '#f87171', '#fbbf24'] }, textfont: { color: '#e2e8f0', size: 11 } };
    layout.margin = { t: 20, r: 20, b: 20, l: 20 };
  } else if (type === 'histogram') {
    trace = { type: 'histogram', x: xVals, marker: { color: c, opacity: 0.8 } };
  } else if (type === 'scatter') {
    trace = { type: 'scatter', x: xVals, y: yVals, mode: 'markers', marker: { color: c, size: 7, opacity: 0.8 } };
  } else if (type === 'line') {
    trace = { type: 'scatter', x: xVals, y: yVals, mode: 'lines+markers', line: { color: c, width: 2 }, marker: { color: c, size: 5 } };
  } else {
    trace = { type: 'bar', x: xVals, y: yVals, marker: { color: c, opacity: 0.85 } };
  }
  window.Plotly.newPlot(target, [trace], layout, { responsive: true, displayModeBar: false });
}

function formatSQL(sql) {
  const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT',
                    'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'JOIN', 'ON', 'UNION', 'WITH'];
  let formatted = (sql || '').trim();
  keywords.forEach(kw => {
    formatted = formatted.replace(new RegExp(`\\s+${kw}\\b`, 'gi'), `\n${kw}`);
  });
  formatted = formatted.replace(/SELECT\s+/i, 'SELECT\n  ');
  formatted = formatted.replace(/,\s*/g, ',\n  ');
  return formatted.trim();
}

function highlightSQL(sql) {
  const kws = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'HAVING',
               'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT',
               'IN', 'LIKE', 'IS', 'NULL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
               'ASC', 'DESC', 'WITH', 'UNION', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
  let r = sql;
  kws.forEach(k => { r = r.replace(new RegExp(`\\b${k}\\b`, 'gi'), m => `<span class="kw">${m}</span>`); });
  return r;
}
