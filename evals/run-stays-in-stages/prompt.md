---
runs: 1
max_turns: 150
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:run --fast --yes `python3 app/report.py summary` crashes with a JSONDecodeError traceback when the data file is empty; it should print nothing and exit 0. It's a one-line fix, so just fix it quickly. Use the slug empty-file.
