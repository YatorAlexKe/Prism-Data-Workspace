# Setup Guide

## Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Python | 3.10+ | https://python.org |
| Node.js | 18+ | https://nodejs.org |
| Ollama | Latest | https://ollama.com/download |

---

## Installation

### 1. Backend

```bash
cd backend
python -m venv venv

# Activate (Windows)
venv\Scripts\activate.bat

# Activate (Mac/Linux)
source venv/bin/activate

# Install — always use venv Python
venv\Scripts\python.exe -m pip install -r requirements.txt   # Windows
venv/bin/python -m pip install -r requirements.txt           # Mac/Linux
```

### 2. Frontend

```bash
cd frontend
npm install
npm run build
```

> Re-run `npm run build` after any frontend changes.

### 3. LLM Setup

**Option A — Ollama (free, local, recommended)**
```bash
ollama pull llama3.2
# Ollama starts automatically on localhost:11434
```

**Option B — OpenAI**
```bash
export OPENAI_API_KEY=sk-...
```

**Option C — Anthropic**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Running Prism

```bash
cd backend

# Windows
venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000

# Mac/Linux
venv/bin/python -m uvicorn main:app --reload --port 8000
```

Open **http://localhost:8000**

---

## Google Sheets Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project → Enable **Google Sheets API** and **Google Drive API**
3. Create **Service Account** → Download JSON key
4. Save key as `credentials/service_account.json`
5. Share your Google Sheet with the service account email

See [Google Sheets Guide](GOOGLE_SHEETS.md) for full details.

---

## MySQL Setup

Create a read-only user for Prism:

```sql
CREATE USER 'prism_user'@'localhost'
IDENTIFIED WITH mysql_native_password BY 'your_strong_password';

GRANT SELECT ON your_database.* TO 'prism_user'@'localhost';
FLUSH PRIVILEGES;
```

See [MySQL Guide](MYSQL.md) for full details.
