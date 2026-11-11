---
runs: 1
max_turns: 90
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:map --yes The regional managers want to use the sales report on their own each week: their region's numbers, how they're trending against earlier weeks, and an alert when their region drops sharply. Today it's one summary command over one JSON file. Use the slug regional-reporting.
