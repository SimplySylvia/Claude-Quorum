---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:pr-writer agent with this prompt and nothing else, then reply with its output verbatim:

Task `csv-export`. Base commit `main`. Draft the PR title and description, and list any commits that must not ship. Read `CLAUDE.md`, `.tasks/csv-export/rd.md`, `state.md`, `proof-final.md`, and `.tasks/csv-export/blind/` if it exists.
