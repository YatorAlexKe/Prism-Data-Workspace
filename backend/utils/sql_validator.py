import re

BLOCKED_PATTERNS = [
    r'\bDROP\b', r'\bDELETE\b', r'\bINSERT\b', r'\bUPDATE\b',
    r'\bALTER\b', r'\bCREATE\b', r'\bTRUNCATE\b', r'\bEXEC\b',
    r'\bEXECUTE\b', r'\bGRANT\b', r'\bREVOKE\b', r'\bATTACH\b',
    r'\bDETACH\b', r'--', r';\s*SELECT', r'\bPRAGMA\b'
]

RESERVED_WORDS = {
    'index', 'select', 'from', 'where', 'table', 'order', 'group',
    'by', 'limit', 'join', 'on', 'as', 'and', 'or', 'not', 'in',
    'is', 'null', 'case', 'when', 'then', 'else', 'end', 'with',
    'insert', 'update', 'delete', 'drop', 'create', 'alter', 'add',
    'column', 'primary', 'key', 'foreign', 'references', 'unique',
    'default', 'values', 'into', 'set', 'having', 'distinct', 'union'
}

def validate_sql(sql: str):
    upper = sql.upper().strip()
    if not upper.startswith("SELECT"):
        return False, "Only SELECT queries are allowed."
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, upper, re.IGNORECASE):
            return False, f"Blocked SQL operation detected."
    if sql.count(';') > 1 or (sql.count(';') == 1 and not sql.strip().endswith(';')):
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
    patterns = [
        r'```sql\s*(.*?)\s*```',
        r'```\s*(SELECT.*?)\s*```',
        r'(SELECT\s+.*?)(?:\n\n|$)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            return match.group(1).strip()
    lines = text.split('\n')
    sql_lines = []
    in_sql = False
    for line in lines:
        if re.match(r'\s*SELECT\b', line, re.IGNORECASE):
            in_sql = True
        if in_sql:
            sql_lines.append(line)
            if line.strip().endswith(';'):
                break
    if sql_lines:
        return '\n'.join(sql_lines).strip().rstrip(';')
    return text.strip()
