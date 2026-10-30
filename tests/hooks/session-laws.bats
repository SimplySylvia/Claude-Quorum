#!/usr/bin/env bats
load ../helpers

setup() { make_repo; }
teardown() { cleanup_repo; }

ctx() { echo '{"hook_event_name":"SessionStart","source":"startup"}' | CLAUDE_PROJECT_DIR="$1" "$HOOKS/session-laws.sh" | jq -r '.hookSpecificOutput.additionalContext'; }

@test "prints valid SessionStart JSON with the three laws" {
  run bash -c "echo '{}' | CLAUDE_PROJECT_DIR='$WORK' '$HOOKS/session-laws.sh' | jq -e '.hookSpecificOutput.hookEventName == \"SessionStart\"'"
  [ "$status" -eq 0 ]
  run ctx "$WORK"
  [[ "$output" == *"Proof before \"done\""* ]]
  [[ "$output" == *"Branch hygiene"* ]]
  [[ "$output" == *"REVIEW.md"* ]]
}

@test "suggests init-pipeline in a git repo without REVIEW.md" {
  run ctx "$WORK"
  [[ "$output" == *"/quorum:init-pipeline"* ]]
}

@test "no suggestion once REVIEW.md exists" {
  touch "$WORK/REVIEW.md"
  run ctx "$WORK"
  [[ "$output" != *"/quorum:init-pipeline"* ]]
}

@test "no suggestion outside a git repo" {
  plain="$(mktemp -d)"
  run ctx "$plain"
  [[ "$output" != *"/quorum:init-pipeline"* ]]
  rm -rf "$plain"
}

@test "stays short: under 15 lines" {
  run ctx "$WORK"
  [ "${#lines[@]}" -lt 15 ]
}

@test "hooks.json registers the hook and the script exists" {
  run jq -r '.hooks.SessionStart[0].hooks[0].command' "$HOOKS/hooks.json"
  [[ "$output" == *"/hooks/session-laws.sh"* ]]
  [ -x "$HOOKS/session-laws.sh" ]
}
