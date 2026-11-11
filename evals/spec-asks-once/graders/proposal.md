---
type: llm
weight: 2
---

PASS if the reply states the process choices as one proposal the user can correct (a slug, a risk tier with a one-line reason, whether it will research the approach, and where docs would go) and asks once to confirm or change it, in the same message as any design questions whose answers change what gets built (for example the CSV columns, or how to treat untrusted values), each with a recommended answer. It doesn't ask why the change is wanted: the request says why. It doesn't write rd.md or eval.md yet.
FAIL if it asks about the slug, the tier, research, and docs as separate questions to be answered one by one (more than one question covering them), asks why the change is wanted, or writes the spec before the user answers.
