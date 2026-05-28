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

// ── DATASET EDITING ──
// Holds the table currently being edited so saveEditedDataset() knows which
// endpoint to PUT to and which columns to serialize.
let editingDataset = null;

async function openEditDataset(tableName) {
  editingDataset = { table_name: tableName, columns: [] };
  document.getElementById('edit-dataset-title').textContent = `Edit Dataset — ${tableName}`;
  document.getElementById('edit-dataset-meta').innerHTML = '';
  document.getElementById('edit-dataset-table').innerHTML =
    '<div class="empty-state" style="min-height:120px"><div class="empty-icon" style="animation:spin 1s linear infinite">⟳</div><div class="empty-text">Loading...</div></div>';
  document.getElementById('edit-dataset-modal').classList.add('open');

  try {
    const res = await fetch(`${API}/datasets/${encodeURIComponent(tableName)}/rows`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to load dataset');
    editingDataset.columns = data.columns.map(c => c.name);
    renderEditTable(data);
  } catch (e) {
    document.getElementById('edit-dataset-table').innerHTML =
      `<div class="error-box" style="margin:16px">⚠ ${e.message}</div>`;
  }
}

function closeEditDatasetModal() {
  document.getElementById('edit-dataset-modal').classList.remove('open');
  editingDataset = null;
}

function renderEditTable(data) {
  const meta = document.getElementById('edit-dataset-meta');
  const sizeNote = data.capped
    ? `Showing first <span style="color:var(--yellow)">${data.returned_rows}</span> of ${data.total_rows} rows (edit cap = ${data.limit}); rows beyond the cap are preserved unchanged.`
    : `${data.returned_rows} rows · ${data.columns.length} columns`;
  meta.innerHTML =
    `<span>${sizeNote}</span>` +
    `<span style="color:var(--muted)">Click a header to rename · click a cell to edit · Enter to confirm</span>`;

  const cols = data.columns;
  // Headers become editable inputs. data-old keeps the original column name so
  // saveEditedDataset can detect renames and the backend can map row keys back
  // to current columns by position. data-original is used by the dirty-state
  // handler to add/remove the .edited class as the value changes.
  const headers = cols.map(c => {
    const safe = c.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<th title="${c.type}"><input class="edit-col-header-input" data-old="${safe}" data-original="${safe}" value="${safe}" spellcheck="false"></th>`;
  }).join('');
  const rows = data.rows.map((row, ri) =>
    '<tr data-rowid="' + row._rowid + '">' +
    cols.map(c => {
      const val = row[c.name] !== undefined && row[c.name] !== null ? String(row[c.name]) : '';
      // Escape for HTML attribute. The input keeps the displayed/edit value.
      const safe = val.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const colSafe = c.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<td><input class="edit-cell-input" data-row="${ri}" data-col="${colSafe}" data-original="${safe}" value="${safe}"></td>`;
    }).join('') +
    '</tr>'
  ).join('');

  const tableEl = document.getElementById('edit-dataset-table');
  tableEl.innerHTML =
    `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  _bindEditTableHandlers(tableEl);
}

// Attach event delegation once per modal lifetime. innerHTML replacement
// inside #edit-dataset-table doesn't blow away listeners on the container
// itself, so the bound flag keeps us from stacking duplicates.
function _bindEditTableHandlers(container) {
  if (container.dataset.handlersBound) return;
  container.dataset.handlersBound = '1';

  container.addEventListener('input', e => {
    const t = e.target;
    if (!t.matches('input.edit-cell-input, input.edit-col-header-input')) return;
    // Toggle the "edited" highlight whenever the value diverges from / returns
    // to the value the input was rendered with. Returning to the original
    // value cleanly removes the highlight without manual reset logic.
    if (t.value !== t.dataset.original) {
      t.classList.add('edited');
    } else {
      t.classList.remove('edited');
    }
  });

  container.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t.matches('input.edit-cell-input, input.edit-col-header-input')) return;
    // Treat Enter as "I'm done editing this cell" — same effect as clicking
    // elsewhere. Default form-submit behavior would still fire on Enter even
    // without a <form>, so preventDefault keeps things predictable.
    e.preventDefault();
    t.blur();
  });
}

async function saveEditedDataset() {
  if (!editingDataset) return;
  const saveBtn = document.getElementById('edit-dataset-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  // Collect the edited rows back from the input grid. Row inputs are still
  // keyed by ORIGINAL column names (data-col was set at render time) — the
  // backend maps original → new by position when applying renames.
  const trs = document.querySelectorAll('#edit-dataset-table tbody tr');
  const rows = Array.from(trs).map(tr => {
    const row = {};
    tr.querySelectorAll('.edit-cell-input').forEach(input => {
      row[input.dataset.col] = input.value;
    });
    return row;
  });

  // Collect any column renames from the header inputs.
  const column_renames = [];
  document.querySelectorAll('.edit-col-header-input').forEach(input => {
    const oldName = input.dataset.old;
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      column_renames.push({ old: oldName, new: newName });
    }
  });

  try {
    const res = await fetch(
      `${API}/datasets/${encodeURIComponent(editingDataset.table_name)}/rows`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, column_renames }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Save failed');

    closeEditDatasetModal();
    // Refresh dataset list / schema / dashboard counts so the new row count
    // and any visible cell changes propagate.
    refreshDatasets();
    if (typeof renderSchemaPanel === 'function') renderSchemaPanel();
  } catch (e) {
    alert('Failed to save: ' + e.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
}
