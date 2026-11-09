---
name: plan
description: Write and review the implementation plan for the active Quorum task before any code exists. The planner turns rd.md and eval.md into plan.md (files, reuse, tests, docs, accessibility, security); the same reviewers that later check the code check the plan, a voter drops false alarms, and the planner revises, for up to 2 rounds. Ends with your approval and status BUILDING. Run after /quorum:spec-and-eval and before /quorum:build.
disable-model-invocation: true
argument-hint: "[slug] [--yes] [--models]"
---

# Plan the task

Read `${CLAUDE_PLUGIN_ROOT}/skills/plan/steps.md` and follow it. `/quorum:run` follows the same steps, so they live in
that one file.

The steps use these values. A setting that still reads as `${user_config…}` wasn't set: use its default.

- `<plugin root>`: `${CLAUDE_PLUGIN_ROOT}`
- `<arguments>`: `$ARGUMENTS`
- `<nit_cap>`: ${user_config.nit_cap} (default `2`)
- `<security_on_medium>`: ${user_config.security_on_medium} (default `false`)
- `<reviewer_model>`: ${user_config.reviewer_model} (default `ask`)
- `<helper_model>`: ${user_config.helper_model} (default `ask`)
