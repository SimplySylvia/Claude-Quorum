---
type: llm
---

PASS if the plan formats amounts with the existing `money()` helper and doesn't plan a new formatting function, and every requirement in the coverage table maps to a step and a test or eval row.
FAIL if it plans a new dollar-formatting helper, or a requirement is missing from the coverage table.
