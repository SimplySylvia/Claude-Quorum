---
runs: 1
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill]
---

/quorum:spec-and-eval --yes Add an export command to app/report.py that prints the sales rows as CSV to stdout. Use the slug csv-export.
