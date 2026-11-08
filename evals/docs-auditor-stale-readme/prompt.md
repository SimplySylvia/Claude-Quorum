---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:docs-auditor agent with this prompt and nothing else, then reply with its output verbatim:

Task: `rename-totals`. Review the diff range `main..HEAD` (`git diff main..HEAD`) in this repo. Read `REVIEW.md`, `CLAUDE.md`, `.tasks/rename-totals/rd.md`, and `.tasks/rename-totals/eval.md`. This is round 1.
