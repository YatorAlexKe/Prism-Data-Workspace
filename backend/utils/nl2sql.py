"""Natural-language -> SQL pipeline.

Shared by /api/query, /api/query/multi-table and MySQL connections so every
path gets the same grounding, prompt, validation and repair:

  1. Describe each table with what's really in it: category values, number
     and date ranges, date formats, numbers stored as text.
  2. Ask the model for JSON {"interpretation", "sql"}.
  3. Validate, execute; on an error (or an empty result from a text filter)
     give the model one repair attempt with the database's own message.
"""
import datetime
import json
import os
import re
import time
from decimal import Decimal

from utils.llm import call_llm
from utils.sql_validator import validate_sql, extract_sql_from_response

MAX_CATEGORY_VALUES = 25   # list every value for text columns with at most this many
SAMPLE_ROWS = 2000         # rows read to infer formats and examples
MAX_REPAIRS = 1


class NLQueryError(Exception):
    """A question could not be turned into a working query."""

    def __init__(self, stage, message, sql=None, interpretation=None, attempts=None):
        super().__init__(message)
        self.stage = stage            # llm | validation | execution
        self.message = message
        self.sql = sql
        self.interpretation = interpretation
        self.attempts = attempts or []


# ── schema questions ────────────────────────────────────────────────────────
# Answered from the schema without the model, but only when the question is
# *about* the table's structure. Every word must be a schema word or filler,
# so "products available in Electronics" or "describe revenue by category"
# still go to the model.
_SCHEMA_WORDS = {'column', 'columns', 'field', 'fields', 'schema', 'structure'}
_FILLER = {
    'what', 'whats', 'which', 'show', 'list', 'give', 'tell', 'get', 'see', 'display', 'describe',
    'me', 'us', 'the', 'all', 'are', 'is', 'there', 'of', 'in', 'this', 'that', 'these', 'those',
    'does', 'do', 'data', 'dataset', 'table', 'tables', 'available', 'have', 'has', 'it', 'its',
    'a', 'an', 'name', 'names', 'type', 'types', 'exist', 'and', 'with', 'their', 'my', 'our',
    'please', 'can', 'you', 'i', 'kind', 'kinds', 'contain', 'contains', 'here',
}


def is_schema_question(question: str) -> bool:
    words = re.findall(r"[a-z]+", question.lower().replace("'", ""))
    if not words or any(w not in _FILLER and w not in _SCHEMA_WORDS for w in words):
        return False
    if any(w in _SCHEMA_WORDS for w in words):
        return True
    # "describe the table", "what is in this dataset"
    return ('describe' in words or 'what' in words) and any(w in ('table', 'dataset', 'data') for w in words)


# ── dialects ────────────────────────────────────────────────────────────────
DIALECTS = {
    'sqlite': {
        'name': 'SQLite',
        'quote': '"',
        'dates': ("Dates are stored as text. Year: strftime('%Y', col) = '2024'. Month: strftime('%Y-%m', col) "
                  "= '2024-10', or GROUP BY strftime('%Y-%m', col). Never put format codes like %m inside LIKE, "
                  "and do not use EXTRACT, YEAR(), MONTH() or DATE_FORMAT."),
    },
    'mysql': {
        'name': 'MySQL',
        'quote': '`',
        'dates': ("Use YEAR(col), MONTH(col) and DATE_FORMAT(col, '%Y-%m'). Do not use strftime. "
                  "For dates stored as text in a non-ISO format, convert with STR_TO_DATE first."),
    },
}


def quote_ident(name: str, dialect: str) -> str:
    q = DIALECTS[dialect]['quote']
    return f"{q}{str(name).replace(q, q + q)}{q}"


# ── runners: run(sql, max_rows=None) -> (column_names, rows_as_tuples) ──────
def sqlite_runner(conn):
    def run(sql, max_rows=None):
        cur = conn.execute(sql)
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchmany(max_rows) if max_rows else cur.fetchall()
        return cols, [tuple(r) for r in rows]
    return run


def mysql_runner(conn, default_max_rows=10000):
    conn.cursor().execute("SET SESSION TRANSACTION READ ONLY")

    def run(sql, max_rows=None):
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchmany(max_rows or default_max_rows)
        cols = [d[0] for d in cur.description] if cur.description else []
        return cols, [tuple(r.values()) if isinstance(r, dict) else tuple(r) for r in rows]
    return run


