#!/usr/bin/env bats
load ../helpers

setup() {
  make_repo
  export CLAUDE_PROJECT_DIR="$WORK"
  git switch -q -c feat/demo
  "$BIN/quorum-state" --task demo init MEDIUM IN_REVIEW
}
teardown() { cleanup_repo; }

# ran COMMAND STDOUT: the PostToolUse input for a Bash call that printed STDOUT.
ran() {
  jq -n --arg c "$1" --arg o "$2" '{hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {command: $c}, tool_response: {stdout: $o, stderr: ""}}' \
    | "$HOOKS/record-pr.sh"
}

@test "gh pr create's URL is recorded as the task's pr" {
  run ran 'gh pr create --title "Export" --body-file .tasks/demo/pr-body.md' $'Creating pull request for feat/demo into main\n\nhttps://github.com/acme/app/pull/42\n'
  [ "$status" -eq 0 ]; [ -z "$output" ]
  run "$BIN/quorum-state" --task demo get pr
  [ "$output" = "https://github.com/acme/app/pull/42" ]
}

@test "other commands, and output with no PR URL, record nothing" {
  run ran 'gh pr view 42' 'https://github.com/acme/app/pull/42'; [ "$status" -eq 0 ]
  run ran 'echo gh-pr-create' 'https://github.com/acme/app/pull/42'; [ "$status" -eq 0 ]
  run ran 'gh pr create --fill' 'pull request create failed: GraphQL: No commits between main and feat/demo'; [ "$status" -eq 0 ]
  run "$BIN/quorum-state" --task demo get pr
  [ -z "$output" ]
}

@test "with no active task, or input that isn't JSON, it exits 0 quietly" {
  git switch -q main
  run ran 'gh pr create --fill' 'https://github.com/acme/app/pull/42'
  [ "$status" -eq 0 ]; [ -z "$output" ]
  run bash -c "echo 'not json' | '$HOOKS/record-pr.sh'"
  [ "$status" -eq 0 ]; [ -z "$output" ]
}

@test "hooks.json runs it after Bash calls" {
  run jq -r '.hooks.PostToolUse[] | select(.matcher == "Bash") | .hooks[].command' "$HOOKS/hooks.json"
  [[ "$output" == *"/hooks/record-pr.sh" ]]
}
