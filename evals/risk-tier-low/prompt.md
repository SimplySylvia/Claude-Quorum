---
runs: 1
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill]
---

/quorum:spec-and-eval --yes Fix the typo 'summarizes' -> 'summarises' in README.md. Use the slug readme-typo.
