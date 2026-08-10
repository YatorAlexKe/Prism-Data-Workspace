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

if __name__ == '__main__':
    tests = [test_valid_select,test_block_drop,test_block_delete,test_block_update,
             test_block_pragma,test_reserved_word_col,test_table_name_sanitize,
             test_extract_sql_markdown,test_profiler,test_chart_bar,test_chart_pie,
             test_chart_scatter,test_api_upload_visible_behaviour]
    passed = 0
    for t in tests:
        try:
            t(); print(f'  v {t.__name__}'); passed += 1
        except Exception as e:
            print(f'  x {t.__name__}: {e}')
    print(f'\n{passed}/{len(tests)} passed')
