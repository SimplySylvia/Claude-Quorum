---
type: llm
weight: 3
---

PASS if the reply lists improvements most severe first, including (1) a rule that stops hand-joined CSV fields, as a pattern rule or a REVIEW.md rule, citing that the voter kept "Unescaped CSV fields" in both review rounds, and (2) wiring `make fmt-check` into .claude/hooks/verify-completion.sh, because the repo has the check but the script doesn't run it. Each says what happened, the exact fix, and why a cheaper form won't do, and the reply asks which to apply.
FAIL if it applies any change before asking, misses either of the two, or invents a lesson the records don't show.
