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


# ── starter questions ───────────────────────────────────────────────────────
_ID_LIKE = re.compile(r'(^|_)(id|code|zip|phone|key)$|^(id|index)$', re.IGNORECASE)
# Numbers that label rather than measure: summing or averaging them is
# meaningless. Matched against whole words of the column name ("lat" must not
# match "population").
_NOT_MEASURE = {'year', 'month', 'day', 'week', 'hour', 'minute', 'lat', 'latitude', 'lon', 'lng', 'longitude',
                'position', 'rank', 'number', 'lapnumber', 'lap', 'stint', 'age'}
# Measures that make sense as totals, most interesting first.
_ADDITIVE = ['revenue', 'sales', 'amount', 'profit', 'quantity', 'qty', 'orders', 'count', 'value', 'cost',
             'price', 'population', 'total']


def suggest_questions(run, table, columns, dialect='sqlite', limit=5):
    """A few questions that fit this table's columns, for an empty Query page.
    Built from the data (no model call) so they're instant and always valid."""
    qt = quote_ident(table, dialect)
    names, sample = run(f"SELECT * FROM {qt} LIMIT 500")
    index = {n: i for i, n in enumerate(names)}

    numbers, dates, categories, labels = [], [], [], []
    for col in columns:
        name = col['name']
        i = index.get(name)
        vals = [r[i] for r in sample if i is not None and r[i] is not None and r[i] != '']
        if not vals or _ID_LIKE.search(name):
            continue
        if all(isinstance(v, (int, float, Decimal)) and not isinstance(v, bool) for v in vals):
            if set(vals) - {0, 1}:   # 0/1 columns are flags, not measures
                numbers.append(name)
            continue
        strs = [str(v) for v in vals]
        if all(isinstance(v, (datetime.date, datetime.datetime)) for v in vals) or (_date_format(strs) or '').startswith('YYYY'):
            dates.append(name)
        elif not _is_numeric_text(strs):
            distinct = len(set(strs))
            (categories if 2 <= distinct <= 12 else labels).append((distinct, name))

    measures = [n for n in numbers if not _NOT_MEASURE & set(n.lower().split('_'))]

    def additive_rank(name):
        low = name.lower()
        return next((i for i, k in enumerate(_ADDITIVE) if k in low), None)

    additive = sorted((n for n in measures if additive_rank(n) is not None), key=additive_rank)
    total_col = additive[0] if additive else None
    measure = total_col or (measures[0] if measures else None)
    category = min(categories)[1] if categories else None        # fewest distinct values
    label = max(labels)[1] if labels else None                   # most distinct values (names)

    def words(name):
        return name.replace('_', ' ')

    def total_of(name):
        w = words(name)
        return w[0].upper() + w[1:] if w.lower().startswith('total') else f"Total {w}"

    out = []
    if total_col and category:
        out.append(f"{total_of(total_col)} by {words(category)}")
    elif measure and category:
        out.append(f"Average {words(measure)} by {words(category)}")
    if total_col and dates:
        out.append(f"{total_of(total_col)} per month")
    if measure and label:
        out.append(f"Which {words(label)} has the highest {words(measure)}?")
    if category:
        out.append(f"How many records are there for each {words(category)}?")
    if measure:
        out.append(f"What is the average {words(measure)}?")
    out.append("Show the first 10 rows")
    return out[:limit]


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

# When asking back is allowed the model may return a clarifying question
# with 2-4 fully specific rewrites of the user's question as options.
CLARIFY_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["answer", "clarify"]},
        "interpretation": {"type": "string"},
        "sql": {"type": "string"},
        "question": {"type": "string"},
        # Each option names the columns it would use, so options built on
        # columns that don't exist can be dropped before the user sees them.
        "options": {"type": "array", "items": {
            "type": "object",
            "properties": {"question": {"type": "string"}, "columns": {"type": "array", "items": {"type": "string"}}},
            "required": ["question", "columns"],
        }},
    },
    "required": ["status", "interpretation", "sql"],
}

