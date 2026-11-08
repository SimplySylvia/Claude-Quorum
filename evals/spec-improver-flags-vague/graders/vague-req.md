---
type: llm
weight: 2
---

PASS if the reply flags requirement 2 ("handles bad input properly and is fast") as ambiguous or not
verifiable, and proposes a concrete rewrite, for example what happens when DATA_FILE is missing or isn't
valid JSON (message, exit code), or a measurable speed limit.
FAIL if requirement 2 isn't flagged, or is flagged without a proposed rewrite.
