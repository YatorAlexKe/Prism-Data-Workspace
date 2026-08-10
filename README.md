# Prism — AI Data Workspace

Query your data in plain English. No SQL required.

![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat&logo=sqlite&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-00000F?style=flat&logo=mysql&logoColor=white)
![Plotly](https://img.shields.io/badge/Plotly-3F4F75?style=flat&logo=plotly&logoColor=white)
![Pandas](https://img.shields.io/badge/Pandas-150458?style=flat&logo=pandas&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-000000?style=flat&logo=ollama&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=flat&logo=openai&logoColor=white)
![Google Sheets](https://img.shields.io/badge/Google_Sheets-34A853?style=flat&logo=google-sheets&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)

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

## Capstone Project

**Course:** CMP1979 — Modern Software Development
**Team:** NorthShield Analysts
**Institution:** Cambrian College

### Team Members
- Alex Yator (A00335392) — Team Leader
- Audrey Goudi (A00292758)
- Cherylpreet Bansal (A00336894)

### How to Run Automated Tests

```bash
cd backend
venv\Scripts\python.exe tests/test_prism.py   # Windows
venv/bin/python tests/test_prism.py            # Mac/Linux
```

Expected output: 13/13 passed

---

### Project Links

- [Shared Word Report](https://mycambrian-my.sharepoint.com/:w:/r/personal/a00336894_mycambrian_ca/_layouts/15/Doc.aspx?sourcedoc=%7B1677D581-26A2-435E-A588-7C8C0744E5AC%7D&file=CMP1979-CapstoneFinalReport-NorthshieldAnalysts-CORRECTED.docx&action=default&mobileredirect=true&wdOrigin=APPHOME-WEB.DIRECT%2CAPPHOME-WEB.BANNER.UPLOAD&wdPreviousSession=4b359d43-0ef2-49f3-9281-281e02e6079d&wdPreviousSessionSrc=AppHomeWeb&ct=1786334677975&isSPOFile=1&xsdata=MDV8MDJ8fGIwOGZlNDhlM2UxNzRjNzBlZGU4MDhkZWY3MTMzMmY4fGE2YTc4ZDZjNzk5YTQzYmE4MjFhZDVhMWY1ZjBmNzY3fDB8MHw2MzkyMTk4NTg5NjQ4MDMwNDh8VW5rbm93bnxWR1ZoYlhOVFpXTjFjbWwwZVZObGNuWnBZMlY4ZXlKRFFTSTZJbFJsWVcxelgwRlVVRk5sY25acFkyVmZVMUJQVEU5R0lpd2lWaUk2SWpBdU1DNHdNREF3SWl3aVVDSTZJbGRwYmpNeUlpd2lRVTRpT2lKUGRHaGxjaUlzSWxkVUlqb3hNWDA9fDF8TDJOb1lYUnpMekU1T21Wall6QXpPRGhsWm1aaU5UUTVNemxoT0RVMU9Ea3hZakZsTjJVek5tVXpRSFJvY21WaFpDNTJNaTl0WlhOellXZGxjeTh4TnpnMk16ZzVNRGswTmpjd3w0YWI1YTBiZTAyZGM0ZDJhOGJhYzA4ZGVmNzEzMzJmNnxhYjIxMjJhNzY0ZWM0YWU3YTA5YzRjZWQ2NGQwY2U4Nw%3D%3D&sdata=bmVaZDhGcmhpdTlkOHBkOVhjUmNmaTVDT2VjbGdGQ3hzcnZUQXJXRTIyaz0%3D&ovuser=a6a78d6c-799a-43ba-821a-d5a1f5f0f767%2CA00335392%40mycambrian.ca)

- [Azure DevOps Board](https://dev.azure.com/PrismCapstone/PRISM%20WORKSPACE/_workitems/recentlyupdated/)

---

*MIT License*
