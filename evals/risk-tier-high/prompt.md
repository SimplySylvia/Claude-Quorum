---
runs: 1
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---

/quorum:spec-and-eval --yes --no-research After printing a summary, delete the processed rows from data/sales.json so they are never counted twice. Use the slug consume-rows.
