// Cache fragments so we don't re-fetch them on every navigation.
const fragmentCache = {};

async function loadFragment(name) {
  if (fragmentCache[name]) return fragmentCache[name];
  const res = await fetch(`${PAGE_FRAGMENT_BASE}/${name}.html`);
  if (!res.ok) throw new Error(`Failed to load page: ${name}`);
  const html = await res.text();
  fragmentCache[name] = html;
  return html;
}

// Per-page init hooks — page modules register here so navigation can call
// them after the fragment is injected. Hooks may re-run on each navigation,
// so they must be idempotent (re-binding listeners, etc.).
const pageInitHooks = {};

function registerPageInit(name, fn) {
  pageInitHooks[name] = fn;
}

async function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + name);
  pageEl.classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[name] || name;

  // Inject the fragment if this page hasn't been hydrated yet.
  if (!pageEl.dataset.loaded) {
    try {
      pageEl.innerHTML = await loadFragment(name);
      pageEl.dataset.loaded = '1';
    } catch (e) {
      pageEl.innerHTML = `<div class="error-box" style="margin:24px">⚠ ${e.message}</div>`;
      return;
    }
  }

  const initHook = pageInitHooks[name];
  if (initHook) initHook();
}
