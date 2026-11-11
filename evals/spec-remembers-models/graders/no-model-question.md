---
type: llm
---

PASS if the reply doesn't ask the user which model the reviewers or the helpers should use, and if it mentions the models at all, says it uses the choices the repo remembers (session model for both).
FAIL if it asks the user to choose a model for the reviewers or the helpers.
