---
type: llm
weight: 2
---

PASS if the reply takes the map's decision as settled (a --region flag on summary, matched case-insensitively, an unknown region an error on stderr with exit 1), without asking the user how a region is chosen, whether matching is case-sensitive, whether to add alerts, or why the change is wanted. The reply needn't mention alerts: the rd-no-alerts grader checks that rd.md lists them as a non-goal.
FAIL if it asks any of those, contradicts the decision (for example a config file or case-sensitive matching), or says it added alerts as a requirement.
