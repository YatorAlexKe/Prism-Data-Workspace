# Prism — AI Data Workspace

A production-grade natural language data query tool for professionals.

## Features
- **Multi-format import** — CSV, Excel (.xlsx), JSON, URL, Google Sheets
- **NL → SQL** — Ask questions in plain English
- **Column Profiler** — Data quality scores, null analysis, statistics
- **Auto Chart Suggestions** — AI picks the best chart for your data
- **Multi-table JOIN detection** — Query across multiple datasets
- **Save & organize** — Projects and saved queries
- **LLM support** — Ollama (local), OpenAI, Anthropic

## Quick Start

Prism has two parts: a **FastAPI backend** (Python) and a **React frontend** (Vite). Install both once, then run together.

### 1. Backend (Python ≥ 3.10)

```bash
cd Prism-Data-Workspace/backend
pip install -r requirements.txt

# Start Ollama (recommended local LLM)
ollama pull llama3.2

# Run server
# Windows
venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000

# Mac/Linux
venv/bin/python -m uvicorn main:app --reload --port 8000
```

### 2. Frontend (Node.js ≥ 18)

```bash
cd Prism-Data-Workspace/frontend
npm install
```

Two ways to run the UI:

**Option A — Development mode (hot reload, two processes)**
```bash
# Terminal 1: backend (from step 1)
# Terminal 2:
cd Prism-Data-Workspace/frontend
npm run dev
```
Open **http://localhost:5173**. Vite proxies `/api/*` requests to the FastAPI server on `:8000`, so both must be running.

**Option B — Production mode (single origin, one process)**
```bash
cd Prism-Data-Workspace/frontend
npm run build
```
This emits a static bundle to `frontend/dist/`. The FastAPI server picks it up automatically — just run the backend and open **http://localhost:8000**. Re-run `npm run build` whenever you change the frontend.

### Frontend architecture
- **Vite + React 18 + React Router 6** — SPA shell with client-side routing
- **AppContext** (`frontend/src/AppContext.jsx`) — shared workspace state (selected tables, datasets, query results, LLM config)
- **`frontend/src/api.js`** — single source of truth for the API base URL (defaults to `/api`; override with `VITE_API_BASE` env var)
- **CSS preserved as-is** from the original vanilla build — see `frontend/src/css/`

## Sample Datasets
- `docs/sample_datasets/sales_data.csv` — 200 sales orders
- `docs/sample_datasets/customers.json` — 100 customers

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ingest/file` | Upload CSV/Excel/JSON |
| POST | `/api/ingest/url` | Import from URL |
| POST | `/api/query` | NL → SQL query |
| POST | `/api/query/multi-table` | Multi-table query |
| POST | `/api/query/fix-sql` | Fix broken SQL |
| GET  | `/api/profile/{table}` | Column profiler |
| GET  | `/api/datasets` | List datasets |
| GET  | `/api/projects` | List projects |
| POST | `/api/queries/save` | Save a query |
| GET  | `/api/query/history` | Query history |
