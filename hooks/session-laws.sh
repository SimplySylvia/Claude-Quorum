#!/usr/bin/env bash
# SessionStart hook: add Quorum's three universal laws to Claude's context.
# A plugin can't ship an always-on CLAUDE.md, so this hook stands in for one. Keep the text short: it loads into
# every session. In a git repo without REVIEW.md, it also suggests /quorum:init-pipeline. Never blocks.
set -uo pipefail

cat >/dev/null 2>&1 || true   # hook input is unused

root=${CLAUDE_PROJECT_DIR:-$(pwd)}

laws='Quorum laws (from the quorum plugin):
1. Proof before "done": never call a task, fix, or feature complete without running verification (tests, typecheck, build, or a live check) and showing the passing output.
2. Branch hygiene: work on a feat/<slug> or fix/<slug> branch with small commits, so any change can be reverted in one step.
3. Read the repo first: before building or reviewing, read ./CLAUDE.md and ./REVIEW.md and follow them.'

if "$(cd "$(dirname "$0")" && pwd)/../bin/quorum-git" -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ ! -f "$root/REVIEW.md" ]; then
  laws="$laws
This repo has no REVIEW.md yet. If the user wants Quorum's review pipeline here, suggest running /quorum:init-pipeline."
fi

jq -n --arg ctx "$laws" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
exit 0
