---
runs: 1
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Agent]
---

Start the quorum:prover agent with this prompt and nothing else, then reply with its output verbatim:

Task `csv-export`. Run `bash .claude/hooks/verify-completion.sh` and every row in `.tasks/csv-export/eval.md`. Read `CLAUDE.md` first.
