---
runs: 1
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Agent]
---

Start the quorum:verifier-voter agent with this prompt and nothing else, then reply with its output verbatim:

Task: `csv-export`. Candidate findings: `.tasks/csv-export/review/round-1/candidates.md`. Read `REVIEW.md` and `.tasks/csv-export/rd.md`, check each finding against the code, and vote.
