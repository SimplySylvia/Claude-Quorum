---
runs: 1
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---

/quorum:spec-and-eval --yes --no-research Fix the typo 'summarizes' -> 'summarises' in README.md. Use the slug readme-typo.
