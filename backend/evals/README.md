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
(no working query after the repair attempt), `llm` (model unreachable or timed out),
`schema_shortcut` (answered from the schema without the model).

## Sets (`--set`, comma-separated, default `all`)

| Set | Checks | Correct when |
|---|---|---|
| `tuning` (CASES) | Everyday questions; prompt changes were made against these | Result matches the gold query |
| `heldout` (HELDOUT) | Never tuned against — the honest generalisation check | Result matches the gold query |
| `defaults` | Vague time words ("last 3 months", "this year") count back from the latest date in the data | Result matches the gold query |
| `clear_evaluative` | "Top 3 regions by quantity": evaluative words but a named measure | Answered correctly, without asking (`over_clarify` otherwise) |
| `clarify` / `clarify_heldout` | Questions that name no measure ("Who are our best customers?") | Prism asks with complete options, or answers and offers other readings (`guessed` otherwise) |
| `followups` | "Show revenue by region" → "Now only for Electronics" | The follow-up's result matches the gold query |

`--with-unrelated-previous` asks each gold question with an unrelated earlier
question as follow-up context, to catch context leaking into new questions.

Clarification options and offered readings can't be checked automatically for
being sensible — read them in the results file after a run.

Add a case whenever a real question fails — that's how regressions get caught.
