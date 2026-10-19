import re

# Comments are stripped before these run (see strip_sql_comments), so a
# commented query is checked on its real content instead of being rejected.
BLOCKED_PATTERNS = [
    r'\bDROP\b', r'\bDELETE\b', r'\bINSERT\b', r'\bUPDATE\b',
    r'\bALTER\b', r'\bCREATE\b', r'\bTRUNCATE\b', r'\bEXEC\b',
    r'\bEXECUTE\b', r'\bGRANT\b', r'\bREVOKE\b', r'\bATTACH\b',
    r'\bDETACH\b', r';\s*SELECT', r'\bPRAGMA\b', r'\bREPLACE\s+INTO\b'
]

RESERVED_WORDS = {
    'index', 'select', 'from', 'where', 'table', 'order', 'group',
    'by', 'limit', 'join', 'on', 'as', 'and', 'or', 'not', 'in',
    'is', 'null', 'case', 'when', 'then', 'else', 'end', 'with',
    'insert', 'update', 'delete', 'drop', 'create', 'alter', 'add',
    'column', 'primary', 'key', 'foreign', 'references', 'unique',
    'default', 'values', 'into', 'set', 'having', 'distinct', 'union'
}

def _split_quoted(sql: str):
    """Yield (chunk, in_quote) pieces so callers can skip string literals."""
    out, buf, quote = [], [], None
    i = 0
    while i < len(sql):
        ch = sql[i]
        if quote:
            buf.append(ch)
            if ch == quote:
                if i + 1 < len(sql) and sql[i + 1] == quote:  # escaped '' or ""
                    buf.append(sql[i + 1])
                    i += 1
                else:
                    out.append((''.join(buf), True))
                    buf, quote = [], None
        elif ch in ("'", '"', '`'):
            if buf:
                out.append((''.join(buf), False))
            buf, quote = [ch], ch
        else:
            buf.append(ch)
        i += 1
    if buf:
        out.append((''.join(buf), quote is not None))
    return out


def strip_sql_comments(sql: str) -> str:
    """Remove -- and /* */ comments that sit outside string literals."""
    parts = []
    for chunk, quoted in _split_quoted(sql):
        if not quoted:
            chunk = re.sub(r'/\*.*?\*/', ' ', chunk, flags=re.DOTALL)
            chunk = re.sub(r'--[^\n]*', ' ', chunk)
        parts.append(chunk)
    return ''.join(parts).strip()


def _cut_after_statement(sql: str) -> str:
    """Keep everything up to the first ';' outside quotes (drops trailing prose)."""
    kept = []
    for chunk, quoted in _split_quoted(sql):
        if not quoted and ';' in chunk:
            kept.append(chunk.split(';', 1)[0])
            return ''.join(kept).strip()
        kept.append(chunk)
    return ''.join(kept).strip()


def validate_sql(sql: str):
    sql = strip_sql_comments(sql)
    upper = sql.upper().strip()
    # Read-only queries only: SELECT, or a CTE (WITH ... SELECT).
    if not (upper.startswith("SELECT") or upper.startswith("WITH")):
        return False, "Only SELECT queries are allowed."
    unquoted = ''.join(c for c, q in _split_quoted(upper) if not q)
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, unquoted, re.IGNORECASE):
            return False, "Blocked SQL operation detected."
    semis = unquoted.count(';')
    if semis > 1 or (semis == 1 and not unquoted.rstrip().endswith(';')):
        return False, "Multiple SQL statements are not allowed."
    return True, "OK"

def sanitize_column_name(col: str) -> str:
    col = re.sub(r'[^a-zA-Z0-9_]', '_', str(col))
    col = re.sub(r'_+', '_', col).strip('_').lower()
    if not col or col[0].isdigit():
        col = 'col_' + col
    if col in RESERVED_WORDS:
        col = 'col_' + col
    return col

def sanitize_table_name(name: str) -> str:
    name = re.sub(r'[^a-zA-Z0-9_]', '_', name)
    name = re.sub(r'_+', '_', name).strip('_').lower()
    if not name or name[0].isdigit():
        name = 'tbl_' + name
    return name[:50]

def extract_sql_from_response(text: str) -> str:
    """Pull one SQL statement out of free-form model output.

    Fallback path only — the NL pipeline asks for JSON first. Handles fenced
    blocks, CTEs (WITH ...), and explanation text after the statement.
    """
    patterns = [
        r'```sql\s*(.*?)\s*```',
        r'```\s*((?:WITH|SELECT)\b.*?)\s*```',
        r'((?:WITH|SELECT)\s+.*?)(?:\n\s*\n|$)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            return _cut_after_statement(match.group(1).strip())
    return _cut_after_statement(text.strip())
