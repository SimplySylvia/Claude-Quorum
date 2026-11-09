---
name: pr-draft
description: Draft the pull request for a finished Quorum task. The PR writer turns the spec, state log, proof, and diff into a description in the repo's PR style, and lists commits that must not ship (such as a local setup commit). Saves it to .tasks/<slug>/pr.md; never pushes or opens the PR. Run when a task is READY or AWAITING-HUMAN.
disable-model-invocation: true
argument-hint: "[slug] [--models]"
---

# Draft the PR

Read `${CLAUDE_PLUGIN_ROOT}/skills/pr-draft/steps.md` and follow it. `/quorum:run` follows the same steps, so they live in
that one file.

The steps use these values. A setting that still reads as `${user_config…}` wasn't set: use its default.

- `<plugin root>`: `${CLAUDE_PLUGIN_ROOT}`
- `<arguments>`: `$ARGUMENTS`
- `<reviewer_model>`: ${user_config.reviewer_model} (default `ask`)
- `<helper_model>`: ${user_config.helper_model} (default `ask`)
