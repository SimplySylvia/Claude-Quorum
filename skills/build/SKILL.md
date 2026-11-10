---
name: build
description: Start the first build for the active Quorum task from its approved plan. Creates the feat/<slug> or fix/<slug> branch, records base_sha, and runs the builder agent, which follows plan.md and can't finish until the repo's checks pass. Run after /quorum:plan.
disable-model-invocation: true
argument-hint: "[slug] [--worktree]"
---

# Build the active task

Read `${CLAUDE_PLUGIN_ROOT}/skills/build/steps.md` and follow it. `/quorum:run` follows the same steps, so they live in
that one file.

The steps use these values. A setting that still reads as `${user_config…}` wasn't set: use its default.

- `<arguments>`: `$ARGUMENTS`
- `<session>`: `${CLAUDE_SESSION_ID}`
- `<worktrees>`: ${user_config.worktrees} (default `false`)
