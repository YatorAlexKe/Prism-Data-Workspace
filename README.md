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

```bash
cd prism/backend
pip install -r requirements.txt

# Start Ollama (recommended)
ollama pull llama3.2

# Run server
# Windows
venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000

# Mac/Linux
venv/bin/python -m uvicorn main:app --reload --port 8000
```

Open **http://localhost:8000**

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
