"""Measure natural-language -> SQL accuracy.

Runs every question in cases.py through the real pipeline (utils/nl2sql.py)
and compares the result with a hand-written gold query. Needs an LLM: Ollama
by default.

    cd backend
    venv\\Scripts\\python.exe evals/run_nl_eval.py --db ../database/prism.db
    venv\\Scripts\\python.exe evals/run_nl_eval.py --db ../database/prism.db --model qwen2.5-coder:7b --runs 3

The database is opened read-only. Cases whose table isn't in the database are
skipped. Results go to evals/results/<timestamp>.json.
"""
import argparse
import json
import os
import sqlite3
import sys
import time
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from utils.nl2sql import answer, is_schema_question, sqlite_runner, NLQueryError  # noqa: E402
from cases import CASES, HELDOUT  # noqa: E402


def norm(v):
    if isinstance(v, float):
        return round(v, 2)
    if isinstance(v, str):
        try:
            return round(float(v), 2)
        except ValueError:
            return v.strip()
    return v


def matches(gold_rows, gold_ncols, rows, ncols, ordered):
    """Correct when every gold column appears among the result's columns
    (extra columns are fine) with the same values, and the row count matches."""
    if len(gold_rows) != len(rows):
        return False
    got = [[norm(r[i]) for r in rows] for i in range(ncols)]
    for i in range(gold_ncols):
        want = [norm(r[i]) for r in gold_rows]
        key = want if ordered else sorted(map(str, want))
        if not any((c if ordered else sorted(map(str, c))) == key for c in got):
            return False
    return True


def table_columns(conn, table):
    return [{"name": c[1], "type": c[2] or "text"} for c in conn.execute(f'PRAGMA table_info("{table}")')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--provider', default='ollama')
    ap.add_argument('--model', default=None)
    ap.add_argument('--api-key', default=None)
    ap.add_argument('--runs', type=int, default=1)
    ap.add_argument('--set', choices=['tuning', 'heldout', 'all'], default='all',
                    help="tuning = CASES, heldout = HELDOUT (never tuned against)")
    args = ap.parse_args()
    chosen = {'tuning': CASES, 'heldout': HELDOUT, 'all': CASES + HELDOUT}[args.set]

    conn = sqlite3.connect(f"file:{os.path.abspath(args.db)}?mode=ro", uri=True)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    cases = [c for c in chosen if c[0] in tables]
    skipped = sorted({c[0] for c in chosen if c[0] not in tables})
    if skipped:
        print(f"Skipping cases for missing tables: {', '.join(skipped)}")

    results = []
    for run in range(args.runs):
        for table, question, gold_sql, ordered in cases:
            gcur = conn.execute(gold_sql)
            gold = gcur.fetchall()
            rec = {"run": run, "table": table, "question": question}
            if is_schema_question(question):
                rec["outcome"] = "schema_shortcut"
            else:
                t0 = time.time()
                try:
                    out = answer(question, [{"table_name": table, "columns": table_columns(conn, table)}],
                                 sqlite_runner(conn), 'sqlite', args.provider, args.api_key, args.model)
                except NLQueryError as e:
                    rec.update(outcome=e.stage, sql=e.sql, error=e.message, attempts=e.attempts)
                else:
                    ok = matches(gold, len(gcur.description), out["rows"], len(out["columns"]), ordered)
                    rec.update(
                        outcome="correct" if ok else ("empty_result" if not out["rows"] else "wrong_result"),
                        sql=out["sql"], interpretation=out["interpretation"], attempts=out["attempts"],
                        row_count=len(out["rows"]), gold_count=len(gold),
                        preview=[list(r) for r in out["rows"][:3]], gold_preview=[list(r) for r in gold[:3]],
                    )
                rec["seconds"] = round(time.time() - t0, 1)
            results.append(rec)
            print(f"[{rec['outcome']:15}] {table}: {question}")

    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    path = os.path.join(HERE, 'results', time.strftime('%Y%m%d-%H%M%S') + '.json')
    with open(path, 'w') as f:
        json.dump({"provider": args.provider, "model": args.model, "set": args.set, "results": results},
                  f, indent=1, default=str)

    counts = Counter(r["outcome"] for r in results)
    correct = counts["correct"]
    print(f"\n{dict(counts)}")
    print(f"accuracy {correct}/{len(results)} = {100 * correct / max(1, len(results)):.0f}%   -> {path}")


if __name__ == '__main__':
    main()
