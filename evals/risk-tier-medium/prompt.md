---
runs: 1
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---

/quorum:spec-and-eval --yes --no-research Add an export command to app/report.py that prints the sales rows as CSV to stdout. Use the slug csv-export.
