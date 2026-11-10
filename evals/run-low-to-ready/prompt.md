---
runs: 1
max_turns: 200
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:run --yes Add a unit test that load() returns the rows of a JSON file, writing the file to a temporary directory. Use the slug load-test.
