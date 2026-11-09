---
name: simplify-diff
description: Shrink the active Quorum task's diff before review. Removes debug output, dead code, commented-out code, unused imports, needless abstractions, and changes unrelated to rd.md, then re-runs the checks and commits. Run after /quorum:build and before /quorum:review-loop.
disable-model-invocation: true
---

# Simplify the diff

Read `${CLAUDE_PLUGIN_ROOT}/skills/simplify-diff/steps.md` and follow it. `/quorum:run` follows the same steps, so they live in
that one file.
