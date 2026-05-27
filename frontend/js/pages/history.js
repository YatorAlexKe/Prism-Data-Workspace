async function loadHistory() {
  try {
    const res = await fetch(`${API}/query/history`);
    const data = await res.json();
    const items = data.history || [];
    document.getElementById('history-list').innerHTML = items.length
      ? items.map(h => `
          <div class="history-item" onclick="replayQuery('${h.question?.replace(/'/g, "\\'") || ''}', '${h.table_name}')">
            <div style="flex:1;min-width:0">
              <div class="hi-q">${h.question || '[Direct SQL]'}</div>
              <div class="hi-sql">${h.sql_query}</div>
            </div>
            <div class="hi-meta">
              <div>${h.table_name}</div>
              <div style="color:var(--green)">${h.row_count} rows</div>
              <div>${h.created_at?.split('T')[0] || ''}</div>
            </div>
          </div>`).join('')
      : '<div style="color:var(--muted);font-size:13px">No history yet</div>';
  } catch (e) { }
}

async function clearHistory() {
  await fetch(`${API}/query/history`, { method: 'DELETE' });
  loadHistory();
  loadHistoryCount();
}

registerPageInit('history', loadHistory);
