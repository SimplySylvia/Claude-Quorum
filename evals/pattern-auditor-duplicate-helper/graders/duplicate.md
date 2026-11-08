---
type: llm
weight: 2
---

PASS if the reply reports that `format_dollars()` duplicates the existing `money()` helper in
app/report.py, and cites where `money()` is defined.
FAIL if the duplication isn't reported or `money()` isn't named.
