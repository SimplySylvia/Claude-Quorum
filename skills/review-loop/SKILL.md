---
name: review-loop
description: Run Quorum's review loop on the active task. Fresh-context reviewers audit only the new lines, a verifier-voter drops false alarms, and the builder fixes each surviving Pattern Category everywhere it appears, for up to max_rounds rounds. Ends CONVERGED (LOW tasks get their final summary) or HALTED with a post-mortem. Run after /quorum:build and /quorum:simplify-diff, and again after /quorum:blind-test finds problems.
disable-model-invocation: true
argument-hint: "[--models]"
---

# Review loop

Read `${CLAUDE_PLUGIN_ROOT}/skills/review-loop/steps.md` and follow it. `/quorum:run` follows the same steps, so they live in
that one file.

The steps use these values. A setting that still reads as `${user_config…}` wasn't set: use its default.

- `<plugin root>`: `${CLAUDE_PLUGIN_ROOT}`
- `<session>`: `${CLAUDE_SESSION_ID}`
- `<arguments>`: `$ARGUMENTS`
- `<max_rounds>`: ${user_config.max_rounds} (default `3`)
- `<nit_cap>`: ${user_config.nit_cap} (default `2`)
- `<reviewer_model>`: ${user_config.reviewer_model} (default `ask`)
- `<helper_model>`: ${user_config.helper_model} (default `ask`)
