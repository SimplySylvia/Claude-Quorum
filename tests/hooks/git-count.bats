#!/usr/bin/env bats
load ../helpers

# How many git processes the hooks and helpers start, counted through git_shim's log. The fixture is the one
# assets/src/bench-hooks.sh builds: an active BUILDING task "demo" with no base_sha and a run-session marker.
teardown() { if [ -n "${WORK:-}" ]; then cleanup_repo; fi; }

@test "the five PreToolUse hooks spawn at most 25 git processes for one Bash call" {
  run bash "$REPO_ROOT/assets/src/bench-hooks.sh"
  [ "$status" -eq 0 ]
  last=$(printf '%s\n' "$output" | tail -n 1)
  [[ "$last" =~ ^total\ ([0-9]+)\ git\ [0-9]+\ ms$ ]]
  total=${BASH_REMATCH[1]}
  [ "$(printf '%s\n' "$output" | grep -cE '^[a-z-]+\.sh [0-9]+ git [0-9]+ ms$')" -eq 5 ]
  [ "$total" -le 25 ]
}

@test "quorum-state with --task and --root and an exported probe spawns at most 1 git process" {
  make_repo
  "$BIN/quorum-state" --task demo init LOW BUILDING >/dev/null
  "$BIN/quorum-active-task" --set demo
  "$BIN/quorum-run" enter bench-session
  git_shim "$BATS_TEST_TMPDIR/shim"
  export PATH="$BATS_TEST_TMPDIR/shim:$PATH" QUORUM_GIT_CANDIDATES="$BATS_TEST_TMPDIR/shim/git"
  unset QUORUM_GIT_USE QUORUM_GIT_PROBE QUORUM_REAL_GIT
  # shellcheck source=libexec/git-probe.sh
  . "$REPO_ROOT/libexec/git-probe.sh"
  quorum_git_probe
  export GIT_LOG="$BATS_TEST_TMPDIR/git.log"
  : > "$GIT_LOG"
  run "$BIN/quorum-state" --task demo --root "$WORK" get status
  [ "$status" -eq 0 ]
  [ "$output" = BUILDING ]
  [ "$(wc -l < "$GIT_LOG")" -le 1 ]
  # --root is taken as given: the one process allowed is never the resolver's rev-parse.
  [ "$(grep -c rev-parse "$GIT_LOG")" -eq 0 ]
}
