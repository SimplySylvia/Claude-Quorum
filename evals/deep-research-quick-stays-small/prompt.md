---
runs: 1
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, AskUserQuestion]
---

/quorum:research --effort quick --yes Which Python standard-library module should the sales report use to export its rows as CSV, and how does it quote a customer name that has a comma in it? Use the slug csv-module.
