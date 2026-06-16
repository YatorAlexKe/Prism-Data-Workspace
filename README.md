# Prism — AI Data Workspace

Query your data in plain English. No SQL required.

![Prism Dashboard](docs/screenshots/dashboard.png)

---

## What it does

Upload a CSV, connect a database, or link a Google Sheet — then ask questions like:

> *"Show total revenue by region"*
> *"Which countries have water access below 60%?"*
> *"Top 10 customers by lifetime value"*

Prism converts your question to SQL, runs it, and returns results as a table, chart, or interactive map.

---

## Key Features

- **Any data source** — CSV, Excel, JSON, Google Sheets, MySQL, image OCR
- **Natural language queries** — powered by Ollama (free, local) or OpenAI/Anthropic
- **Map visualization** — choropleth world maps, bubble maps, point maps
- **Data quality profiler** — null analysis, statistics, quality scores
- **Export anywhere** — download results as Excel or CSV

---

## Quick Start

**Prerequisites:** Python 3.10+, Node.js 18+, [Ollama](https://ollama.com/download)

```bash
# 1. Clone
git clone https://github.com/YatorAlexKe/Prism-Data-Workspace.git
cd Prism-Data-Workspace

# 2. Backend
cd backend
python -m venv venv
venv\Scripts\activate.bat          # Windows
source venv/bin/activate            # Mac/Linux
venv\Scripts\python.exe -m pip install -r requirements.txt

# 3. Frontend
cd ../frontend
npm install && npm run build

# 4. Pull a local LLM (free)
ollama pull llama3.2

# 5. Run
cd ../backend
venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

Open **http://localhost:8000**

---

## Sample Datasets

Three datasets included in `docs/sample_datasets/` to get started immediately:

| File | Description |
|------|-------------|
| `sales_data.csv` | 200 sales orders by region and product |
| `customers.json` | 100 customers with country and spend data |
| `global_water_access.csv` | 61 countries with coordinates and water access % |

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Setup Guide](docs/SETUP.md) | Detailed installation and configuration |
| [API Reference](docs/API.md) | All endpoints with request/response examples |
| [Google Sheets](docs/GOOGLE_SHEETS.md) | Service account setup and usage |
| [MySQL Connections](docs/MYSQL.md) | Connecting live databases securely |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common errors and fixes |
| [Contributing](CONTRIBUTING.md) | Branching strategy and development workflow |
| [Security](SECURITY.md) | Security model and credential handling |

---

## Built With

**Backend:** Python · FastAPI · SQLite · Pandas · PyMySQL · img2table · Pytesseract · OpenCV · Google APIs · Cryptography

**Frontend:** React 18 · Vite · React Router · Plotly.js

**LLM:** Ollama · OpenAI API · Anthropic API

---

*MIT License*
