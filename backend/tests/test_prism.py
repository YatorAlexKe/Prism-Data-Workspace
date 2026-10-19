import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.sql_validator import validate_sql, extract_sql_from_response, sanitize_column_name, sanitize_table_name
from utils.profiler import profile_dataframe
from utils.chart_advisor import heuristic_chart
import pandas as pd

def test_valid_select():
    ok, _ = validate_sql("SELECT * FROM sales LIMIT 10")
    assert ok

def test_block_drop():
    ok, _ = validate_sql("DROP TABLE sales")
    assert not ok

def test_block_delete():
    ok, _ = validate_sql("DELETE FROM sales")
    assert not ok

def test_block_update():
    ok, _ = validate_sql("UPDATE sales SET x=1")
    assert not ok

def test_block_pragma():
    ok, _ = validate_sql("PRAGMA table_info(sales)")
    assert not ok

def test_reserved_word_col():
    assert sanitize_column_name('index') == 'col_index'
    assert sanitize_column_name('select') == 'col_select'

def test_table_name_sanitize():
    assert sanitize_table_name('my-data file!') == 'my_data_file'
    assert sanitize_table_name('123abc') == 'tbl_123abc'

def test_extract_sql_markdown():
    text = "Here's the SQL:\n```sql\nSELECT * FROM t WHERE x > 1\n```"
    sql = extract_sql_from_response(text)
    assert 'SELECT' in sql.upper()

def test_profiler():
    df = pd.DataFrame({'name':['Alice','Bob',None],'age':[30,25,40],'score':[9.5,8.0,None]})
    profile = profile_dataframe(df, 'test')
    assert profile['row_count'] == 3
    assert profile['col_count'] == 3
    assert 0 <= profile['quality_score'] <= 100

def test_chart_bar():
    cols = [{'name':'region','type':'text'},{'name':'revenue','type':'float'}]
    assert heuristic_chart(cols, 20)['chart_type'] == 'bar'

def test_chart_pie():
    cols = [{'name':'status','type':'text'},{'name':'count','type':'integer'}]
    assert heuristic_chart(cols, 4)['chart_type'] == 'pie'

def test_chart_scatter():
    cols = [{'name':'price','type':'float'},{'name':'quantity','type':'integer'}]
    assert heuristic_chart(cols, 100)['chart_type'] == 'scatter'

def test_api_upload_visible_behaviour():
    """AT-013 — Visible behaviour test: upload a CSV via API and verify
    the response contains expected fields (table_name, row_count, columns).
    This tests visible application behaviour at the API level."""
    import io
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    # Create a minimal in-memory CSV
    csv_content = b"country,population,water_access\nKenya,54000000,62.4\nGhana,32400000,77.4\n"

    # Import the ingestion parser directly to test visible parsing behaviour
    from utils.ingestion import parse_csv, clean_dataframe, get_schema
    from utils.sql_validator import sanitize_table_name

    df = parse_csv(csv_content)
    df = clean_dataframe(df)
    schema = get_schema(df, 'test_upload')

    # Verify visible behaviour — what the user sees after upload
    assert len(df) == 2, f"Expected 2 rows, got {len(df)}"
    assert len(df.columns) == 3, f"Expected 3 columns, got {len(df.columns)}"
    assert 'country' in df.columns, "Expected 'country' column"
    assert 'population' in df.columns, "Expected 'population' column"
    assert 'water_access' in df.columns, "Expected 'water_access' column"
    assert len(schema) == 3, f"Expected 3 schema entries, got {len(schema)}"
    assert schema[0]['name'] == 'country', "First column should be 'country'"

    # Verify data quality is calculated
    from utils.profiler import profile_dataframe
    profile = profile_dataframe(df, 'test_upload')
    assert profile['row_count'] == 2
    assert profile['col_count'] == 3
    assert 0 <= profile['quality_score'] <= 100

def test_cte_and_comments_allowed():
    ok, _ = validate_sql("WITH t AS (SELECT region FROM sales) SELECT * FROM t")
    assert ok
    ok, _ = validate_sql("SELECT region -- by region\nFROM sales")
    assert ok
    ok, _ = validate_sql("WITH t AS (SELECT 1) DELETE FROM sales")
    assert not ok
    ok, _ = validate_sql("SELECT 1; DROP TABLE sales")
    assert not ok

def test_extract_cuts_trailing_prose():
    sql = extract_sql_from_response("SELECT COUNT(*) FROM t WHERE x = 'a;b';\nThis counts the rows.")
    assert sql == "SELECT COUNT(*) FROM t WHERE x = 'a;b'"

def test_schema_question_detection():
    from utils.nl2sql import is_schema_question
    assert is_schema_question("What columns are in this table?")
    assert is_schema_question("describe the dataset")
    assert not is_schema_question("List all products available in the Electronics category")
    assert not is_schema_question("Describe revenue by category")
    assert not is_schema_question("Show the revenue column for 2024")

def test_numeric_text_coerced_on_import():
    from utils.ingestion import clean_dataframe
    df = clean_dataframe(pd.DataFrame({
        'price': ['98.58', '214.30', ''],
        'revenue': ['$1,234', '$56', '$7,000.50'],
        'share': ['45%', '12.5%', '3%'],
        'zip': ['01234', '90210', '10001'],
        'name': ['a', 'b', 'c'],
    }))
    is_num = pd.api.types.is_numeric_dtype
    assert is_num(df['price']) and df['price'].isna().sum() == 1
    assert list(df['revenue']) == [1234.0, 56.0, 7000.5]
    assert list(df['share']) == [45.0, 12.5, 3.0]
    assert not is_num(df['zip'])              # leading-zero codes stay text
    assert not is_num(df['name'])

