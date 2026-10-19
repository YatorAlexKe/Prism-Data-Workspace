import os
import json
import urllib.request

def build_schema_context(table_name: str, columns: list) -> str:
    lines = [f"Table: {table_name}", "Columns:"]
    for col in columns:
        lines.append(f"  {col['name']} ({col['type']})")
    return '\n'.join(lines)

def build_multi_schema_context(tables: list) -> str:
    parts = []
    for t in tables:
        lines = [f"Table: {t['table_name']}", "Columns:"]
        for col in t['columns']:
            lines.append(f"  {col['name']} ({col['type']})")
        parts.append('\n'.join(lines))
    return '\n\n'.join(parts)

# Question -> SQL prompting lives in utils/nl2sql.py.

def build_chart_prompt(columns: list, sample_rows: list) -> str:
    col_info = ', '.join([f"{c['name']} ({c['type']})" for c in columns])
    return f"""You are a data visualization expert. Given query results, suggest the best chart type.

COLUMNS: {col_info}
SAMPLE DATA (first 3 rows): {json.dumps(sample_rows[:3])}

Choose ONE chart type from: bar, line, scatter, pie, heatmap, histogram
Also suggest which column should be X axis and which should be Y axis.

Respond in JSON only, no explanation:
{{"chart_type": "bar", "x_column": "column_name", "y_column": "column_name", "reason": "brief reason"}}"""

def build_join_prompt(schemas: list) -> str:
    schema_text = build_multi_schema_context(schemas)
    return f"""You are a SQL expert. Analyze these tables and identify potential JOIN relationships.

{schema_text}

Identify columns that could be used to JOIN these tables (matching names, IDs, foreign keys).
Respond in JSON only:
{{"joins": [{{"table1": "name", "col1": "column", "table2": "name", "col2": "column", "confidence": "high/medium/low"}}]}}"""

def build_fix_sql_prompt(broken_sql: str, schema_context: str, error: str) -> str:
    return f"""You are a SQL expert. Fix the following broken SQL query.

SCHEMA:
{schema_context}

BROKEN SQL:
{broken_sql}

ERROR MESSAGE:
{error}

Return ONLY the fixed SQL query, no explanation, no markdown."""

def _call_ollama(prompt: str, model: str = "llama3.2", system: str = None, json_schema: dict = None) -> str:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    body = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.1},
    }
    if json_schema:
        # Ollama constrains decoding to this schema (structured outputs).
        body["format"] = json_schema
    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read()).get("message", {}).get("content", "").strip()

def _call_openai(prompt: str, api_key: str, model: str = "gpt-4o-mini", system: str = None) -> str:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 800
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["choices"][0]["message"]["content"].strip()

def _call_anthropic(prompt: str, api_key: str, model: str = "claude-haiku-4-5-20251001", system: str = None) -> str:
    body = {
        "model": model,
        "max_tokens": 800,
        "messages": [{"role": "user", "content": prompt}]
    }
    if system:
        body["system"] = system
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01"
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["content"][0]["text"].strip()

def call_llm(prompt: str, provider: str = "ollama", api_key: str = None, model: str = None,
             system: str = None, json_schema: dict = None) -> str:
    """Single entry point for every provider.

    `json_schema` is enforced by Ollama; hosted providers get the same JSON
    instructions through the prompt and callers parse tolerantly.
    """
    if provider == "ollama":
        return _call_ollama(prompt, model or "llama3.2", system, json_schema)
    elif provider == "openai":
        return _call_openai(prompt, api_key or os.getenv("OPENAI_API_KEY", ""), model or "gpt-4o-mini", system)
    elif provider == "anthropic":
        return _call_anthropic(prompt, api_key or os.getenv("ANTHROPIC_API_KEY", ""), model or "claude-haiku-4-5-20251001", system)
    raise ValueError(f"Unknown provider: {provider}")

def suggest_chart(columns: list, sample_rows: list, provider: str = "ollama", api_key: str = None, model: str = None) -> dict:
    prompt = build_chart_prompt(columns, sample_rows)
    try:
        response = call_llm(prompt, provider, api_key, model)
        clean = response.replace('```json', '').replace('```', '').strip()
        return json.loads(clean)
    except Exception:
        # Fallback: simple heuristic
        numeric_cols = [c for c in columns if c['type'] in ('integer', 'float', 'REAL', 'INTEGER')]
        text_cols = [c for c in columns if c['type'] not in ('integer', 'float', 'REAL', 'INTEGER')]
        return {
            "chart_type": "bar",
            "x_column": text_cols[0]['name'] if text_cols else columns[0]['name'],
            "y_column": numeric_cols[0]['name'] if numeric_cols else columns[-1]['name'],
            "reason": "Default suggestion"
        }

def detect_joins(schemas: list, provider: str = "ollama", api_key: str = None, model: str = None) -> dict:
    if len(schemas) < 2:
        return {"joins": []}
    prompt = build_join_prompt(schemas)
    try:
        response = call_llm(prompt, provider, api_key, model)
        clean = response.replace('```json', '').replace('```', '').strip()
        return json.loads(clean)
    except Exception:
        return {"joins": []}

def fix_sql(broken_sql: str, schema_context: str, error: str, provider: str = "ollama", api_key: str = None, model: str = None) -> str:
    prompt = build_fix_sql_prompt(broken_sql, schema_context, error)
    return call_llm(prompt, provider, api_key, model)
