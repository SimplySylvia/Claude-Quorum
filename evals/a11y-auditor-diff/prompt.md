---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:a11y-auditor agent with this prompt and nothing else, then reply with its output verbatim:

Mode: diff. Task: `html-report`. Review the diff range `main..HEAD` (`git diff main..HEAD`) in this repo. Read `REVIEW.md`, `CLAUDE.md`, `.tasks/html-report/rd.md`, and `.tasks/html-report/eval.md`. This is round 1.
