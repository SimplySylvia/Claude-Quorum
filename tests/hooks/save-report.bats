#!/usr/bin/env bats
load ../helpers

# The SubagentStop hook that saves an agent's report to the file its prompt names. Each test feeds the hook one
# input and one agent transcript, both in the shape Claude Code 2.1.331 gave them (the input has no
# last_assistant_message; the agent ends by calling SubagentHandback, and its transcript's second `user` entry is a
# harness reminder).
setup() {
  make_repo
  mkdir -p .tasks
  T="$BATS_TEST_TMPDIR/agent-a1.jsonl"
}
teardown() { cleanup_repo; }

# entry JSON-FILTER [jq arguments]: add one line to the transcript.
entry() { local filter=$1; shift; jq --binary -cn "$@" "$filter" >> "$T"; }

# handback REPORT: the agent's closing call, and the tool result that ends its turn.
handback() {
  entry '{type: "assistant", agentId: "a1", message: {role: "assistant", content: [{type: "tool_use", id: "toolu_1", name: "SubagentHandback", input: {message: $r}}]}}' --arg r "$1"
  entry '{type: "user", agentId: "a1", toolEndsTurn: true, message: {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "Report delivered."}]}}'
}

# transcript PROMPT [REPORT]: start the transcript again with an agent given PROMPT, which hands back REPORT if given.
transcript() {
  : > "$T"
  entry '{type: "user", agentId: "a1", isSidechain: true, message: {role: "user", content: $p}}' --arg p "$1"
  entry '{type: "user", agentId: "a1", isMeta: true, message: {role: "user", content: "<system-reminder>\nYour final report is delivered through SubagentHandback.\n</system-reminder>"}}'
  entry '{type: "api-request-blob", agentId: "a1", message: {role: "user", content: [{type: "text", text: $p}]}}' --arg p "$1"
  entry '{type: "assistant", agentId: "a1", message: {role: "assistant", content: [{type: "text", text: "Working on it."}]}}'
  if [ "$#" -ge 2 ]; then handback "$2"; fi
}

# stop_input [JSON fields]: the SubagentStop input for that transcript, with the fields given put over it.
stop_input() {
  local extra=${1:-'{}'}
  jq -n --arg c "$WORK" --arg t "$T" --argjson x "$extra" '{session_id: "s1", cwd: $c, permission_mode: "auto", agent_id: "a1", agent_type: "general-purpose", hook_event_name: "SubagentStop", stop_hook_active: false, agent_transcript_path: $t, background_tasks: []} + $x'
}
stop() { stop_input "$@" | "$HOOKS/save-report.sh"; }

# try LINE [REPORT]: an agent whose prompt ends in LINE stops, having handed back REPORT.
try() { transcript "$(printf 'Review the diff.\n%s' "$1")" "${2-the report}"; stop; }

# The files under .tasks/, one per line: empty when nothing was written, a temporary file included.
written() { (cd "$WORK" && find .tasks -type f | sort); }

# The check a test of "writes nothing" ends with: the same fixture does write when the line is a good one.
control() {
  run try 'Report file: .tasks/control/out.md'
  [ "$(cat "$WORK/.tasks/control/out.md")" = "the report" ]
}

@test "a report is written byte for byte" {
  report=$(printf 'Summary: 0 issues found. Ready to land.\nQuote " dollar $HOME backtick ` letter \303\251 end')
  printf '%s' "$report" > "$BATS_TEST_TMPDIR/want"
  run try 'Report file: .tasks/x/out.md' "$report"
  [ "$status" -eq 0 ]; [ -z "$output" ]
  cmp "$BATS_TEST_TMPDIR/want" .tasks/x/out.md
  [ "$(written)" = ".tasks/x/out.md" ]

  # Inner newlines stay line feeds, and the newlines a report ends with are kept: a shell variable would drop them.
  printf 'one\n\ntwo\n\n' > "$BATS_TEST_TMPDIR/want"
  run try 'Report file: .tasks/x/lines.md' $'one\n\ntwo\n\n'
  [ "$status" -eq 0 ]; [ -z "$output" ]
  cmp "$BATS_TEST_TMPDIR/want" .tasks/x/lines.md
}

