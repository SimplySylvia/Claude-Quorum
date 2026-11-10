#!/usr/bin/env bats
load ../helpers

# The hooks with a task in its own git worktree: they find the task from the directory the call ran in (the input's
# cwd), and check that task's worktree. The session's CLAUDE_PROJECT_DIR stays the main working tree, as Claude Code
# keeps it after EnterWorktree.
setup() {
  make_repo
  mkdir -p .claude/hooks app
  printf '# Project\n' > CLAUDE.md
  printf '# Review\n' > REVIEW.md
  echo 'print(1)' > app/report.py
  "$BIN/quorum-render-verify" --check 'unit=if [ -e .fail ]; then echo "worktree check failed"; exit 1; fi; echo ok' > .claude/hooks/verify-completion.sh
  chmod +x .claude/hooks/verify-completion.sh
  echo ".tasks/" > .gitignore
  git add -A && git -c user.name=t -c user.email=t@example.com commit -qm bootstrap
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  "$BIN/quorum-state" --task other init LOW PLANNING
  "$BIN/quorum-branch" start demo --worktree >/dev/null
  "$BIN/quorum-active-task" --set other
  MAIN=$(pwd -P)
  WT="$MAIN/.claude/worktrees/demo"
  export CLAUDE_PROJECT_DIR=$MAIN
}
teardown() { cleanup_repo; }

# hook SCRIPT EVENT CWD [JSON fields]: run a hook as Claude Code would, from CWD.
hook() {
  local script=$1 event=$2 cwd=$3 extra=${4:-'{}'}
  (cd "$cwd" && jq -n --arg e "$event" --arg c "$cwd" --argjson x "$extra" '{hook_event_name: $e, cwd: $c} + $x' | "$HOOKS/$script")
}

@test "Stop in a task's worktree runs that worktree's checks, and counts them on its task" {
  touch "$WT/.fail"
  run hook stop-verify.sh SubagentStop "$WT" '{"agent_type":"quorum:builder"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"worktree check failed"* ]]
  [[ "$output" == *"for task 'demo'"* ]]
  [ "$("$BIN/quorum-state" --task demo get stop_blocks)" = 1 ]
  # The main working tree's session is on another task, still planning: no checks.
  run hook stop-verify.sh Stop "$MAIN"
  [ "$status" -eq 0 ]
  rm "$WT/.fail"
  run hook stop-verify.sh SubagentStop "$WT" '{"agent_type":"quorum:builder"}'
  [ "$status" -eq 0 ]
  [ "$("$BIN/quorum-state" --task demo get stop_blocks)" = 0 ]
}

@test "a session in the main tree on a task with a worktree checks the worktree, not the main tree" {
  "$BIN/quorum-active-task" --set demo
  touch "$WT/.fail"
  run hook stop-verify.sh Stop "$MAIN"
  [ "$status" -eq 2 ]
  [[ "$output" == *"worktree check failed"* ]]
}

@test "a task's blind-mode marker blinds calls in its worktree only" {
  touch .tasks/demo/.blind-mode-active
  run hook block-source-read.sh PreToolUse "$WT" "$(jq -n --arg p "$WT/app/report.py" '{tool_name: "Read", tool_input: {file_path: $p}}')"
  [ "$status" -eq 2 ]
  run hook block-source-read.sh PreToolUse "$MAIN" "$(jq -n --arg p "$MAIN/app/report.py" '{tool_name: "Read", tool_input: {file_path: $p}}')"
  [ "$status" -eq 0 ]
  # the older shared marker still blinds every call
  rm .tasks/demo/.blind-mode-active; touch .tasks/.blind-mode-active
  run hook block-source-read.sh PreToolUse "$MAIN" '{"tool_name":"Read","tool_input":{"file_path":"app/report.py"}}'
  [ "$status" -eq 2 ]
}

@test "gh pr create in a task's worktree records the PR on that task, wherever the hook starts" {
  # The input's cwd says where the command ran; the hook itself starts in the main tree.
  run bash -c 'jq -n --arg c "$1" '"'"'{hook_event_name: "PostToolUse", cwd: $c, tool_name: "Bash", tool_input: {command: "gh pr create --fill"}, tool_response: {stdout: "https://github.com/acme/app/pull/7\n"}}'"'"' | "$2/record-pr.sh"' _ "$WT" "$HOOKS"
  [ "$status" -eq 0 ]
  [ "$("$BIN/quorum-state" --task demo get pr)" = "https://github.com/acme/app/pull/7" ]
  [ -z "$("$BIN/quorum-state" --task other get pr)" ]
}
