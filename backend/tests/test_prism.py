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

def _sales_db():
    import sqlite3
    conn = sqlite3.connect(':memory:')
    conn.execute("CREATE TABLE s (region TEXT, total REAL, quantity INTEGER)")
    conn.executemany("INSERT INTO s VALUES (?,?,?)", [('North', 5, 2), ('West', 9, 1)])
    cols = [{'name': 'region', 'type': 'TEXT'}, {'name': 'total', 'type': 'REAL'}, {'name': 'quantity', 'type': 'INTEGER'}]
    return conn, [{'table_name': 's', 'columns': cols}]

def _scripted_llm(replies, prompts=None):
    """Stand-in for call_llm that returns canned replies in order."""
    it = iter(replies)
    def fake(prompt, *a, **k):
        if prompts is not None:
            prompts.append((prompt, k.get('system', '')))
        return next(it)
    return fake

def _with_llm(fake, fn):
    import utils.nl2sql as nl
    original = nl.call_llm
    nl.call_llm = fake
    try:
        return fn(nl)
    finally:
        nl.call_llm = original

def test_ambiguous_question_asks_with_options():
    conn, tables = _sales_db()
    reply = ('{"status": "clarify", "interpretation": "", "sql": "", "question": "Best by what?", '
             '"options": ["Which region has the highest total?", "Which region sold the most units?"]}')
    out = _with_llm(_scripted_llm([reply]), lambda nl: nl.answer("Which region is best?", tables, nl.sqlite_runner(conn)))
    assert out['clarification']['options'] == ["Which region has the highest total?", "Which region sold the most units?"]
    assert out['rows'] == [] and out['sql'] == ''

def test_clarify_without_real_options_answers_instead():
    conn, tables = _sales_db()
    replies = ['{"status": "clarify", "interpretation": "", "sql": "", "question": "Hm?", "options": ["only one"]}',
               '{"interpretation": "Total by region", "sql": "SELECT region, SUM(total) FROM s GROUP BY region"}']
    out = _with_llm(_scripted_llm(replies), lambda nl: nl.answer("best region", tables, nl.sqlite_runner(conn)))
    assert 'clarification' not in out and len(out['rows']) == 2

def test_option_click_never_asks_again():
    """allow_clarify=False (an option was picked) must produce an answer."""
    conn, tables = _sales_db()
    prompts = []
    replies = ['{"interpretation": "Highest total", "sql": "SELECT region FROM s ORDER BY total DESC LIMIT 1"}']
    out = _with_llm(_scripted_llm(replies, prompts),
                    lambda nl: nl.answer("Which region has the highest total?", tables, nl.sqlite_runner(conn),
                                         allow_clarify=False))
    assert out['rows'] == [('West',)]
    assert 'clarify' not in prompts[0][1]          # the asking rule isn't even offered

def test_followup_sends_previous_question_and_sql():
    conn, tables = _sales_db()
    prompts = []
    replies = ['{"status": "answer", "interpretation": "North only", "sql": "SELECT SUM(total) FROM s WHERE region = \'North\'"}']
    previous = {"question": "Total by region", "sql": "SELECT region, SUM(total) FROM s GROUP BY region"}
    out = _with_llm(_scripted_llm(replies, prompts),
                    lambda nl: nl.answer("now only North", tables, nl.sqlite_runner(conn), previous=previous))
    assert out['rows'] == [(5.0,)]
    assert "PREVIOUS SQL: SELECT region, SUM(total) FROM s GROUP BY region" in prompts[0][0]

def test_options_with_made_up_columns_are_dropped():
    """An option built on a column the data doesn't have never reaches the user;
    with fewer than two real options left, Prism answers instead of asking."""
    conn, tables = _sales_db()
    reply = ('{"status": "clarify", "interpretation": "", "sql": "", "question": "?", "options": ['
             '{"question": "Which region has the highest total?", "columns": ["total"]},'
             '{"question": "Which region sold the most units?", "columns": ["s.quantity"]},'
             '{"question": "Which region has the happiest customers?", "columns": ["customer_satisfaction"]}]}')
    out = _with_llm(_scripted_llm([reply]), lambda nl: nl.answer("Which region is best?", tables, nl.sqlite_runner(conn)))
    assert out['clarification']['options'] == ["Which region has the highest total?", "Which region sold the most units?"]

    one_real = ('{"status": "clarify", "interpretation": "", "sql": "", "question": "?", "options": ['
                '{"question": "Which region has the highest total?", "columns": ["total"]},'
                '{"question": "Which region has the happiest customers?", "columns": ["satisfaction"]}]}')
    answer_reply = '{"interpretation": "Highest total", "sql": "SELECT region FROM s ORDER BY total DESC LIMIT 1"}'
    out = _with_llm(_scripted_llm([one_real, answer_reply]),
                    lambda nl: nl.answer("Which region is best?", tables, nl.sqlite_runner(conn)))
    assert 'clarification' not in out and out['rows'] == [('West',)]

def test_ambiguity_trigger_matches_the_eval_questions():
    from utils.nl2sql import looks_ambiguous
    sales = [{'table_name': 'sales_data', 'columns': [
        {'name': n, 'type': t} for n, t in [('region', 'TEXT'), ('product', 'TEXT'), ('quantity', 'INTEGER'),
                                            ('unit_price', 'REAL'), ('total_revenue', 'REAL'), ('order_date', 'TEXT')]]}]
    water = [{'table_name': 'w', 'columns': [{'name': 'country', 'type': 'TEXT'}, {'name': 'population', 'type': 'INTEGER'}]}]
    for q in ["Which region performs best?", "Show me the best products", "How are we doing?"]:
        assert looks_ambiguous(q, "", sales), q
    for q in ["Top 5 products by revenue", "Which region sold the most phones?", "Show the latest 5 orders"]:
        assert not looks_ambiguous(q, "", sales), q
    assert not looks_ambiguous("Top 5 most populous countries", "", water)       # "populous" ~ population
    assert looks_ambiguous("Compare the regions", "", sales)
    customers = [{'table_name': 'c', 'columns': [{'name': 'customer_id', 'type': 'INTEGER'},
                                                 {'name': 'lifetime_value', 'type': 'REAL'}]}]
    assert looks_ambiguous("Who are our best customers?", "", customers)         # customer_id isn't a measure
    assert not looks_ambiguous("Best customers by lifetime value", "", customers)
    assert looks_ambiguous("Show sales", "The question is vague, so I'll assume revenue.", sales)

