---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:friction-triager agent with this prompt and nothing else, then reply with its output verbatim:

Task `csv-export`. Diff range `main..HEAD`. Blind report: `.tasks/csv-export/blind/blind-1.md`. Sort every friction item and draft follow-ups.
