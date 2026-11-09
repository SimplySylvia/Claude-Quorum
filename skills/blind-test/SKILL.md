---
name: blind-test
description: Run Quorum's last automated layers on a CONVERGED MEDIUM or HIGH task. A security-only review (HIGH, or MEDIUM with security_on_medium), then a blind user who can't read the source tries the task's goal through the running app, plus a live WCAG 2.2 check for UI changes and a triage of the friction it reports. Problems go back to /quorum:review-loop; a clean run prints the final summary and waits for your review.
disable-model-invocation: true
argument-hint: "[--models]"
---

# Security pass and blind test

Read `${CLAUDE_PLUGIN_ROOT}/skills/blind-test/steps.md` and follow it. `/quorum:run` follows the same steps, so they live in
that one file.

The steps use these values. A setting that still reads as `${user_config…}` wasn't set: use its default.

- `<plugin root>`: `${CLAUDE_PLUGIN_ROOT}`
- `<arguments>`: `$ARGUMENTS`
- `<security_on_medium>`: ${user_config.security_on_medium} (default `false`)
- `<reviewer_model>`: ${user_config.reviewer_model} (default `ask`)
- `<helper_model>`: ${user_config.helper_model} (default `ask`)
