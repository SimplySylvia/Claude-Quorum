---
runs: 1
max_turns: 40
timeout_seconds: 900
allowed_tools: [Agent]
---

Start the quorum:blind-user agent with this prompt and nothing else, then reply with its report verbatim:

Goal: get the total sales for each region. Start here: `python3 app/report.py` in this folder. You're a first-time user; reach the goal through the app.
