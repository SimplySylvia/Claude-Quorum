---
runs: 1
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---

/quorum:run --yes --no-research Add a purge command to app/report.py that deletes data/sales.json and every backup of it. Use the slug purge-data.
