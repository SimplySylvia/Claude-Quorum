#!/usr/bin/env bats
load ../helpers

# A fake Claude Code config dir with one project's session log.
setup() {
  make_repo
  export CLAUDE_CONFIG_DIR="$WORK/.claude-config" CLAUDE_PROJECT_DIR="$WORK"
  LOGS="$CLAUDE_CONFIG_DIR/projects/$(printf '%s' "$WORK" | sed 's/[^A-Za-z0-9]/-/g')"
  mkdir -p "$LOGS"
  use() { jq -cn --arg id "$1" --arg n "$2" --argjson in "$3" '{type: "assistant", message: {content: [{type: "tool_use", id: $id, name: $n, input: $in}]}}'; }
  res() { jq -cn --arg id "$1" --argjson e "$2" --arg c "$3" '{type: "user", message: {content: [{type: "tool_result", tool_use_id: $id, is_error: $e, content: $c}]}}'; }
  {
    jq -cn '{type: "user", message: {content: "Please add the export command. My secret plan is here."}}'
    for i in 1 2 3; do use "r$i" Read '{"file_path":"app/report.py"}'; res "r$i" false "def main(): secret body"; done
    for i in 4 5 6 7 8 9; do use "g$i" Grep '{"pattern":"money"}'; res "g$i" false "app/report.py:3"; done
    use e1 Edit '{"file_path":"app/report.py"}'; res e1 false ok
    use b1 Bash '{"command":"make tset"}'; res b1 true $'Exit code 2\nmake: *** No rule to make target'
    use b2 Bash '{"command":"make tset"}'; res b2 true $'Exit code 2\nmake: *** No rule to make target'
    use b3 Bash '{"command":"cat .env"}'; res b3 true "BLOCKED BY QUORUM: .env holds credentials"
    use a1 Agent '{"subagent_type":"quorum:researcher","prompt":"x"}'; res a1 false done
  } > "$LOGS/s1.jsonl"
}
teardown() { cleanup_repo; }
qs() { "$BIN/quorum-session" "$@"; }

@test "path finds a session by id, or this project's newest" {
  [ "$(qs path s1)" = "$LOGS/s1.jsonl" ]
  [ "$(qs path)" = "$LOGS/s1.jsonl" ]
  run qs path nope; [ "$status" -eq 1 ]
  run qs path '../x'; [ "$status" -eq 2 ]
  [ "$(qs list | cut -f1)" = s1 ]
  [ -z "$(qs list --since 2999-01-01)" ]
}

@test "summary counts tools, failures, blocks, rereads, and hunts, and never prints content" {
  run qs summary s1
  [ "$status" -eq 0 ]
  [[ "$output" == *$'tools\tGrep\t6'* ]]
  [[ "$output" == *$'tools\tRead\t3'* ]]
  [[ "$output" == *$'agents\tquorum:researcher\t1'* ]]
  [[ "$output" == *$'failed\tBash\t3'* ]]
  [ "$(printf '%s\n' "$output" | grep -c '^error')" -eq 1 ]
  [[ "$output" == *$'error\tBash\tExit code 2: make: *** No rule to make target'* ]]
  [[ "$output" == *$'blocked\tBLOCKED BY QUORUM\t1'* ]]
  [[ "$output" == *$'reread\tapp/report.py\t3'* ]]
  [[ "$output" == *$'hunt\t9\t1'* ]]
  [[ "$output" != *secret* ]]
}
