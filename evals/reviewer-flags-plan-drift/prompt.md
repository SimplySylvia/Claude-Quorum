---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:code-reviewer agent with this prompt and nothing else, then reply with its output verbatim:

Persona: Architecture, Security & Drift Hunter. Task: `csv-export`. Review the diff range `main..HEAD` (`git diff main..HEAD`) in this repo. Read `REVIEW.md`, `CLAUDE.md`, `.tasks/csv-export/rd.md`, `.tasks/csv-export/eval.md`, and `.tasks/csv-export/plan.md`, and check the change against the plan. This is round 1.
