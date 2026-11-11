---
runs: 1
max_turns: 90
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:research --yes The sales report re-reads and re-parses data/sales.json on every run. Is it worth caching the parsed rows between runs, and if so, how, in this repo? Use the slug sales-cache.
