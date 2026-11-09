---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:pattern-auditor agent with this prompt and nothing else, then reply with its output verbatim:

Mode: plan. Task: `csv-export`. Review the implementation plan `.tasks/csv-export/plan.md` before any code is written: does it meet `.tasks/csv-export/rd.md` and `.tasks/csv-export/eval.md`, and is it right for this repo? Read `REVIEW.md` and `CLAUDE.md` first, and the code the plan names. This is plan round 1.
