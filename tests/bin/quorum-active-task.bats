#!/usr/bin/env bats
load ../helpers

setup() { make_repo; }
teardown() { cleanup_repo; }

@test "no task: exits 1 with a hint" {
  run "$BIN/quorum-active-task"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no active task"* ]]
}

@test "feat/<slug> branch with a task folder wins" {
  mkdir -p .tasks/export-csv .tasks/other
  echo other > .tasks/.active
  git checkout -q -b feat/export-csv
  run "$BIN/quorum-active-task"
  [ "$status" -eq 0 ]
  [ "$output" = "export-csv" ]
}

@test "fix/<slug> branch works too" {
  mkdir -p .tasks/null-crash
  git checkout -q -b fix/null-crash
  run "$BIN/quorum-active-task"
  [ "$output" = "null-crash" ]
}

@test "branch without a task folder falls back to .tasks/.active" {
  mkdir -p .tasks/from-file
  echo from-file > .tasks/.active
  git checkout -q -b feat/no-folder
  run "$BIN/quorum-active-task"
  [ "$status" -eq 0 ]
  [ "$output" = "from-file" ]
}

@test ".tasks/.active pointing at a missing folder is ignored" {
  mkdir -p .tasks
  echo gone > .tasks/.active
  run "$BIN/quorum-active-task"
  [ "$status" -eq 1 ]
}

@test "--set writes .tasks/.active, --clear removes it" {
  mkdir -p .tasks/demo
  run "$BIN/quorum-active-task" --set demo
  [ "$status" -eq 0 ]
  [ "$(cat .tasks/.active)" = "demo" ]
  run "$BIN/quorum-active-task" --clear
  [ ! -e .tasks/.active ]
}

@test "--set refuses a missing folder and a bad slug" {
  mkdir -p .tasks
  run "$BIN/quorum-active-task" --set missing
  [ "$status" -eq 1 ]
  run "$BIN/quorum-active-task" --set "../escape"
  [ "$status" -eq 1 ]
  [[ "$output" == *"invalid slug"* ]]
}

@test "CLAUDE_PROJECT_DIR sets the root" {
  other="$(mktemp -d)"; mkdir -p "$other/.tasks/elsewhere"; echo elsewhere > "$other/.tasks/.active"
  CLAUDE_PROJECT_DIR="$other" run "$BIN/quorum-active-task"
  [ "$output" = "elsewhere" ]
  rm -rf "$other"
}

# all_modes LABEL [VAR=VALUE ...]: from the current directory, run each mode once with the counting shim on PATH and
# append "LABEL MODE rc=N" and its output to ACTUAL, with $WORK's physical and logical paths both written as $WORK.
# After each run, check the shim's log: at most one `rev-parse --show-toplevel` call per -C directory, and at most one other
# rev-parse call for it (the dirs-only call, made only when there's no work tree).
all_modes() {
  local label=$1 m out rc w; shift
  w=$(cd "$WORK" && pwd -P)
  for m in "" --root --code --main --list; do
    : > "$GIT_LOG"
    if out=$(env "$@" PATH="$SHIM:$PATH" QUORUM_GIT_CANDIDATES="$SHIM/git" "$BIN/quorum-active-task" $m 2>&1); then rc=0; else rc=$?; fi
    ACTUAL="$ACTUAL$label ${m:-default} rc=$rc
$out
"
    ACTUAL=${ACTUAL//"$w"/\$WORK}; ACTUAL=${ACTUAL//"$WORK"/\$WORK}
    if ! awk '/ rev-parse / { d = ""; for (i = 1; i < NF; i++) if ($i == "-C") { d = $(i + 1); break }
              if (/--show-toplevel/) t[d]++; else o[d]++ }
              END { for (d in t) if (t[d] > 1) bad = 1; for (d in o) if (o[d] > 1) bad = 1; exit bad }' "$GIT_LOG"; then
      echo "too many rev-parse calls for $label ${m:-default}:"; cat "$GIT_LOG"; return 1
    fi
  done
}