@test "parent directories are made" {
  [ ! -e .tasks/a ]
  run try 'Report file: .tasks/a/b/out.md'
  [ "$status" -eq 0 ]
  [ "$(cat .tasks/a/b/out.md)" = "the report" ]
}

@test "an empty or missing report writes nothing" {
  transcript $'Review.\nReport file: .tasks/x/out.md' ''
  run stop;                                       [ "$status" -eq 0 ]; [ -z "$output" ]; [ -z "$(written)" ]
  # An empty hand-back is the report: the input's last message does not stand in for it.
  run stop '{"last_assistant_message": "other"}'; [ "$status" -eq 0 ]; [ -z "$(written)" ]
  transcript $'Review.\nReport file: .tasks/x/out.md'
  run stop;                                       [ "$status" -eq 0 ]; [ -z "$output" ]; [ -z "$(written)" ]
  run stop '{"last_assistant_message": null}';    [ "$status" -eq 0 ]; [ -z "$output" ]; [ -z "$(written)" ]
  run stop '{"last_assistant_message": 7}';       [ "$status" -eq 0 ]; [ -z "$output" ]; [ -z "$(written)" ]
  run stop '{"last_assistant_message": ""}';      [ "$status" -eq 0 ]; [ -z "$output" ]; [ -z "$(written)" ]
  # A hand-back whose message is no text is no hand-back.
  entry '{type: "assistant", message: {role: "assistant", content: [{type: "tool_use", name: "SubagentHandback", input: {message: 7}}]}}'
  run stop;                                       [ "$status" -eq 0 ]; [ -z "$output" ]; [ -z "$(written)" ]
  # A report that was there stays when a later stop has none.
  run try 'Report file: .tasks/x/out.md' 'kept'
  run try 'Report file: .tasks/x/out.md' ''
  [ "$status" -eq 0 ]
  [ "$(cat .tasks/x/out.md)" = "kept" ]
  [ "$(written)" = ".tasks/x/out.md" ]
}

@test "a later stop overwrites the file" {
  run try 'Report file: .tasks/x/out.md' 'first, and the longer of the two'
  [ "$(cat .tasks/x/out.md)" = "first, and the longer of the two" ]
  run try 'Report file: .tasks/x/out.md' 'second'
  [ "$status" -eq 0 ]
  [ "$(cat .tasks/x/out.md)" = "second" ]
  [ "$(written)" = ".tasks/x/out.md" ]
}

@test "a prompt with no Report file line writes nothing" {
  run try 'Save your report in .tasks/x/out.md'
  [ "$status" -eq 0 ]; [ -z "$output" ]
  run try 'Report file:'
  [ "$status" -eq 0 ]; [ -z "$output" ]
  run try 'Report file: '
  [ "$status" -eq 0 ]; [ -z "$output" ]
  [ -z "$(written)" ]
  control
}

@test "of two Report file lines the last counts" {
  transcript $'Report file: .tasks/x/first.md\nReview the diff.\nReport file: .tasks/x/second.md' 'the report'
  run stop
  [ "$status" -eq 0 ]
  [ "$(written)" = ".tasks/x/second.md" ]
  # The last one counts when it is refused, too: the hook does not fall back to an earlier line.
  rm -rf .tasks/x
  transcript $'Report file: .tasks/x/first.md\nReport file: ../second.md' 'the report'
  run stop
  [ "$status" -eq 0 ]
  [ -z "$(written)" ]
}

@test "a line not at column 0 is not a Report file line" {
  run try '  Report file: .tasks/x/indented.md'
  [ "$status" -eq 0 ]
  run try 'Put this last: Report file: .tasks/x/midline.md'
  [ "$status" -eq 0 ]
  run try '> Report file: .tasks/x/quoted.md'
  [ "$status" -eq 0 ]
  [ -z "$(written)" ]
  control
}

