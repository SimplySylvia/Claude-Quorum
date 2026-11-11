---
type: llm
weight: 2
---

PASS if the reply asks the user how region names should be matched, with a recommended answer, and cites what the code does today (summary groups rows by the exact `region` value in app/report.py) as a fact rather than asking the user for it.
FAIL if it records a decision without the user's answer, asks the user what the code does, or edits app/report.py.