@test "each mode prints the same as the base commit with one rev-parse per directory" {
  SHIM="$BATS_TEST_TMPDIR/shim"; git_shim "$SHIM"; export GIT_LOG="$BATS_TEST_TMPDIR/git.log"
  mkdir -p .tasks/demo; "$BIN/quorum-state" --task demo init HIGH; echo demo > .tasks/.active
  git worktree add -q -b feat/demo "$WORK/wt"
  git clone -q --bare "$WORK" "$WORK/bare.git"
  git init -q -b main "$WORK/unborn"; mkdir -p "$WORK/unborn/.tasks/u"; echo u > "$WORK/unborn/.tasks/.active"
  mkdir -p "$WORK/plain/.tasks/p"; echo p > "$WORK/plain/.tasks/.active"
  ACTUAL=
  cd "$WORK"; all_modes main
  cd "$WORK/wt"; all_modes linked
  cd "$WORK/.git"; all_modes dotgit
  cd "$WORK/bare.git"; all_modes bare
  cd "$WORK/unborn"; all_modes unborn
  cd "$WORK"; all_modes plain CLAUDE_PROJECT_DIR="$WORK/plain"
  printf '%s' "$ACTUAL" > "$BATS_TEST_TMPDIR/actual"
  # Recorded by running the base commit's quorum-active-task in each situation.
  cat > "$BATS_TEST_TMPDIR/expected" <<'EOF'
main default rc=0
demo
main --root rc=0
$WORK
main --code rc=0
$WORK
main --main rc=0
$WORK
main --list rc=0
demo	BUILDING	
linked default rc=0
demo
linked --root rc=0
$WORK
linked --code rc=0
$WORK/wt
linked --main rc=0
$WORK
linked --list rc=0
demo	BUILDING	
dotgit default rc=1
quorum-active-task: no active task (use a feat/<slug> or fix/<slug> branch, or run /quorum:spec-and-eval)
dotgit --root rc=0
$WORK/.git
dotgit --code rc=0
$WORK/.git
dotgit --main rc=0
$WORK/.git
dotgit --list rc=0

bare default rc=1
quorum-active-task: no active task (use a feat/<slug> or fix/<slug> branch, or run /quorum:spec-and-eval)
bare --root rc=0
$WORK/bare.git
bare --code rc=0
$WORK/bare.git
bare --main rc=0
$WORK/bare.git
bare --list rc=0

unborn default rc=0
u
unborn --root rc=0
$WORK/unborn
unborn --code rc=0
$WORK/unborn
unborn --main rc=0
$WORK/unborn
unborn --list rc=0

plain default rc=0
p
plain --root rc=0
$WORK/plain
plain --code rc=0
$WORK
plain --main rc=0
$WORK/plain
plain --list rc=0

EOF
  diff "$BATS_TEST_TMPDIR/expected" "$BATS_TEST_TMPDIR/actual"
}

@test "a repo path with a newline resolves as at the base commit, and --all refuses it" {
  dir="$BATS_TEST_TMPDIR/a
b"
  mkdir -p "$dir/sub"; cd "$dir"
  git init -q -b main; git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
  mkdir -p .tasks/demo; echo demo > .tasks/.active
  cd sub; p=$(cd "$dir" && pwd -P)
  for m in --root --code --main; do
    run "$BIN/quorum-active-task" "$m"
    [ "$status" -eq 0 ]; [ "$output" = "$p" ]
  done
  run "$BIN/quorum-active-task"
  [ "$status" -eq 0 ]; [ "$output" = demo ]
  if out=$("$BIN/quorum-active-task" --all 2>/dev/null); then rc=0; else rc=$?; fi
  [ "$rc" -eq 1 ]; [ -z "$out" ]
}

@test "all prints slug, root, code and main on four lines that read back safely" {
  mkdir -p .tasks/demo; echo demo > .tasks/.active
  git worktree add -q -b feat/demo "$WORK/wt"
  for d in "$WORK" "$WORK/wt"; do
    cd "$d"
    out=$("$BIN/quorum-active-task" --all; echo "rc=$?")
    [ "$out" = "$("$BIN/quorum-active-task")
$("$BIN/quorum-active-task" --root)
$("$BIN/quorum-active-task" --code)
$("$BIN/quorum-active-task" --main)
rc=0" ]
  done
  # No task: an empty first line, exit 0, and each IFS= read -r gets its own field.
  cd "$WORK"; rm .tasks/.active; w=$(pwd -P)
  out=$("$BIN/quorum-active-task" --all; echo "rc=$?")
  [ "$out" = "
$w
$w
$w
rc=0" ]
  { IFS= read -r s; IFS= read -r r; IFS= read -r c; IFS= read -r m; } <<EOF
$out
EOF
  [ -z "$s" ]; [ "$r" = "$w" ]; [ "$c" = "$w" ]; [ "$m" = "$w" ]
  # A root with a space, a $ and quotes reads back unchanged.
  odd="$BATS_TEST_TMPDIR/sp ace \$x \"dq\" 'sq'"
  mkdir -p "$odd"; cd "$odd"; git init -q -b main; o=$(pwd -P)
  { IFS= read -r s; IFS= read -r r; IFS= read -r c; IFS= read -r m; } <<EOF
$("$BIN/quorum-active-task" --all)
EOF
  [ -z "$s" ]; [ "$r" = "$o" ]; [ "$c" = "$o" ]; [ "$m" = "$o" ]
  # A root with a newline: nothing on stdout or stderr, exit 1.
  nl="$BATS_TEST_TMPDIR/n
l"
  mkdir -p "$nl"; cd "$nl"; git init -q -b main
  run "$BIN/quorum-active-task" --all
  [ "$status" -eq 1 ]; [ -z "$output" ]
}
