---
runs: 1
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill]
---

/quorum:spec-and-eval --yes After printing a summary, delete the processed rows from data/sales.json so they are never counted twice. Use the slug consume-rows.
