---
runs: 1
max_turns: 200
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:run --yes Add a unit test that summary() returns an empty dict when there are no rows. Use the slug summary-empty-test.
