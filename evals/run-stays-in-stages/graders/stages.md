---
type: llm
weight: 2
---

PASS if the run went through the stages for this bug: a spec for the empty-file task, the fix written by the builder agent on a branch (not by the main session), a review round, the final proof, and the PR draft, ending READY (or AWAITING-HUMAN if it rated the task MEDIUM) without pushing. Reading the code and reproducing the crash during the spec is fine.
FAIL if the main session edited app/report.py itself, skipped creating the task or the builder, said it fixed the bug outside the pipeline, or pushed or opened the PR.