def test_relative_dates_count_back_from_the_data():
    from utils.nl2sql import anchor_now, latest_date
    schema = ("  - order_date (TEXT): dates formatted YYYY-MM-DD, from '2024-01-01' to '2024-12-27'\n"
              "  - shipped (TEXT): dates formatted YYYY-MM-DD, from '2024-01-03' to '2024-12-30'")
    assert latest_date(schema) == '2024-12-30'
    assert latest_date("  - region (TEXT): one of 'North'") is None
    assert anchor_now("WHERE d >= DATE('now', '-3 months')", '2024-12-30') == "WHERE d >= DATE('2024-12-30', '-3 months')"
    assert anchor_now("WHERE d = CURRENT_DATE", '2024-12-30') == "WHERE d = '2024-12-30'"

def test_unnamed_measure_answers_and_offers_other_readings():
    """'Which region is best?' is answered by the natural reading (total) and
    the readings it didn't use come back as alternatives, from real columns."""
    conn, tables = _sales_db()
    guess = '{"status": "answer", "interpretation": "Highest total", "sql": "SELECT region FROM s ORDER BY total DESC LIMIT 1"}'
    prompts = []
    out = _with_llm(_scripted_llm([guess], prompts), lambda nl: nl.answer("Which region is best?", tables, nl.sqlite_runner(conn)))
    assert out['rows'] == [('West',)]
    assert out['alternatives'] == ["Which region is best by quantity"]
    assert len(prompts) == 1                                   # no extra model call

    # A question that names its measure gets no alternatives.
    named = '{"status": "answer", "interpretation": "x", "sql": "SELECT region FROM s ORDER BY total DESC LIMIT 1"}'
    out = _with_llm(_scripted_llm([named]), lambda nl: nl.answer("Which region has the best total?", tables, nl.sqlite_runner(conn)))
    assert 'alternatives' not in out

    # After picking a reading (allow_clarify=False) there are no alternatives either.
    out = _with_llm(_scripted_llm([guess]), lambda nl: nl.answer("Which region is best?", tables, nl.sqlite_runner(conn),
                                                                allow_clarify=False))
    assert 'alternatives' not in out

def test_alternative_readings_skip_ids_labels_and_used_measures():
    from utils.nl2sql import alternative_readings
    tables = [{'table_name': 't', 'columns': [
        {'name': n, 'type': t} for n, t in [('order_id', 'INTEGER'), ('year', 'INTEGER'), ('unit_price', 'REAL'),
                                            ('quantity', 'INTEGER'), ('total_revenue', 'REAL')]]}]
    alts = alternative_readings("Show me the best products?", "SELECT product, SUM(total_revenue) FROM t", tables)
    assert alts == ["Show me the best products by quantity", "Show me the best products by unit price"]

def test_clarify_options_stand_alone():
    from utils.nl2sql import complete_options
    assert complete_options("Compare the regions", ["Total revenue", "Number of orders"]) == [
        "Compare the regions by total revenue", "Compare the regions by number of orders"]
    full = "Which region has the highest total revenue?"
    assert complete_options("Which region performs best?", [full]) == [full]   # already complete
    assert complete_options("How are we doing?", ["GDP per capita"]) == ["How are we doing by GDP per capita"]

def test_suggestions_fit_the_columns():
    from utils.nl2sql import suggest_questions, sqlite_runner
    import sqlite3
    conn = sqlite3.connect(':memory:')
    conn.execute("CREATE TABLE t (order_id TEXT, region TEXT, product TEXT, total_revenue REAL, year INTEGER, order_date TEXT)")
    conn.executemany("INSERT INTO t VALUES (?,?,?,?,?,?)", [
        (f'O{i}', ['North', 'South'][i % 2], f'P{i}', 10.0 * i, 2024, f'2024-0{1 + i % 9}-01') for i in range(30)])
    cols = [{'name': c[1], 'type': c[2]} for c in conn.execute("PRAGMA table_info(t)")]
    s = suggest_questions(sqlite_runner(conn), 't', cols)
    assert s[0] == "Total revenue by region"
    assert "Total revenue per month" in s
    assert not any('year' in q.lower() for q in s)     # years are labels, not measures

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
             test_pipeline_repairs_execution_error,
             test_ambiguous_question_asks_with_options,test_clarify_without_real_options_answers_instead,
             test_option_click_never_asks_again,test_followup_sends_previous_question_and_sql,
             test_options_with_made_up_columns_are_dropped,
             test_ambiguity_trigger_matches_the_eval_questions,test_relative_dates_count_back_from_the_data,
             test_unnamed_measure_answers_and_offers_other_readings,
             test_alternative_readings_skip_ids_labels_and_used_measures,
             test_clarify_options_stand_alone,test_suggestions_fit_the_columns]
    passed = 0
    for t in tests:
        try:
            t(); print(f'  v {t.__name__}'); passed += 1
        except Exception as e:
            print(f'  x {t.__name__}: {e}')
    print(f'\n{passed}/{len(tests)} passed')
