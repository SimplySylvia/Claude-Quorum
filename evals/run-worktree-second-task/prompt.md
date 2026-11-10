---
runs: 1
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:run --until spec --yes --no-research Add a unit test that load() returns the rows of a JSON file, writing the file to a temporary directory. Use the slug load-test.