_CLARIFY_RULE = """
14. Ask instead of answering only when the question cannot be answered without choosing between readings that give different results: words like "best", "top", "performs", "doing well" or "biggest" with no measure named while the data has several plausible measures, or no measure at all ("How are we doing?"). Do not ask when the question names its measure, when one reading is clearly the natural one, or because of vague time words (rule 15 covers those).
    To ask: "status": "clarify", "sql": "", "question": a short question to the user, "options": 2 to 4 readings, each {"question": a complete, specific rewrite of their question naming its measure (e.g. "Which region has the highest total revenue?"), "columns": the exact column names from DATABASE that reading uses}.
    Every option must be answerable with the columns listed under DATABASE (never offer a measure the data doesn't have) and must keep the subject of the question (for "Compare the regions": "Compare the regions by total revenue", not just "Total revenue").
    Otherwise "status": "answer"."""

_TIME_RULE = """
15. Vague time words count back from the latest date shown for the date column, not from today: "recent"/"latest"/"newest" = the newest rows; "this year" = the latest year in the data; "this month"/"the most recent month" = the latest month in the data; "last N months" = the N months ending with the latest month in the data."""


def build_system_prompt(dialect='sqlite', allow_clarify=False) -> str:
    d = DIALECTS[dialect]
    clarify = _CLARIFY_RULE if allow_clarify else ""
    interpretation = '"interpretation": "<one plain-English sentence saying how you read the question, including any assumption>"'
    if allow_clarify:
        reply = ('{"status": "answer" or "clarify", ' + interpretation + ', "sql": "<the query, or empty when asking>", '
                 '"question": "<only when asking>", "options": [{"question": "<only when asking>", "columns": ["<column>"]}]}')
    else:
        reply = '{' + interpretation + ', "sql": "<the query>"}'
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
13. If the question is vague, pick the most reasonable reading and say so in "interpretation".
16. Do not add filters the question doesn't ask for (e.g. status = 'Completed'). If you think one would help, mention it in "interpretation" instead of applying it.{clarify}{_TIME_RULE}

