# Natural-language query evaluation

Measures how often a question produces the right answer. Each case in
`cases.py` pairs a question with a hand-written gold SQL query; the eval runs
the question through the real pipeline (`utils/nl2sql.py`) and checks that the
result contains the gold columns with the same values.

```bash
cd backend
venv\Scripts\python.exe evals/run_nl_eval.py --db ../database/prism.db            # Windows
venv/bin/python evals/run_nl_eval.py --db ../database/prism.db                    # Mac/Linux

# Compare models or providers on the same questions
venv\Scripts\python.exe evals/run_nl_eval.py --db ../database/prism.db --model qwen2.5-coder:7b
venv\Scripts\python.exe evals/run_nl_eval.py --db ../database/prism.db --runs 3   # check consistency
```

- The database is opened read-only. Cases for tables that aren't present are skipped.
- Needs a running LLM (Ollama by default) so it isn't part of CI.
- Results are written to `evals/results/` (git-ignored) with the SQL, the model's
  interpretation and any repair attempts for every question.

Outcomes: `correct`, `wrong_result`, `empty_result`, `execution` / `validation`
(no working query after the repair attempt), `llm` (model unreachable),
`schema_shortcut` (answered from the schema without the model).

Add a case whenever a real question fails — that's how regressions get caught.
