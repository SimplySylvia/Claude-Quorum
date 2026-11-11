---
type: llm
weight: 2
---

PASS if the spec takes the map's decision as settled (a --region flag on summary, matched case-insensitively, an unknown region an error on stderr with exit 1) and lists alerts as a non-goal, without asking the user how a region is chosen, whether matching is case-sensitive, whether to add alerts, or why the change is wanted.
FAIL if it asks any of those, contradicts the decision (for example a config file or case-sensitive matching), or adds alerts as a requirement.