Reply with JSON only: {reply}"""


def build_user_prompt(schema_text: str, question: str, previous=None) -> str:
    prompt = f"DATABASE:\n{schema_text}\n\n"
    if previous and previous.get('question'):
        prompt += (f"PREVIOUS QUESTION: {previous['question']}\n"
                   f"PREVIOUS SQL: {previous.get('sql') or '(none)'}\n"
                   "The new question may build on the previous one (\"now only for X\", \"what about 2023\", "
                   "\"use Y instead\", \"and Z as well\"). If it does, adapt the previous SQL. If it is a new, "
                   "self-contained question, ignore the previous one completely.\n\n")
    return prompt + f"QUESTION: {question}"


def parse_model_reply(raw: str) -> dict:
    """{"status", "sql", "interpretation", "question", "options"} from the model's
    reply; tolerant of code fences, prose around the JSON, and non-JSON SQL."""
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
    if not isinstance(obj, dict):
        return {"status": "answer", "sql": extract_sql_from_response(text).rstrip(';').strip(),
                "interpretation": "", "question": "", "options": []}
    # Options: [{"question", "columns"}]; plain strings (hosted providers that
    # ignore the schema) are kept with columns=None, meaning "not checkable".
    options, seen = [], set()
    for o in obj.get('options') if isinstance(obj.get('options'), list) else []:
        if isinstance(o, dict):
            text = str(o.get('question') or '').strip()
            cols = [str(c) for c in o.get('columns')] if isinstance(o.get('columns'), list) else None
        else:
            text, cols = str(o).strip(), None
        if text and text not in seen:
            seen.add(text)
            options.append({"question": text, "columns": cols})
    options = options[:4]
    sql = obj.get('sql') if isinstance(obj.get('sql'), str) else ''
    return {
        "status": 'clarify' if obj.get('status') == 'clarify' else 'answer',
        "sql": sql.strip().rstrip(';').strip(),
        "interpretation": str(obj.get('interpretation') or '').strip(),
        "question": str(obj.get('question') or '').strip(),
        "options": options,
    }


def parse_model_output(raw: str):
    """(sql, interpretation) — the answer-only view of parse_model_reply."""
    reply = parse_model_reply(raw)
    if not reply["sql"] and reply["status"] == 'answer':
        return extract_sql_from_response(raw or '').rstrip(';').strip(), reply["interpretation"]
    return reply["sql"], reply["interpretation"]


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


# ── ambiguity and "today" guards ────────────────────────────────────────────
_EVALUATIVE = re.compile(r'\b(best|worst|top|performs?|performing|performance|doing|biggest|strongest|weakest|leading|'
                         r'compare|comparing|comparison)\b', re.IGNORECASE)
_ADMITS_VAGUE = re.compile(r'\b(vague|ambiguous|unclear|not specif\w*)\b', re.IGNORECASE)
def _measure_columns(tables: list) -> list:
    """Numeric columns that measure something: not IDs, not labels like year
    or position. Most interesting first (revenue, quantity, ...)."""
    cols = [c['name'] for t in tables for c in t['columns']
            if any(k in str(c.get('type', '')).upper() for k in ('INT', 'REAL', 'FLOA', 'DOUB', 'DEC', 'NUM'))
            and not _ID_LIKE.search(c['name'])
            and not _NOT_MEASURE & set(c['name'].lower().split('_'))]

    def rank(name):
        low = name.lower()
        return next((i for i, k in enumerate(_ADDITIVE) if k in low), len(_ADDITIVE))
    return sorted(dict.fromkeys(cols), key=rank)


def alternative_readings(question: str, sql: str, tables: list, limit: int = 3) -> list:
    """Other ways to read a question that names no measure, one per measure the
    answer didn't use: "Show me the best products" answered by revenue offers
    "Show me the best products by quantity". Built from real columns only."""
    used = sql.lower()
    base = question.strip().rstrip('?.! ')
    return [f"{base} by {m.replace('_', ' ')}" for m in _measure_columns(tables) if m.lower() not in used][:limit]


def names_a_measure(question: str, tables: list) -> bool:
    """Does the question mention a numeric column, by name or word stem
    ("revenue" -> total_revenue, "populous" -> population)?"""
    words = {w for w in re.findall(r'[a-z]+', question.lower()) if len(w) >= 3}
    # SQLite (INTEGER, REAL) and MySQL (int, tinyint, decimal, double, ...) type
    # names. ID columns aren't measures ("customers" must not match customer_id).
    numeric = [c['name'] for t in tables for c in t['columns']
               if any(k in str(c.get('type', '')).upper() for k in ('INT', 'REAL', 'FLOA', 'DOUB', 'DEC', 'NUM'))
               and not _ID_LIKE.search(c['name'])]
    for col in numeric:
        for part in col.lower().split('_'):
            if len(part) >= 3 and any(w == part or (len(part) >= 5 and len(w) >= 5 and w[:5] == part[:5]) for w in words):
                return True
    return False


def looks_ambiguous(question: str, interpretation: str, tables: list) -> bool:
    if _ADMITS_VAGUE.search(interpretation or ''):
        return True
    return bool(_EVALUATIVE.search(question)) and not names_a_measure(question, tables)


# The question really is about the calendar date, so 'now' is right.
_MEANS_TODAY = re.compile(r'\b(today|now|current date|this week)\b', re.IGNORECASE)
_RANGE_END = re.compile(r"dates formatted YYYY-MM-DD[^,]*, from '[^']*' to '(\d{4}-\d{2}-\d{2})")
_NOW = re.compile(r"'now'|\bCURRENT_DATE\b|\bCURRENT_TIMESTAMP\b", re.IGNORECASE)


def latest_date(schema_text: str):
    """Latest date in the described tables (ISO date columns), or None."""
    ends = _RANGE_END.findall(schema_text)
    return max(ends) if ends else None


def anchor_now(sql: str, latest: str) -> str:
    """Rule 15 in code: relative dates count back from the data, not today.
    date('now', '-3 months') -> date('2024-12-27', '-3 months')."""
    return _NOW.sub(f"'{latest}'", sql)


def grounded_options(options: list, tables: list) -> list:
    """Option texts whose columns all exist in `tables`. Options that name a
    column the data doesn't have ("customer_satisfaction") are dropped."""
    known = {c['name'].lower() for t in tables for c in t['columns']}
    keep = []
    for o in options:
        cols = o.get('columns')
        # "sales_data.total_revenue" -> "total_revenue"
        if cols is None or all(str(c).split('.')[-1].strip('"`[] ').lower() in known for c in cols):
            keep.append(o['question'])
    return keep


