import pandas as pd
import io
import json
import re
import requests
from utils.sql_validator import sanitize_column_name, sanitize_table_name

def parse_csv(content: bytes) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(content))

def parse_excel(content: bytes, sheet_name=0) -> tuple:
    xl = pd.ExcelFile(io.BytesIO(content))
    sheets = xl.sheet_names
    df = pd.read_excel(io.BytesIO(content), sheet_name=sheet_name)
    return df, sheets

def parse_json(content: bytes) -> pd.DataFrame:
    data = json.loads(content.decode('utf-8'))
    if isinstance(data, list):
        df = pd.json_normalize(data)
    elif isinstance(data, dict):
        # Try to find the main array in the dict
        for key, val in data.items():
            if isinstance(val, list) and len(val) > 0:
                df = pd.json_normalize(val)
                break
        else:
            df = pd.json_normalize([data])
    else:
        raise ValueError("Unsupported JSON structure")
    return df

def parse_url(url: str) -> pd.DataFrame:
    # Handle Google Sheets
    if 'docs.google.com/spreadsheets' in url:
        # Convert to CSV export URL
        if '/edit' in url:
            url = url.split('/edit')[0]
        if not url.endswith('/export'):
            url = url.rstrip('/') + '/export?format=csv'
    
    headers = {'User-Agent': 'Mozilla/5.0'}
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    
    content_type = response.headers.get('content-type', '')
    content = response.content
    
    if 'json' in content_type:
        return parse_json(content)
    elif 'excel' in content_type or url.endswith('.xlsx'):
        df, _ = parse_excel(content)
        return df
    else:
        # Default to CSV
        return pd.read_csv(io.BytesIO(content))

def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    # Sanitize column names
    df.columns = [sanitize_column_name(c) for c in df.columns]
    # Deduplicate — sanitization can collide ("Total ($)" + "Total (%)" → "total"),
    # and OCR can yield repeated header text. Duplicate column labels make
    # df[col] return a DataFrame instead of a Series, which crashes downstream.
    df.columns = _dedupe_columns(df.columns)
    # Blank strings (common in Sheets/OCR) are missing values, not text.
    for col in df.columns:
        if _is_text(df[col]):
            df[col] = df[col].map(lambda v: None if isinstance(v, str) and not v.strip() else v)
    # Remove fully empty rows
    df = df.dropna(how='all')
    # Numbers that arrived as text ("98.58", "$1,234", "45%") become real
    # numbers, so SQL sorts and compares them numerically.
    for col in df.columns:
        if _is_text(df[col]):
            converted = _coerce_numeric(df[col])
            if converted is not None:
                df[col] = converted
    # Limit to 500k rows for performance
    if len(df) > 500000:
        df = df.head(500000)
    return df

def _is_text(series: pd.Series) -> bool:
    # object (pandas < 3) or the dedicated string dtype (pandas >= 3)
    return series.dtype == object or pd.api.types.is_string_dtype(series.dtype)


_THOUSANDS = re.compile(r'^-?\d{1,3}(,\d{3})+(\.\d+)?$')
_PLAIN_NUMBER = re.compile(r'^-?(\d+\.?\d*|\.\d+)$')


def _parse_number(value):
    """Float for number-like text, else None. Percent signs are dropped
    (45% -> 45). Leading-zero codes like '00123' are not numbers."""
    if not isinstance(value, str):
        return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None
    s = value.strip().replace(' ', '')
    if s.endswith('%'):
        s = s[:-1]
    if s[:1] in '$€£':
        s = s[1:]
    elif s[:2] in ('-$', '-€', '-£'):
        s = '-' + s[2:]
    if _THOUSANDS.match(s):
        s = s.replace(',', '')
    if not _PLAIN_NUMBER.match(s) or re.match(r'^-?0\d', s):
        return None
    return float(s)


def _coerce_numeric(series: pd.Series):
    """Numeric version of a text column if every non-missing value parses."""
    present = series.dropna()
    if present.empty:
        return None
    parsed = present.map(_parse_number)
    if parsed.isna().any():
        return None
    out = series.map(lambda v: None if pd.isna(v) else _parse_number(v)).astype('float64')
    if out.dropna().map(float.is_integer).all():
        return out.astype('Int64')
    return out


def _dedupe_columns(cols) -> list:
    seen = {}
    out = []
    for c in cols:
        if c not in seen:
            seen[c] = 0
            out.append(c)
        else:
            seen[c] += 1
            out.append(f"{c}_{seen[c]}")
    return out

def get_col_type(series: pd.Series) -> str:
    dtype = str(series.dtype)
    if 'int' in dtype:
        return 'integer'
    elif 'float' in dtype:
        return 'float'
    elif 'datetime' in dtype:
        return 'datetime'
    elif 'bool' in dtype:
        return 'boolean'
    else:
        return 'text'

def get_schema(df: pd.DataFrame, table_name: str) -> list:
    schema = []
    for col in df.columns:
        schema.append({
            "name": col,
            "type": get_col_type(df[col])
        })
    return schema
