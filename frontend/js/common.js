function renderSidebarDatasets(ds) {
  document.getElementById('sidebar-datasets-list').innerHTML = ds.length
    ? ds.map(d => `
      <div class="dataset-item ${currentTable === d.table_name ? 'active' : ''}" onclick="goQueryWith('${d.table_name}')">
        <div class="dataset-dot"></div>
        <span class="dataset-name">${d.table_name}</span>
        <span class="dataset-rows">${d.row_count}</span>
      </div>`).join('')
    : '<div style="padding:8px 16px;font-size:11px;color:var(--border2);font-family:var(--mono)">No datasets yet</div>';
}

async function refreshDatasets() {
  try {
    const res = await fetch(`${API}/datasets`);
    allDatasets = (await res.json()).datasets || [];
    renderSidebarDatasets(allDatasets);
    loadDashboard();
  } catch (e) { }
}

async function loadHistoryCount() {
  try {
    const res = await fetch(`${API}/query/history`);
    const data = await res.json();
    document.getElementById('history-count').textContent = (data.history || []).length;
  } catch (e) { }
}

function goQueryWith(tableName) {
  showPage('query').then(() => {
    if (!selectedTables.includes(tableName)) {
      selectedTables = [tableName];
      currentTable = tableName;
    }
    loadQueryTables();
    renderSchemaPanel();
    document.getElementById('run-query-btn').disabled = false;
    loadTemplates();
  });
}

async function goProfileWith(tableName) {
  await showPage('profile');
  loadProfile(tableName);
}

function replayQuery(question, tableName) {
  showPage('query').then(() => {
    document.getElementById('query-input').value = question;
    if (tableName && !selectedTables.includes(tableName)) {
      selectedTables = [tableName];
      currentTable = tableName;
      renderTableSelector();
      renderSchemaPanel();
      document.getElementById('run-query-btn').disabled = false;
    }
  });
}