@test "a path outside .tasks/ writes nothing" {
  mkdir -p .tasks/dir
  for path in ../outside.md "$BATS_TEST_TMPDIR/abs.md" "$WORK/.tasks/x/abs.md" src/x.md .tasks/../up.md \
    .tasks/x/../../up2.md .tasks .tasks/ .tasks/x/ .tasks//x/out.md .tasks/x/c:out.md .tasks/dir tasks/x/out.md; do
    run try "Report file: $path"
    [ "$status" -eq 0 ]; [ -z "$output" ]
  done
  [ -z "$(written)" ]
  [ ! -e ../outside.md ]; [ ! -e "$BATS_TEST_TMPDIR/abs.md" ]; [ ! -e src ]; [ ! -e up.md ]; [ ! -e up2.md ]
  [ ! -e tasks ]; [ ! -e .tasks/x ]
  [ -z "$(ls -A .tasks/dir)" ]
  control
}

@test "a report path with backslashes is written" {
  run try 'Report file: .tasks\x\out.md'
  [ "$status" -eq 0 ]
  [ "$(written)" = ".tasks/x/out.md" ]
  # and one that climbs out with them is refused like any other
  run try 'Report file: .tasks\..\up.md'
  [ "$status" -eq 0 ]
  [ ! -e up.md ]
  [ "$(written)" = ".tasks/x/out.md" ]
}

@test "a trailing CR, spaces and tabs are not part of the path" {
  transcript "$(printf 'Review the diff.\r\nReport file: .tasks/x/crlf.md\r\n')" 'the report'
  run stop
  [ "$status" -eq 0 ]
  run try "$(printf 'Report file: .tasks/x/blanks.md \t \r')"
  [ "$status" -eq 0 ]
  [ "$(written)" = ".tasks/x/blanks.md"$'\n'".tasks/x/crlf.md" ]
}

@test "rd.md, eval.md and state.md are never written" {
  mkdir -p .tasks/x
  printf 'status: BUILDING\n' > .tasks/x/state.md
  for name in rd.md eval.md state.md RD.md Eval.MD STATE.md rd.md. state.md..; do
    run try "Report file: .tasks/x/$name" 'unlocked: yes'
    [ "$status" -eq 0 ]; [ -z "$output" ]
  done
  run try 'Report file: .tasks/rd.md'
  [ "$status" -eq 0 ]
  [ "$(written)" = ".tasks/x/state.md" ]
  [ "$(cat .tasks/x/state.md)" = "status: BUILDING" ]
  # Only the file's own name counts: a report beside them, or in a folder named like one, is saved.
  run try 'Report file: .tasks/x/rd.md/word.md'
  run try 'Report file: .tasks/x/nord.md'
  [ "$(cat .tasks/x/rd.md/word.md)" = "the report" ]
  [ "$(cat .tasks/x/nord.md)" = "the report" ]
}

@test "a path with a dot segment writes nothing" {
  for path in .tasks/.active .tasks/x/.blind-mode-active .tasks/x/.h/out.md .tasks/x./out.md .tasks/x/./out.md \
    .tasks/x/.. .tasks/x/out.; do
    run try "Report file: $path"
    [ "$status" -eq 0 ]; [ -z "$output" ]
  done
  [ -z "$(written)" ]
  [ ! -e .tasks/x ]; [ ! -e .tasks/x. ]
  control
}

