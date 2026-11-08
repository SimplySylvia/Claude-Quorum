---
type: llm
---

PASS if the reply gives at least two options with their tradeoffs and recommends Python's standard `csv`
module (for example `csv.writer`) over joining fields by hand, noting that values with commas or quotes
need quoting.
FAIL if it recommends building CSV lines by hand, gives only one option without saying why others were
ruled out, or has no Sources section.
