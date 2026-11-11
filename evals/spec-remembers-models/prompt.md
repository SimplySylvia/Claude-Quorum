---
runs: 1
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:spec-and-eval Add an export command to app/report.py that prints the sales rows as CSV to stdout, so the finance team can open them in a spreadsheet instead of copying numbers by hand.