@test "without jq it exits 0 and writes nothing" {
  transcript $'Review.\nReport file: .tasks/x/out.md' 'the report'
  stop_input > "$BATS_TEST_TMPDIR/input.json"
  # A PATH that holds what the hook and its helpers run, and no jq.
  nojq="$BATS_TEST_TMPDIR/nojq"; mkdir -p "$nojq"
  for tool in bash cat dirname git tr mkdir mktemp mv rm grep head sed; do
    printf '#!/bin/sh\nexec "%s" "$@"\n' "$(command -v "$tool")" > "$nojq/$tool"
    chmod +x "$nojq/$tool"
  done
  bash_path=$(command -v bash)
  run env PATH="$nojq" "$bash_path" -c 'command -v jq'
  [ "$status" -ne 0 ]
  run env PATH="$nojq" "$bash_path" "$HOOKS/save-report.sh" < "$BATS_TEST_TMPDIR/input.json"
  [ "$status" -eq 0 ]; [ -z "$output" ]
  [ -z "$(written)" ]
  # With jq back, the same input writes.
  run "$HOOKS/save-report.sh" < "$BATS_TEST_TMPDIR/input.json"
  [ "$(written)" = ".tasks/x/out.md" ]
}

@test "unreadable input exits 0 and prints nothing" {
  transcript $'Review.\nReport file: .tasks/x/out.md' 'the report'
  run bash -c "echo 'not json' | '$HOOKS/save-report.sh'";  [ "$status" -eq 0 ]; [ -z "$output" ]
  run bash -c "'$HOOKS/save-report.sh' < /dev/null";        [ "$status" -eq 0 ]; [ -z "$output" ]
  run bash -c "echo '[1, 2]' | '$HOOKS/save-report.sh'";    [ "$status" -eq 0 ]; [ -z "$output" ]
  # JSON with no transcript, and with no directory to work from
  run stop '{"agent_transcript_path": null}';               [ "$status" -eq 0 ]; [ -z "$output" ]
  run bash -c "jq -n '{hook_event_name: \"SubagentStop\", agent_type: \"general-purpose\"}' | '$HOOKS/save-report.sh'"
  [ "$status" -eq 0 ]; [ -z "$output" ]
  run stop '{"cwd": null}';                                 [ "$status" -eq 0 ]; [ -z "$output" ]
  run stop "$(jq -n --arg c "$WORK/gone" '{cwd: $c}')";     [ "$status" -eq 0 ]; [ -z "$output" ]
  # a transcript that isn't JSON, and one whose first user entry has no text
  printf 'not json\n' > "$T"
  run stop;                                                 [ "$status" -eq 0 ]; [ -z "$output" ]
  : > "$T"
  entry '{type: "user", message: {role: "user"}}'
  handback 'the report'
  run stop;                                                 [ "$status" -eq 0 ]; [ -z "$output" ]
  [ -z "$(written)" ]
  control
}

@test "an empty agent_type or a transcript path with no file does nothing" {
  transcript $'Review.\nReport file: .tasks/x/out.md' 'the report'
  run stop '{"agent_type": ""}';                            [ "$status" -eq 0 ]; [ -z "$output" ]
  run stop '{"agent_type": null}';                          [ "$status" -eq 0 ]; [ -z "$output" ]
  run stop "$(jq -n --arg t "$BATS_TEST_TMPDIR/agent-gone.jsonl" '{agent_transcript_path: $t, last_assistant_message: "other"}')"
  [ "$status" -eq 0 ]; [ -z "$output" ]
  run stop "$(jq -n --arg t "$BATS_TEST_TMPDIR" '{agent_transcript_path: $t}')"
  [ "$status" -eq 0 ]; [ -z "$output" ]
  [ -z "$(written)" ]
  run stop '{"agent_type": "quorum:code-reviewer"}'
  [ "$(cat .tasks/x/out.md)" = "the report" ]
}

