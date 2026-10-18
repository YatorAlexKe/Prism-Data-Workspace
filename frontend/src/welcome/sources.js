// Source kinds Prism supports. Each gets a spectrum colour from base.css plus
// one cyan, a glyph shape the 3D scene knows how to build, and where clicking
// it leads in the app.
export const SOURCE_KINDS = {
  image:         { label: 'Image OCR',     color: '#f87171', shape: 'frame', to: '/ingest',      hint: 'Scan a photo of a table' },
  mysql:         { label: 'MySQL',         color: '#fb923c', shape: 'db',    to: '/connections', hint: 'Query a live database' },
  json:          { label: 'JSON',          color: '#fbbf24', shape: 'nest',  to: '/ingest',      hint: 'Import a JSON file' },
  csv:           { label: 'CSV',           color: '#4ade80', shape: 'rows',  to: '/ingest',      hint: 'Import a CSV file' },
  excel:         { label: 'Excel',         color: '#22d3ee', shape: 'grid',  to: '/ingest',      hint: 'Import an Excel workbook' },
  google_sheets: { label: 'Google Sheets', color: '#60a5fa', shape: 'sheet', to: '/ingest',      hint: 'Link a Google Sheet' },
  url:           { label: 'URL',           color: '#a78bfa', shape: 'ring',  to: '/ingest',      hint: 'Fetch data from a URL' },
};

// The kinds that orbit the prism on the welcome screen, in spectrum order.
export const ORBIT_KINDS = ['image', 'mysql', 'json', 'csv', 'excel', 'google_sheets', 'url'];

// The three result views Prism really produces (Query page tabs).
export const OUTPUTS = [
  { key: 'chart', label: 'Chart', color: '#fb923c' },
  { key: 'table', label: 'Table', color: '#4ade80' },
  { key: 'map',   label: 'Map',   color: '#a78bfa' },
];
