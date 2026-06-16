# Troubleshooting

## Server Issues

**Server won't start**
```bash
# Always use venv Python — not system Python
venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

**Module not found errors**
```bash
# Install into venv explicitly
venv\Scripts\python.exe -m pip install -r requirements.txt
```

**Port already in use**
```bash
# Use a different port
venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001
```

---

## Upload Issues

**openpyxl missing when uploading Excel**
```bash
venv\Scripts\python.exe -m pip install openpyxl
```

**File too large**
- Maximum file size is 50MB
- Split large files into smaller chunks before uploading

**JSON import fails**
- Ensure JSON is an array `[{...}, {...}]` or object with an array inside
- JSONL format (one object per line) is not yet supported

---

## MySQL Connection Issues

**Access denied**
```sql
-- Verify user exists
SELECT user, host FROM mysql.user;

-- Grant access
GRANT SELECT ON your_database.* TO 'user'@'localhost';
FLUSH PRIVILEGES;
```

**Authentication plugin error**
```sql
ALTER USER 'your_user'@'localhost'
IDENTIFIED WITH mysql_native_password BY 'your_password';
FLUSH PRIVILEGES;
```

**Cannot reach server**
- Check MySQL is running
- Verify host and port (default: localhost:3306)

---

## Google Sheets Issues

**401 Unauthorized**
- Share the sheet with the service account email
- Check credentials/service_account.json exists

**"Not a Google Sheets document"**
- File must be a native Google Sheet
- Go to File → Save as Google Sheets to convert Excel files

**Method Not Allowed**
- Use the Google Sheets (Private) section, not the URL import section

---

## Map Visualization Issues

**Empty choropleth map**
- Country names must match Plotly's database exactly
- Use `global_water_access.csv` sample to test
- Fictional/custom region names won't render on choropleth

**Map not appearing**
- Results must contain location columns (country, latitude/longitude, province, etc.)
- The Map tab only appears when location data is detected

---

## Query Issues

**SQL execution error: no such table**
- If querying a MySQL connection, make sure you clicked Query → from the Connections page
- The export feature needs a connection_id for MySQL queries

**LLM error**
- Check Ollama is running: `ollama serve`
- For OpenAI/Anthropic, verify your API key is correct
