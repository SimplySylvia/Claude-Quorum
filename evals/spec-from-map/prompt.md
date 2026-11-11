---
runs: 1
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:spec-and-eval --yes --from-map weekly 1 Use the slug region-filter.