def complete_options(question: str, options: list) -> list:
    """Each option is asked on its own when clicked, so it must stand alone.
    Fragments like "Total revenue" are completed with the original question
    ("Compare the regions by total revenue")."""
    base = question.strip().rstrip('?.! ')
    out = []
    for o in options:
        o = o.strip()
        if len(o.split()) < 4:
            o = f"{base} by {o[0].lower() + o[1:] if o[:1].isupper() and not o[1:2].isupper() else o}"
        out.append(o)
    return list(dict.fromkeys(out))


# ── pipeline ────────────────────────────────────────────────────────────────
def answer(question, tables, run, dialect='sqlite', provider='ollama', api_key=None, model=None,
           cache_key=None, max_rows=None, previous=None, allow_clarify=True):
    """Answer `question` over `tables` ([{"table_name", "columns"}]).

    Returns {sql, interpretation, columns, rows, truncated, attempts, schema};
    with `max_rows`, at most that many rows come back and `truncated` says
    whether there were more. When the question is ambiguous and
    `allow_clarify` is set, nothing runs and the result carries
    "clarification": {"question", "options"} instead. `previous` ({"question",
    "sql"}) lets a follow-up build on the last answer.
    Raises NLQueryError when no working query is produced.
    """
    include_values = share_values_with(provider)
    schema_text = '\n\n'.join(
        describe_table(run, t['table_name'], t['columns'], dialect, include_values, cache_key) for t in tables
    )
    prompt = build_user_prompt(schema_text, question, previous)
    attempts = []

    def ask(p, clarify_ok=False):
        try:
            raw = call_llm(p, provider, api_key, model,
                           system=build_system_prompt(dialect, clarify_ok),
                           json_schema=CLARIFY_RESPONSE_SCHEMA if clarify_ok else RESPONSE_SCHEMA)
        except Exception as e:
            raise NLQueryError('llm', f"LLM error: {e}", attempts=attempts)
        return parse_model_reply(raw)

    offer_alternatives = False

    def result(sql, interp, cols, rows):
        truncated = bool(max_rows) and len(rows) > max_rows
        out = {"sql": sql, "interpretation": interp, "columns": cols,
               "rows": rows[:max_rows] if truncated else rows, "truncated": truncated,
               "attempts": attempts, "schema": schema_text}
        if offer_alternatives and sql:
            alternatives = alternative_readings(question, sql, tables)
            if alternatives:
                out["alternatives"] = alternatives
        return out

    reply = ask(prompt, allow_clarify)
    options = grounded_options(reply["options"], tables) if reply["status"] == 'clarify' else []
    if allow_clarify and len(options) >= 2:
        out = result("", reply["interpretation"], [], [])
        # Fixed heading: the model's own "question" is often a restatement of
        # one option, which reads like an answer above the choices.
        out["clarification"] = {"question": "Which did you mean?",
                                "options": complete_options(question, options)}
        return out
    if not reply["sql"]:
        # Asked without usable options, or replied without a query: answer instead.
        reply = ask(prompt)
    # A question that names no measure (or that the model itself called vague)
    # gets answered with the natural reading, plus the other readings offered
    # as one-click alternatives (built from real columns, see alternative_readings).
    offer_alternatives = allow_clarify and looks_ambiguous(question, reply["interpretation"], tables)
    sql, interp = reply["sql"], reply["interpretation"]
    latest = latest_date(schema_text) if dialect == 'sqlite' and not _MEANS_TODAY.search(question) else None
    fallback = None   # a valid-but-empty result, kept in case the repair does worse
    stage = problem = None
    for attempt in range(MAX_REPAIRS + 1):
        if dialect == 'sqlite':
            sql = fix_date_like(sql)
            if latest:
                sql = anchor_now(sql, latest)
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
        repaired = ask(prompt + _repair_note(sql, problem, stage, dialect))
        sql, interp = repaired["sql"], repaired["interpretation"]

    if fallback is not None:
        return fallback
    raise NLQueryError(stage, problem, sql, interp, attempts)