@test "the report is the last hand-back's message, and the input's last message only without one" {
  transcript $'Review.\nReport file: .tasks/x/out.md' 'an earlier hand-back'
  handback 'the hand-back'
  entry '{type: "assistant", message: {role: "assistant", content: [{type: "text", text: "Done."}, {type: "tool_use", id: "toolu_2", name: "Bash", input: {message: "not a hand-back"}}]}}'
  run stop '{"last_assistant_message": "Done."}'
  [ "$status" -eq 0 ]; [ -z "$output" ]
  [ "$(cat .tasks/x/out.md)" = "the hand-back" ]
  # No hand-back call: an agent that ended with plain text, as a headless one may.
  printf 'plain\n\n' > "$BATS_TEST_TMPDIR/want"
  transcript $'Review.\nReport file: .tasks/x/plain.md'
  run stop '{"last_assistant_message": "plain\n\n"}'
  [ "$status" -eq 0 ]; [ -z "$output" ]
  cmp "$BATS_TEST_TMPDIR/want" .tasks/x/plain.md
}

@test "the prompt is the transcript's first user entry" {
  # A later user entry (a harness reminder, a tool result) that holds the line names no file.
  transcript 'Review the diff.' 'the report'
  entry '{type: "user", isMeta: true, message: {role: "user", content: "Report file: .tasks/x/later.md"}}'
  run stop
  [ "$status" -eq 0 ]
  [ -z "$(written)" ]
  transcript $'Review the diff.\nReport file: .tasks/x/first.md' 'the report'
  entry '{type: "user", isMeta: true, message: {role: "user", content: "Report file: .tasks/x/later.md"}}'
  run stop
  [ "$(written)" = ".tasks/x/first.md" ]
  # A prompt given as text blocks is read the same way.
  rm -rf .tasks/x
  : > "$T"
  entry '{type: "user", message: {role: "user", content: [{type: "text", text: "Review the diff.\n"}, {type: "image"}, {type: "text", text: "Report file: .tasks/x/blocks.md"}]}}'
  handback 'the report'
  run stop
  [ "$(written)" = ".tasks/x/blocks.md" ]
}

@test "the file goes under the repo's .tasks, from a subdirectory and from backslash paths" {
  mkdir -p sub/dir
  transcript $'Review.\nReport file: .tasks/x/out.md' 'the report'
  run stop "$(jq -n --arg c "$WORK/sub/dir" '{cwd: $c}')"
  [ "$status" -eq 0 ]
  [ "$(written)" = ".tasks/x/out.md" ]
  [ ! -e sub/dir/.tasks ]
  # The input's cwd says where the session works; the hook itself may start anywhere.
  rm -rf .tasks/x
  run bash -c 'cd "$1" && "$2/save-report.sh"' _ "$BATS_TEST_TMPDIR" "$HOOKS" < <(stop_input)
  [ "$status" -eq 0 ]
  [ "$(written)" = ".tasks/x/out.md" ]
  [ ! -e "$BATS_TEST_TMPDIR/.tasks" ]
  # Windows gives cwd and the transcript's path with backslashes.
  rm -rf .tasks/x
  run stop "$(jq -n --arg c "${WORK//\//\\}" --arg t "${T//\//\\}" '{cwd: $c, agent_transcript_path: $t}')"
  [ "$status" -eq 0 ]; [ -z "$output" ]
  [ "$(written)" = ".tasks/x/out.md" ]
}

@test "hooks.json runs it at every SubagentStop, beside the builder's checks" {
  run jq --binary -r '.hooks.SubagentStop[] | select(any(.hooks[]; .command | endswith("/hooks/save-report.sh"))) | [.matcher, (.hooks | length), .hooks[0].type, .hooks[0].timeout] | @json' "$HOOKS/hooks.json"
  [ "$output" = '[null,1,"command",10]' ]
  run jq --binary -r '.hooks.SubagentStop[0].matcher, .hooks.SubagentStop[0].hooks[0].command, (.hooks.SubagentStop | length)' "$HOOKS/hooks.json"
  [ "${lines[0]}" = '^quorum:builder$' ]
  [[ "${lines[1]}" == *"/hooks/stop-verify.sh" ]]
  [ "${lines[2]}" = 2 ]
  [ -x "$HOOKS/save-report.sh" ]
}
