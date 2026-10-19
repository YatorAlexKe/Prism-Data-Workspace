// Single source of truth for the backend API base URL. Uses a relative path so
// the same build works in development (Vite proxies /api → :8000) and in
// production (FastAPI serves the dist/ bundle and answers /api on the same
// origin). Override via VITE_API_BASE if hosting backend elsewhere.
export const API = import.meta.env.VITE_API_BASE || '/api';

export const PROJECT_COLORS = [
  '#4ade80', '#60a5fa', '#a78bfa', '#fb923c',
  '#f87171', '#fbbf24', '#34d399', '#e879f9',
];

export const PAGE_TITLES = {
  dashboard: 'Dashboard',
  ingest: 'Import Data',
  query: 'Query',
  profile: 'Profile',
  projects: 'Projects',
  history: 'History',
  connections: 'Connections',
};