# ── describing tables ───────────────────────────────────────────────────────
_ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_ISO_DATETIME = re.compile(r'^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?')
_SLASH_DATE = re.compile(r'^(\d{1,2})/(\d{1,2})/(\d{4})$')
_NUMERIC_TEXT = re.compile(r'^\s*[-+]?[$€£]?\s*(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?\s*%?\s*$')


def _date_format(values):
    """Return a human description of the date format, or None."""
    def share(pattern):
        return sum(1 for v in values if pattern.match(v)) / len(values)
    if share(_ISO_DATE) >= 0.9:
        return 'YYYY-MM-DD'
    if share(_ISO_DATETIME) >= 0.9:
        return 'YYYY-MM-DD HH:MM:SS'
    if share(_SLASH_DATE) >= 0.9:
        parts = [_SLASH_DATE.match(v) for v in values if _SLASH_DATE.match(v)]
        if any(int(m.group(1)) > 12 for m in parts):
            return 'DD/MM/YYYY'
        if any(int(m.group(2)) > 12 for m in parts):
            return 'MM/DD/YYYY'
        return 'MM/DD/YYYY or DD/MM/YYYY (ambiguous)'
    return None


def _is_numeric_text(values):
    hits = [v for v in values if re.search(r'\d', v) and _NUMERIC_TEXT.match(v)]
    return len(hits) >= 0.95 * len(values)


def _fmt(v):
    if isinstance(v, Decimal):
        v = float(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else f"{round(v, 4)}"
    if isinstance(v, int):
        return str(v)
    s = str(v)
    s = s if len(s) <= 40 else s[:37] + '...'
    return "'" + s.replace("'", "''") + "'"


# Descriptions are cached: building one reads the table, which is slow on
# large datasets. Entries expire after DESCRIBE_TTL seconds, and local writes
# (import, edit, delete) clear them through invalidate_description().
DESCRIBE_TTL = 600
_describe_cache = {}


def invalidate_description(table=None):
    for key in [k for k in _describe_cache if table is None or k[1] == table]:
        del _describe_cache[key]


def describe_table(run, table, columns, dialect='sqlite', include_values=True, cache_key=None):
    """Schema text for the prompt. `columns` is [{"name", "type"}].

    `cache_key` names the database (e.g. 'sqlite', 'mysql:3'); without one
    the description is rebuilt every time.
    """
    if not include_values:
        lines = [f"Table: {table}", "Columns:"]
        lines += [f"  - {c['name']} ({c['type']})" for c in columns]
        return '\n'.join(lines)

    key = (cache_key, table, dialect, tuple((c['name'], c['type']) for c in columns))
    hit = _describe_cache.get(key) if cache_key else None
    if hit and time.time() - hit[0] < DESCRIBE_TTL:
        return hit[1]
    text = _describe(run, table, columns, dialect)
    if cache_key:
        _describe_cache[key] = (time.time(), text)
    return text


def _describe(run, table, columns, dialect):
    qt = quote_ident(table, dialect)
    names, sample = run(f"SELECT * FROM {qt} LIMIT {SAMPLE_ROWS}")
    index = {n: i for i, n in enumerate(names)}

    # Classify each column from the sample, collecting the MIN/MAX
    # aggregates so the whole table is scanned once, not once per column.
    plan, aggs = [], ["COUNT(*)"]
    for col in columns:
        name = col['name']
        qc = quote_ident(name, dialect)
        i = index.get(name)
        vals = [r[i] for r in sample if i is not None and r[i] is not None and r[i] != '']
        if not vals:
            plan.append((col, 'empty', None))
        elif all(isinstance(v, (int, float, Decimal)) and not isinstance(v, bool) for v in vals):
            plan.append((col, 'number', len(aggs)))
            aggs += [f"MIN({qc})", f"MAX({qc})"]
        elif all(isinstance(v, (datetime.date, datetime.datetime)) for v in vals):
            # Native DATE/DATETIME columns (MySQL); dialect date functions apply directly.
            plan.append((col, 'native_date', len(aggs)))
            aggs += [f"MIN({qc})", f"MAX({qc})"]
        else:
            strs = [str(v) for v in vals]
            date_fmt = _date_format(strs)
            if date_fmt and date_fmt.startswith('YYYY'):
                plan.append((col, 'iso_date', (len(aggs), date_fmt)))
                aggs += [f"MIN(NULLIF({qc}, ''))", f"MAX(NULLIF({qc}, ''))"]
            elif date_fmt:
                plan.append((col, 'other_date', (date_fmt, strs[0])))
            elif _is_numeric_text(strs):
                plan.append((col, 'numeric_text', strs))
            else:
                plan.append((col, 'text', strs))

    agg = run(f"SELECT {', '.join(aggs)} FROM {qt}")[1][0]
    lines = [f"Table: {table} ({agg[0]} rows)", "Columns:"]

    for col, kind, info in plan:
        name, qc = col['name'], quote_ident(col['name'], dialect)
        line = f"  - {name} ({col['type']})"
        if kind == 'empty':
            lines.append(line + ": empty")
        elif kind == 'number':
            lines.append(line + f": numbers from {_fmt(agg[info])} to {_fmt(agg[info + 1])}")
        elif kind == 'native_date':
            lines.append(line + f": dates from {_fmt(str(agg[info]))} to {_fmt(str(agg[info + 1]))}")
        elif kind == 'iso_date':
            at, date_fmt = info
            lines.append(line + f": dates formatted {date_fmt}, from {_fmt(agg[at])} to {_fmt(agg[at + 1])}")
        elif kind == 'other_date':
            date_fmt, example = info
            lines.append(line + f": dates formatted {date_fmt}, e.g. {_fmt(example)}")
        elif kind == 'numeric_text':
            examples = ', '.join(_fmt(s) for s in info[:3])
            note = f"numbers stored as text, e.g. {examples} - use CAST({name} AS REAL) for math, sorting and comparisons"
            if any(re.search(r'[$€£,%]', s) for s in info):
                note += " (strip symbols like $ , % with REPLACE first)"
            lines.append(line + ": " + note)
        else:
            distinct = [r[0] for r in run(
                f"SELECT DISTINCT {qc} FROM {qt} WHERE {qc} IS NOT NULL AND {qc} <> '' LIMIT {MAX_CATEGORY_VALUES + 1}"
            )[1]]
            if len(distinct) <= MAX_CATEGORY_VALUES:
                values = ', '.join(_fmt(v) for v in sorted(distinct, key=str))
                lines.append(line + f": one of {values}")
            else:
                seen = list(dict.fromkeys(info))[:3]
                lines.append(line + f": text, e.g. {', '.join(_fmt(s) for s in seen)}")
    return '\n'.join(lines)


def share_values_with(provider: str) -> bool:
    """Sample values stay on the machine for local models. Hosted providers get
    them only when the operator opts in (PRISM_SHARE_SAMPLE_VALUES=1)."""
    if provider == 'ollama':
        return True
    return os.getenv('PRISM_SHARE_SAMPLE_VALUES', '').strip().lower() in ('1', 'true', 'yes')


# ── prompt ──────────────────────────────────────────────────────────────────
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "interpretation": {"type": "string"},
        "sql": {"type": "string"},
    },
    "required": ["interpretation", "sql"],
}


