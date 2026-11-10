#!/usr/bin/env bats
load ../helpers

# A PATH whose `git` fails the way Apple's launcher does in a sandbox, and a "real" git elsewhere.
setup() {
  make_repo
  FAKE="$BATS_TEST_TMPDIR/fake"; mkdir -p "$FAKE/shim" "$FAKE/real"
  printf '#!/bin/sh\necho "xcode-select: Failed to locate '"'"'git'"'"'" >&2\nexit 72\n' > "$FAKE/shim/git"
  # The "real" git starts git again from PATH for `child`, as git worktree add does.
  printf '#!/bin/sh\n[ "$1" = --version ] && { echo "git version 9"; exit 0; }\n[ "$1" = child ] && exec git --version\necho "real git: $*"\n' > "$FAKE/real/git"
  chmod +x "$FAKE/shim/git" "$FAKE/real/git"
}
teardown() { cleanup_repo; }

@test "a working git on PATH is used as is" {
  run "$BIN/quorum-git" rev-parse --is-inside-work-tree
  [ "$status" -eq 0 ]; [ "$output" = "true" ]
}

@test "when git on PATH fails, a working candidate runs instead, with the same arguments" {
  run env PATH="$FAKE/shim:/usr/bin:/bin" QUORUM_GIT_CANDIDATES="/nonexistent/git $FAKE/real/git" "$BIN/quorum-git" diff --stat a..b
  [ "$status" -eq 0 ]; [ "$output" = "real git: diff --stat a..b" ]
}

@test "with no candidate working, the PATH git's own error comes through" {
  run env PATH="$FAKE/shim:/usr/bin:/bin" QUORUM_GIT_CANDIDATES="/nonexistent/git" "$BIN/quorum-git" status
  [ "$status" -eq 72 ]; [[ "$output" == *"xcode-select"* ]]
}

@test "Quorum's scripts reach git through quorum-git" {
  for f in quorum-branch quorum-state quorum-active-task; do
    grep -q 'git() { "$HERE/quorum-git" "$@"; }' "$BIN/$f" || { echo "$f doesn't route git through quorum-git"; return 1; }
  done
  run env PATH="$FAKE/shim:$BIN:/usr/bin:/bin" QUORUM_GIT_CANDIDATES="$FAKE/real/git" CLAUDE_PROJECT_DIR="$WORK" "$BIN/quorum-branch" default
  [ "$status" -eq 0 ]
  [[ "$output" == *"real git: symbolic-ref"* ]]
}

@test "a git the candidate starts as a child process runs the candidate too, not the broken PATH git" {
  run env PATH="$FAKE/shim:/usr/bin:/bin" QUORUM_GIT_CANDIDATES="$FAKE/real/git" "$BIN/quorum-git" child
  [ "$status" -eq 0 ]; [ "$output" = "git version 9" ]
}
