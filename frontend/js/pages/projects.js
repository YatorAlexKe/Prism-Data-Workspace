function openNewProjectModal() {
  document.getElementById('color-picker').innerHTML = PROJECT_COLORS.map(c =>
    `<div class="color-swatch ${c === selectedColor ? 'selected' : ''}" style="background:${c}" onclick="selectColor('${c}')"></div>`
  ).join('');
  document.getElementById('project-modal').classList.add('open');
}

function closeProjectModal() {
  document.getElementById('project-modal').classList.remove('open');
}

function selectColor(c) {
  selectedColor = c;
  document.querySelectorAll('.color-swatch').forEach(s =>
    s.classList.toggle('selected', s.style.background === c || s.style.backgroundColor === c)
  );
}

async function createProject() {
  const name = document.getElementById('project-name').value.trim();
  if (!name) { alert('Enter a project name.'); return; }
  await fetch(`${API}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: document.getElementById('project-desc').value,
      color: selectedColor
    })
  });
  closeProjectModal();
  document.getElementById('project-name').value = '';
  document.getElementById('project-desc').value = '';
  loadProjects();
}

async function loadProjects() {
  try {
    const [pRes, qRes] = await Promise.all([fetch(`${API}/projects`), fetch(`${API}/queries/saved`)]);
    const pData = await pRes.json();
    const qData = await qRes.json();
    const projects = pData.projects || [];
    const queries = qData.queries || [];

    document.getElementById('project-grid').innerHTML = projects.length
      ? projects.map(p => `
          <div class="project-card">
            <div class="project-color-bar" style="background:${p.color}"></div>
            <div class="project-name">${p.name}</div>
            <div class="project-desc">${p.description || 'No description'}</div>
            <div class="project-meta">
              <span>${p.dataset_count} datasets</span>
              <span>${p.query_count} queries</span>
            </div>
          </div>`).join('')
      : '<div style="color:var(--muted);font-size:13px">No projects yet</div>';

    document.getElementById('saved-queries-list').innerHTML = queries.length
      ? queries.map(q => `
          <div class="saved-query-item" onclick="loadSavedQuery(${JSON.stringify(q.sql_query).replace(/"/g, '&quot;')}, '${q.table_name}')">
            <div>
              <div class="sq-name">${q.name}</div>
              <div class="sq-meta">${q.table_name} · ${q.result_row_count} rows</div>
            </div>
            <div style="font-family:var(--mono);font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px">${q.sql_query}</div>
            <button class="btn btn-red btn-sm" onclick="event.stopPropagation();deleteQuery(${q.id})">×</button>
          </div>`).join('')
      : '<div style="color:var(--muted);font-size:13px">No saved queries yet</div>';
  } catch (e) { }
}

function loadSavedQuery(sql, tableName) {
  showPage('query').then(() => {
    document.getElementById('query-input').value = '';
    currentSQL = sql;
    if (tableName && !selectedTables.includes(tableName)) {
      selectedTables = [tableName];
      currentTable = tableName;
      renderTableSelector();
      renderSchemaPanel();
    }
  });
}

async function deleteQuery(id) {
  await fetch(`${API}/queries/${id}`, { method: 'DELETE' });
  loadProjects();
}

registerPageInit('projects', loadProjects);