def build_system_prompt(dialect='sqlite') -> str:
    d = DIALECTS[dialect]
    return f"""You turn questions about data into one {d['name']} query.

Rules:
1. Write one read-only query: SELECT, or WITH ... SELECT. Never change data.
2. Use only the tables and columns listed under DATABASE.
3. When a column lists its values ("one of ..."), filter with the exact spelling shown, e.g. 'North' not 'north'. For other text, compare case-insensitively with LOWER() or LIKE.
4. Dates: match the format listed for the column. {d['dates']}
5. A column marked "numbers stored as text" must be CAST to a number before math, sorting or comparing.
6. Put identifying columns next to computed values (e.g. the product name beside its profit).
7. Ranking or comparing things that repeat across rows (products, regions, categories, customers): GROUP BY that column and aggregate, e.g. SUM(revenue) per product. "Sold the most <items>" counts units: use a quantity column when there is one.
8. Asking for individual records ("the 10 most recent orders"): return those rows, not counts.
9. Listing the values of a column ("products in Electronics", "countries in Asia"): SELECT DISTINCT.
10. Percentages: 100.0 * part / total.
11. Rankings: ORDER BY explicitly. "Top"/"best" without a number means LIMIT 10; "which ... the most" means LIMIT 1.
12. Give computed columns readable aliases, e.g. total_revenue, order_count.
13. If the question is vague, pick the most reasonable reading.

Reply with JSON only: {{"interpretation": "<one plain-English sentence saying how you read the question, including any assumption>", "sql": "<the query>"}}"""


def build_user_prompt(schema_text: str, question: str) -> str:
    return f"DATABASE:\n{schema_text}\n\nQUESTION: {question}"


