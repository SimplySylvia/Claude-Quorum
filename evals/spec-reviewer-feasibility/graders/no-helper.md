---
type: llm
weight: 2
---

PASS if the reply reports, as an [IMPORTANT] finding, that `write_csv()` doesn't exist in app/report.py
(or that the summary command prints no CSV), so requirement 2 can't be followed.
FAIL if that isn't reported, or only as a [NIT].
