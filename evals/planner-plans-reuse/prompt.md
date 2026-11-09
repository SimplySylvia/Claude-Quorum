---
runs: 1
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:planner agent with this prompt and nothing else, then reply with its output verbatim:

Task `csv-export`. Write the implementation plan in the template at `.tasks/csv-export/plan-template.md`. Read `CLAUDE.md`, `REVIEW.md`, `.tasks/csv-export/rd.md`, `.tasks/csv-export/eval.md`, `.tasks/csv-export/research.md` if it exists, and `.tasks/csv-export/mockup.html` if it exists.
