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
import inspect
import json
import os
import sqlite3
import sys
import time
import zlib
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from utils.nl2sql import answer, is_schema_question, sqlite_runner, NLQueryError  # noqa: E402
from cases import CASES, HELDOUT, DEFAULTS, CLARIFY, FOLLOWUPS, CLARIFY_HELDOUT, CLEAR_EVALUATIVE  # noqa: E402


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


SETS = ['tuning', 'heldout', 'defaults', 'clear_evaluative', 'clarify', 'clarify_heldout', 'followups']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--provider', default='ollama')
    ap.add_argument('--model', default=None)
    ap.add_argument('--api-key', default=None)
    ap.add_argument('--runs', type=int, default=1)
    ap.add_argument('--set', default='all',
                    help="comma-separated: tuning (CASES), heldout (HELDOUT, never tuned against), "
                         "defaults, clarify, followups; or 'all'")
    ap.add_argument('--with-unrelated-previous', action='store_true',
                    help="ask every gold question with an unrelated earlier question as follow-up "
                         "context, to catch context leaking into new questions")
    args = ap.parse_args()
    sets = SETS if args.set == 'all' else args.set.split(',')

    conn = sqlite3.connect(f"file:{os.path.abspath(args.db)}?mode=ro", uri=True)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    supported = set(inspect.signature(answer).parameters)
    run_sql = sqlite_runner(conn)

    def ask(table, question, previous=None):
        kwargs = {}
        if previous and 'previous' in supported:
            kwargs['previous'] = previous
        return answer(question, [{"table_name": table, "columns": table_columns(conn, table)}],
                      run_sql, 'sqlite', args.provider, args.api_key, args.model, **kwargs)

    def score(rec, table, question, gold_sql, ordered, previous=None):
        gcur = conn.execute(gold_sql)
        gold = gcur.fetchall()
        if previous is None and is_schema_question(question):
            rec["outcome"] = "schema_shortcut"
            return None
        try:
            out = ask(table, question, previous)
        except NLQueryError as e:
            rec.update(outcome=e.stage, sql=e.sql, error=e.message, attempts=e.attempts)
            return None
        if out.get("clarification"):
            # A clear question doesn't need one: asking is a miss here.
            rec.update(outcome="over_clarify", clarification=out["clarification"])
            return out
        ok = matches(gold, len(gcur.description), out["rows"], len(out["columns"]), ordered)
        if out.get("alternatives"):
            rec["alternatives"] = out["alternatives"]   # offered on a clear question: noise
        rec.update(
            outcome="correct" if ok else ("empty_result" if not out["rows"] else "wrong_result"),
            sql=out["sql"], interpretation=out["interpretation"], attempts=out["attempts"],
            row_count=len(out["rows"]), gold_count=len(gold),
            preview=[list(r) for r in out["rows"][:3]], gold_preview=[list(r) for r in gold[:3]],
        )
        return out

    # An unrelated earlier question on the same table, for --with-unrelated-previous.
    by_table = {}
    for t, q, g, _ in CASES + HELDOUT:
        by_table.setdefault(t, []).append((q, g))

    def unrelated(table, question):
        pool = [p for p in by_table.get(table, []) if p[0] != question]
        if not pool:
            return None
        q, g = pool[zlib.crc32(question.encode()) % len(pool)]  # stable across runs
        return {"question": q, "sql": g}

    gold_sets = {'tuning': CASES, 'heldout': HELDOUT, 'defaults': DEFAULTS, 'clear_evaluative': CLEAR_EVALUATIVE}
    clarify_sets = {'clarify': CLARIFY, 'clarify_heldout': CLARIFY_HELDOUT}
    results = []
    for run in range(args.runs):
        for set_name in sets:
            if set_name in gold_sets:
                for table, question, gold_sql, ordered in gold_sets[set_name]:
                    if table not in tables:
                        continue
                    previous = unrelated(table, question) if args.with_unrelated_previous else None
                    rec = {"run": run, "set": set_name, "table": table, "question": question}
                    if previous:
                        rec["previous"] = previous["question"]
                    t0 = time.time()
                    score(rec, table, question, gold_sql, ordered, previous)
                    rec["seconds"] = round(time.time() - t0, 1)
                    results.append(rec)
                    print(f"[{rec['outcome']:15}] {set_name}/{table}: {question}")

            elif set_name in clarify_sets:
                for table, question in clarify_sets[set_name]:
                    if table not in tables:
                        continue
                    rec = {"run": run, "set": set_name, "table": table, "question": question}
                    t0 = time.time()
                    try:
                        out = ask(table, question)
                    except NLQueryError as e:
                        rec.update(outcome=e.stage, error=e.message)
                    else:
                        c = out.get("clarification")
                        options = (c or {}).get("options") or []
                        if c and len(options) >= 2 and all(len(o.split()) >= 4 for o in options):
                            rec.update(outcome="correct", mode="asked", clarification=c)
                        elif c:
                            # Asked, but an option is a fragment that can't be asked on its own.
                            rec.update(outcome="weak_options", clarification=c)
                        elif out.get("alternatives"):
                            # Answered the natural reading and offered the others.
                            rec.update(outcome="correct", mode="answered_with_alternatives",
                                       alternatives=out["alternatives"], sql=out.get("sql"),
                                       interpretation=out.get("interpretation"))
                        else:
                            rec.update(outcome="guessed", sql=out.get("sql"), interpretation=out.get("interpretation"))
                    rec["seconds"] = round(time.time() - t0, 1)
                    results.append(rec)
                    print(f"[{rec['outcome']:15}] {set_name}/{table}: {question}")

            elif set_name == 'followups':
                for table, first, followup, gold_sql, ordered in FOLLOWUPS:
                    if table not in tables:
                        continue
                    rec = {"run": run, "set": set_name, "table": table, "question": followup, "previous": first}
                    t0 = time.time()
                    try:
                        first_out = ask(table, first)
                        previous = {"question": first, "sql": first_out.get("sql")}
                    except NLQueryError as e:
                        previous = {"question": first, "sql": e.sql}
                    score(rec, table, followup, gold_sql, ordered, previous)
                    rec["seconds"] = round(time.time() - t0, 1)
                    results.append(rec)
                    print(f"[{rec['outcome']:15}] followups/{table}: {first} -> {followup}")

    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    path = os.path.join(HERE, 'results', time.strftime('%Y%m%d-%H%M%S') + '.json')
    with open(path, 'w') as f:
        json.dump({"provider": args.provider, "model": args.model, "sets": sets,
                   "with_unrelated_previous": args.with_unrelated_previous, "results": results},
                  f, indent=1, default=str)

    print()
    for set_name in sets:
        rs = [r for r in results if r["set"] == set_name]
        if rs:
            ok = sum(r["outcome"] == "correct" for r in rs)
            other = Counter(r["outcome"] for r in rs if r["outcome"] != "correct")
            modes = Counter(r["mode"] for r in rs if r.get("mode"))
            noise = sum(1 for r in rs if r.get("alternatives") and set_name not in clarify_sets)
            extra = (f"  how: {dict(modes)}" if modes else '') + (f"  alternatives on clear questions: {noise}" if noise else '')
            print(f"{set_name:10} {ok}/{len(rs)} = {100 * ok / len(rs):.0f}%   {dict(other) if other else ''}{extra}")
    correct = sum(r["outcome"] == "correct" for r in results)
    print(f"overall    {correct}/{len(results)} = {100 * correct / max(1, len(results)):.0f}%   -> {path}")


if __name__ == '__main__':
    main()