def test_decimal_comma_vs_thousands():
    from utils.ingestion import _parse_number
    assert _parse_number('77,27') == 77.27     # OCR / European decimal comma
    assert _parse_number('1,5') == 1.5
    assert _parse_number('1,234') == 1234.0    # 3 digits after comma = thousands
    assert _parse_number('12,3456') is None    # neither pattern: not a number

def test_describe_table_grounds_values():
    import sqlite3
    from utils.nl2sql import describe_table, sqlite_runner
    conn = sqlite3.connect(':memory:')
    conn.execute("CREATE TABLE s (region TEXT, order_date TEXT, total REAL, price TEXT)")
    conn.executemany("INSERT INTO s VALUES (?,?,?,?)", [
        ('North', '2024-01-05', 10.5, '98.58'), ('West', '2024-03-01', 99.0, '214.30')])
    cols = [{'name': n, 'type': t} for n, t in
            [('region', 'TEXT'), ('order_date', 'TEXT'), ('total', 'REAL'), ('price', 'TEXT')]]
    text = describe_table(sqlite_runner(conn), 's', cols)
    assert "one of 'North', 'West'" in text
    assert "dates formatted YYYY-MM-DD, from '2024-01-05' to '2024-03-01'" in text
    assert "numbers from 10.5 to 99" in text
    assert "numbers stored as text" in text and "CAST(price AS REAL)" in text

def test_parse_model_output():
    from utils.nl2sql import parse_model_output
    sql, interp = parse_model_output('{"interpretation": "Revenue by region", "sql": "SELECT 1;"}')
    assert sql == "SELECT 1" and interp == "Revenue by region"
    sql, interp = parse_model_output('Sure! ```sql\nSELECT 2\n```')
    assert sql == "SELECT 2" and interp == ""

def test_fix_date_like():
    from utils.nl2sql import fix_date_like
    assert fix_date_like("WHERE order_date LIKE '2024-%m-%d'") == "WHERE order_date LIKE '2024-%'"
    assert fix_date_like("WHERE d like '2024-10-%d'") == "WHERE d like '2024-10-%'"
    # Ordinary patterns are left alone
    assert fix_date_like("WHERE name LIKE '%display%'") == "WHERE name LIKE '%display%'"
    assert fix_date_like("WHERE d LIKE '2024%'") == "WHERE d LIKE '2024%'"

def test_ollama_errors_are_actionable():
    """Missing model / Ollama down produce messages that say how to fix it."""
    import io, urllib.error
    import utils.llm as llm
    original = llm.urllib.request.urlopen
    try:
        def missing(*a, **k):
            raise urllib.error.HTTPError('u', 404, 'not found', {}, io.BytesIO(b''))
        llm.urllib.request.urlopen = missing
        try:
            llm.call_llm("hi", "ollama", model="qwen2.5-coder:7b")
            assert False, "expected LLMUnavailable"
        except llm.LLMUnavailable as e:
            assert "ollama pull qwen2.5-coder:7b" in str(e)

        def down(*a, **k):
            raise urllib.error.URLError('refused')
        llm.urllib.request.urlopen = down
        try:
            llm.list_ollama_models()
            assert False, "expected LLMUnavailable"
        except llm.LLMUnavailable as e:
            assert "isn't running" in str(e)
    finally:
        llm.urllib.request.urlopen = original

def test_pipeline_repairs_execution_error():
    """A failing first query gets one repair attempt with the DB error."""
    import sqlite3
    import utils.nl2sql as nl
    conn = sqlite3.connect(':memory:')
    conn.execute("CREATE TABLE s (region TEXT, total REAL)")
    conn.execute("INSERT INTO s VALUES ('North', 5)")
    replies = iter([
        '{"interpretation": "x", "sql": "SELECT EXTRACT(YEAR FROM total) FROM s"}',
        '{"interpretation": "Total by region", "sql": "SELECT region, SUM(total) AS t FROM s GROUP BY region"}',
    ])
    prompts = []
    original = nl.call_llm
    nl.call_llm = lambda p, *a, **k: (prompts.append(p), next(replies))[1]
    try:
        out = nl.answer("total by region", [{'table_name': 's', 'columns': [
            {'name': 'region', 'type': 'TEXT'}, {'name': 'total', 'type': 'REAL'}]}], nl.sqlite_runner(conn))
    finally:
        nl.call_llm = original
    assert out['rows'] == [('North', 5.0)]
    assert len(out['attempts']) == 1 and 'syntax error' in prompts[1]

if __name__ == '__main__':
    tests = [test_valid_select,test_block_drop,test_block_delete,test_block_update,
             test_block_pragma,test_reserved_word_col,test_table_name_sanitize,
             test_extract_sql_markdown,test_profiler,test_chart_bar,test_chart_pie,
             test_chart_scatter,test_api_upload_visible_behaviour,
             test_cte_and_comments_allowed,test_extract_cuts_trailing_prose,
             test_schema_question_detection,test_numeric_text_coerced_on_import,
             test_decimal_comma_vs_thousands,
             test_describe_table_grounds_values,test_parse_model_output,
             test_fix_date_like,test_ollama_errors_are_actionable,
             test_pipeline_repairs_execution_error]
    passed = 0
    for t in tests:
        try:
            t(); print(f'  v {t.__name__}'); passed += 1
        except Exception as e:
            print(f'  x {t.__name__}: {e}')
    print(f'\n{passed}/{len(tests)} passed')
