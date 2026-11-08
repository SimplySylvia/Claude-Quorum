---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:spec-reviewer agent with this prompt and nothing else, then reply with its output verbatim:

Persona: Feasibility Critic. Task: `csv-export`. Review `.tasks/csv-export/rd.md` and `.tasks/csv-export/eval.md` before any code is written. Read `CLAUDE.md`, `REVIEW.md`, and `.tasks/csv-export/research.md` if it exists.
