---
runs: 1
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:spec-and-eval --bug --yes Running `python3 app/report.py summary` on a data file that doesn't exist prints a Python traceback. It should print one error line on stderr and exit 1. Use the slug missing-file.
