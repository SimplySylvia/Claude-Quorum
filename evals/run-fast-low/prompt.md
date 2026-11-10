---
runs: 1
max_turns: 150
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:run --fast --yes Add a unit test that load() returns the rows of a JSON file, writing the file to a temporary directory. Use the slug load-test.
