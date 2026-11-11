---
runs: 1
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:map --yes The summary command's help text says "usage: report.py summary [DATA_FILE]"; also mention that DATA_FILE defaults to data/sales.json.
