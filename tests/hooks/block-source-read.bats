#!/usr/bin/env bats
load ../helpers

setup() { make_repo; mkdir -p app .tasks/demo; echo 'print(1)' > app/report.py; echo '# Readme' > README.md; export CLAUDE_PROJECT_DIR="$WORK"; }
teardown() { cleanup_repo; }

# call TOOL INPUT_JSON [AGENT]
call() {
  local agent=${3-quorum:blind-user}
  jq -n --arg t "$1" --argjson i "$2" --arg a "$agent" '{hook_event_name: "PreToolUse", tool_name: $t, tool_input: $i, agent_type: (if $a == "" then null else $a end)}' \
    | "$HOOKS/block-source-read.sh"
}
bash_cmd() { call Bash "$(jq -n --arg c "$1" '{command: $c}')" "${2-quorum:blind-user}"; }

@test "other agents and the main session are never blocked" {
  run call Read '{"file_path":"app/report.py"}' quorum:builder;  [ "$status" -eq 0 ]
  run call Read '{"file_path":"app/report.py"}' "";              [ "$status" -eq 0 ]
  run bash_cmd "cat app/report.py" "";                            [ "$status" -eq 0 ]
}

@test "Read of a source file is blocked with the blueprint's message" {
  run call Read '{"file_path":"app/report.py"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED BY BLIND-TEST HOOK: You are operating as a First-Time User."* ]]
}

@test "absolute paths and ./ prefixes are normalized" {
  run call Read "{\"file_path\":\"$WORK/app/report.py\"}"; [ "$status" -eq 2 ]
  run call Read '{"file_path":"./app/report.py"}';        [ "$status" -eq 2 ]
}

@test "blocked by extension outside the blocked folders" {
  echo x > tool.py
  run call Read '{"file_path":"tool.py"}'
  [ "$status" -eq 2 ]
}

@test "docs, task files, and data are readable" {
  run call Read '{"file_path":"README.md"}';           [ "$status" -eq 0 ]
  run call Read '{"file_path":".tasks/demo/rd.md"}';   [ "$status" -eq 0 ]
  run call Read '{"file_path":"data/sales.json"}';     [ "$status" -eq 0 ]
}

@test "Edit and Write of source are blocked" {
  run call Edit '{"file_path":"app/report.py","old_string":"a","new_string":"b"}'; [ "$status" -eq 2 ]
  run call Write '{"file_path":"src/x.ts","content":""}';                          [ "$status" -eq 2 ]
}

@test "Grep and Glob are blocked except under .tasks" {
  run call Grep '{"pattern":"def"}';                        [ "$status" -eq 2 ]
  run call Glob '{"pattern":"**/*.py"}';                    [ "$status" -eq 2 ]
  run call Grep '{"pattern":"x","path":".tasks/demo"}';     [ "$status" -eq 0 ]
}

@test "Bash: reading commands on source are blocked" {
  for c in "cat app/report.py" "sed -n 1,5p app/report.py" "head -20 app/report.py" "grep -n def app/report.py" \
           "rg main ." "grep -r def ." "find . -name '*.py'" "ls app" "less app/report.py" "awk 1 app/report.py" \
           "wc -l < app/report.py" "cd /tmp && cat $WORK/app/report.py"; do
    run bash_cmd "$c"
    [ "$status" -eq 2 ] || { echo "not blocked: $c"; false; }
  done
}

@test "Bash: inline interpreter code that opens source is blocked" {
  run bash_cmd "python3 -c \"print(open('app/report.py').read())\""
  [ "$status" -eq 2 ]
}

@test "Bash: running the app and reading its output is allowed" {
  for c in "python3 app/report.py export" "python3 app/report.py export | head -3" "python3 app/report.py summary data/sales.json" \
           "curl -s http://localhost:8000/health" "ls" "cat README.md" "make test" "python3 app/report.py export > /tmp/out.csv && cat /tmp/out.csv"; do
    run bash_cmd "$c"
    [ "$status" -eq 0 ] || { echo "wrongly blocked: $c"; false; }
  done
}

@test "the lockfile turns blind mode on for any caller" {
  run bash_cmd "cat app/report.py" ""
  [ "$status" -eq 0 ]
  touch .tasks/.blind-mode-active
  run bash_cmd "cat app/report.py" ""
  [ "$status" -eq 2 ]
}

@test "block lists come from plugin options and .claude/quorum.json" {
  mkdir -p web && echo x > web/page.html
  run call Read '{"file_path":"web/page.html"}'; [ "$status" -eq 0 ]
  CLAUDE_PLUGIN_OPTION_BLIND_BLOCK_DIRS=web run call Read '{"file_path":"web/page.html"}'; [ "$status" -eq 2 ]
  mkdir -p .claude && echo '{"blind_block_dirs":"web","blind_block_exts":"html"}' > .claude/quorum.json
  run call Read '{"file_path":"web/page.html"}'; [ "$status" -eq 2 ]
  run call Read '{"file_path":"app/report.py"}'; [ "$status" -eq 0 ]
}

@test "known gap stays documented: an interpreter given a script file is allowed" {
  # Running code is how a user runs the app, so `python3 script.py` is allowed even if the script reads source.
  printf "print(open('app/report.py').read())\n" > /tmp/quorum-peek-$$.py
  run bash_cmd "python3 /tmp/quorum-peek-$$.py"
  rm -f /tmp/quorum-peek-$$.py
  [ "$status" -eq 0 ]
}

@test "hooks.json wires every file-reading tool to this hook" {
  run jq -r '.hooks.PreToolUse[0].matcher' "$HOOKS/hooks.json"
  [ "$output" = "Read|Grep|Glob|Bash|Edit|Write|NotebookEdit" ]
}
