#!/usr/bin/env bats
load ../helpers

# A repo with a map; the hook acts only for the session quorum-map enter named.
setup() {
  make_repo
  mkdir -p app
  "$BIN/quorum-map" --map billing init "Usage billing" >/dev/null
  "$BIN/quorum-map" enter s1 billing
  export CLAUDE_PROJECT_DIR="$WORK"
}
teardown() { cleanup_repo; }

edit() { jq -n --arg s "${3:-s1}" --arg t "${2:-Edit}" --arg p "$1" '{session_id: $s, tool_name: $t, tool_input: {file_path: $p}}' | "$HOOKS/map-guard.sh"; }
bash_cmd() { jq -n --arg s "${2:-s1}" --arg c "$1" '{session_id: $s, tool_name: "Bash", tool_input: {command: $c}}' | "$HOOKS/map-guard.sh"; }

@test "in a map session, the repo's files can't be edited, but the map's can" {
  run edit app/report.py;                   [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED BY QUORUM"* ]]; [[ "$output" == *"plans and never builds"* ]]; [[ "$output" == *"quorum-map leave s1"* ]]
  run edit "$WORK/README.md" Write;         [ "$status" -eq 2 ]
  run edit .tasks/map-billing/map.md;       [ "$status" -eq 0 ]
  run edit "$WORK/.tasks/map-billing/prototypes/01-plans.html" Write; [ "$status" -eq 0 ]
  run edit "$BATS_TEST_TMPDIR/notes.md" Write; [ "$status" -eq 0 ]
}

@test "Bash writes into the repo, commits, and starting a build are blocked; reading and .tasks/ writes aren't" {
  run bash_cmd 'echo x > app/new.py';                [ "$status" -eq 2 ]
  run bash_cmd "sed -i '' s/a/b/ app/report.py";     [ "$status" -eq 2 ]
  run bash_cmd 'git add -A && git commit -m wip';    [ "$status" -eq 2 ]
  run bash_cmd 'git -C . push origin HEAD';          [ "$status" -eq 2 ]
  run bash_cmd 'quorum-branch start billing-api';    [ "$status" -eq 2 ]
  run bash_cmd 'git log --oneline | head -5';        [ "$status" -eq 0 ]
  run bash_cmd 'cat app/report.py';                  [ "$status" -eq 0 ]
  run bash_cmd 'echo q > .tasks/map-billing/research/01.md'; [ "$status" -eq 0 ]
  run bash_cmd 'git commit-tree --help >/dev/null';  [ "$status" -eq 0 ]
}

@test "other sessions, and the session after quorum-map leave, aren't affected" {
  run edit app/report.py Edit s2;           [ "$status" -eq 0 ]
  run bash_cmd 'git commit -m x' s2;        [ "$status" -eq 0 ]
  "$BIN/quorum-map" leave s1
  run edit app/report.py;                   [ "$status" -eq 0 ]
}
