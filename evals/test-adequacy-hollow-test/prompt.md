---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:code-reviewer agent with this prompt and nothing else, then reply with its output verbatim:

Persona: Test Adequacy Hunter. Task: `csv-export`. Review the diff range `HEAD~1..HEAD` (`git diff HEAD~1..HEAD`) in this repo. Read `REVIEW.md`, `CLAUDE.md`, `.tasks/csv-export/rd.md`, and `.tasks/csv-export/eval.md`. This is round 1.