def parse_model_output(raw: str):
    """(sql, interpretation) from the model's reply; tolerant of fences and prose."""
    text = (raw or '').strip()
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
    obj = None
    try:
        obj = json.loads(text)
    except ValueError:
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            try:
                obj = json.loads(m.group(0))
            except ValueError:
                obj = None
    if isinstance(obj, dict) and isinstance(obj.get('sql'), str) and obj['sql'].strip():
        return obj['sql'].strip().rstrip(';').strip(), str(obj.get('interpretation') or '').strip()
    return extract_sql_from_response(text).rstrip(';').strip(), ''


def _repair_note(sql, problem, stage, dialect):
    name = DIALECTS[dialect]['name']
    if stage == 'empty':
        detail = ("It ran but returned no rows. If it filters on text, check the spelling and case "
                  "against the listed values and the date format. If no rows is genuinely correct, "
                  "return the same query.")
    else:
        detail = f"It failed with this {name} error:\n{problem}"
    return f"\n\nYour previous query was:\n{sql}\n{detail}\nReturn a corrected query in the same JSON format."


# Small models often write strftime codes into a LIKE pattern
# (order_date LIKE '2024-%m-%d'), which matches nothing. In LIKE, % is
# already "anything", so the intended pattern is just the literal prefix.
_DATE_CODE_LIKE = re.compile(r"(\bLIKE\s+)'(\d{4})((?:-\d{2})?)-%[YmdHMS](?:-%[YmdHMS])*(?:\s+%[HMS](?::%[HMS])*)?'",
                             re.IGNORECASE)


def fix_date_like(sql: str) -> str:
    return _DATE_CODE_LIKE.sub(lambda m: f"{m.group(1)}'{m.group(2)}{m.group(3)}-%'", sql)


def _filters_on_text(sql: str) -> bool:
    return bool(re.search(r"\b(WHERE|HAVING)\b.*('[^']*'|\bLIKE\b)", sql, re.IGNORECASE | re.DOTALL))


# ── pipeline ────────────────────────────────────────────────────────────────
def answer(question, tables, run, dialect='sqlite', provider='ollama', api_key=None, model=None,
           cache_key=None, max_rows=None):
    """Answer `question` over `tables` ([{"table_name", "columns"}]).

    Returns {sql, interpretation, columns, rows, truncated, attempts, schema};
    with `max_rows`, at most that many rows come back and `truncated` says
    whether there were more. Raises NLQueryError when no working query is produced.
    """
    include_values = share_values_with(provider)
    schema_text = '\n\n'.join(
        describe_table(run, t['table_name'], t['columns'], dialect, include_values, cache_key) for t in tables
    )
    system = build_system_prompt(dialect)
    prompt = build_user_prompt(schema_text, question)
    attempts = []

    def ask(p):
        try:
            raw = call_llm(p, provider, api_key, model, system=system, json_schema=RESPONSE_SCHEMA)
        except Exception as e:
            raise NLQueryError('llm', f"LLM error: {e}", attempts=attempts)
        return parse_model_output(raw)

    def result(sql, interp, cols, rows):
        truncated = bool(max_rows) and len(rows) > max_rows
        return {"sql": sql, "interpretation": interp, "columns": cols,
                "rows": rows[:max_rows] if truncated else rows, "truncated": truncated,
                "attempts": attempts, "schema": schema_text}

    sql, interp = ask(prompt)
    fallback = None   # a valid-but-empty result, kept in case the repair does worse
    stage = problem = None
    for attempt in range(MAX_REPAIRS + 1):
        if dialect == 'sqlite':
            sql = fix_date_like(sql)
        ok, reason = validate_sql(sql)
        if not ok:
            stage, problem = 'validation', f"SQL validation failed: {reason}"
        else:
            try:
                cols, rows = run(sql, max_rows + 1 if max_rows else None)
            except Exception as e:
                stage, problem = 'execution', f"SQL execution error: {e}"
            else:
                if rows or fallback is not None or not _filters_on_text(sql):
                    return result(sql, interp, cols, rows)
                fallback = result(sql, interp, cols, rows)
                stage, problem = 'empty', "The query returned no rows."
        attempts.append({"sql": sql, "stage": stage, "error": problem})
        if attempt == MAX_REPAIRS:
            break
        sql, interp = ask(prompt + _repair_note(sql, problem, stage, dialect))

    if fallback is not None:
        return fallback
    raise NLQueryError(stage, problem, sql, interp, attempts)
