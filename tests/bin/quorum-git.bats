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
  for f in quorum-branch quorum-state quorum-active-task quorum-files; do
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

@test "an exported probe under the same PATH and candidates skips git --version" {
  git_shim "$BATS_TEST_TMPDIR/shim"; export GIT_LOG="$BATS_TEST_TMPDIR/git.log"
  P="$BATS_TEST_TMPDIR/shim:$PATH" C="$BATS_TEST_TMPDIR/shim/git"
  run env PATH="$P" QUORUM_GIT_CANDIDATES="$C" QUORUM_GIT_USE=git QUORUM_GIT_PROBE="$P"$'\n'"$C" "$BIN/quorum-git" rev-parse HEAD
  [ "$status" -eq 0 ]
  cat "$GIT_LOG"
  [ $(wc -l < "$GIT_LOG") -eq 1 ]
  ! grep -q -- '--version' "$GIT_LOG"
}

@test "a probe exported under another PATH or candidates is ignored" {
  # Taken under the unsandboxed PATH, where git works: under the fake-sandbox PATH it would run the broken launcher.
  stale="$PATH"$'\n'"$FAKE/real/git"
  run env PATH="$FAKE/shim:/usr/bin:/bin" QUORUM_GIT_CANDIDATES="$FAKE/real/git" QUORUM_GIT_USE=git QUORUM_GIT_PROBE="$stale" "$BIN/quorum-git" diff --stat a..b
  [ "$status" -eq 0 ]; [ "$output" = "real git: diff --stat a..b" ]
  # QUORUM_REAL_GIT and libexec/ are set: the candidate's child git runs the candidate.
  run env PATH="$FAKE/shim:/usr/bin:/bin" QUORUM_GIT_CANDIDATES="$FAKE/real/git" QUORUM_GIT_USE=git QUORUM_GIT_PROBE="$stale" "$BIN/quorum-git" child
  [ "$status" -eq 0 ]; [ "$output" = "git version 9" ]
  # The fresh answer is exported under the new key.
  run env PATH="$FAKE/shim:/usr/bin:/bin" QUORUM_GIT_CANDIDATES="$FAKE/real/git" QUORUM_GIT_USE=git QUORUM_GIT_PROBE="$stale" \
    "$BASH" -c '. "$1/libexec/git-probe.sh"; quorum_git_probe; printf "%s|%s" "$QUORUM_GIT_USE" "$QUORUM_GIT_PROBE"' _ "$REPO_ROOT"
  [ "$status" -eq 0 ]; [ "$output" = "$FAKE/real/git|$FAKE/shim:/usr/bin:/bin"$'\n'"$FAKE/real/git" ]

  # The same PATH under other candidates: probed again.
  git_shim "$BATS_TEST_TMPDIR/shim"; export GIT_LOG="$BATS_TEST_TMPDIR/git.log"
  T="$BATS_TEST_TMPDIR/t"; mkdir -p "$T/path"
  printf '#!/bin/sh\necho "$*" >> "%s"\nexec git "$@"\n' "$T/git2.log" > "$T/path/git2"; chmod +x "$T/path/git2"
  : > "$T/notexec"
  P="$BATS_TEST_TMPDIR/shim:$T/path:$PATH"
  : > "$GIT_LOG"
  run env PATH="$P" QUORUM_GIT_CANDIDATES=/b/git QUORUM_GIT_USE=git QUORUM_GIT_PROBE="$P"$'\n'/a/git "$BIN/quorum-git" rev-parse --is-inside-work-tree
  [ "$status" -eq 0 ]; [ "$output" = true ]
  grep -q -- '--version' "$GIT_LOG"

  # The exact key, but a value that isn't `git` or an executable absolute path: probed again, and never run.
  C="$BATS_TEST_TMPDIR/shim/git"
  for use in /nonexistent/git "$T/notexec" git2; do
    : > "$GIT_LOG"
    run env PATH="$P" QUORUM_GIT_CANDIDATES="$C" QUORUM_GIT_USE="$use" QUORUM_GIT_PROBE="$P"$'\n'"$C" "$BIN/quorum-git" rev-parse --is-inside-work-tree
    [ "$status" -eq 0 ] || { echo "$use: $output"; return 1; }
    [ "$output" = true ]
    grep -q -- '--version' "$GIT_LOG" || { echo "$use: no fresh probe"; return 1; }
  done
  [ ! -s "$T/git2.log" ]
}

@test "quorum-state probes git once and exports it to its children" {
  # The requirement-6 fixture: an active BUILDING task with no base_sha, and a run-session marker.
  mkdir -p .tasks/demo .tasks/.run-sessions; "$BIN/quorum-active-task" --set demo
  "$BIN/quorum-state" --task demo init HIGH; : > .tasks/.run-sessions/s1
  # A copy of quorum-state whose child quorum-active-task records the probe it inherits, then runs the real one.
  T="$BATS_TEST_TMPDIR/copy"; mkdir -p "$T/bin" "$T/libexec"
  cp "$BIN/quorum-state" "$BIN/quorum-git" "$T/bin/"; cp "$REPO_ROOT"/libexec/* "$T/libexec/"
  printf '#!/bin/sh\necho "${QUORUM_GIT_USE:-unset}" >> "$CHILD_LOG"\nexec "%s" "$@"\n' "$BIN/quorum-active-task" > "$T/bin/quorum-active-task"
  chmod +x "$T/bin/quorum-active-task"
  git_shim "$BATS_TEST_TMPDIR/shim"
  export GIT_LOG="$BATS_TEST_TMPDIR/git.log" CHILD_LOG="$BATS_TEST_TMPDIR/child.log"
  run env -u QUORUM_GIT_USE -u QUORUM_GIT_PROBE PATH="$BATS_TEST_TMPDIR/shim:$PATH" QUORUM_GIT_CANDIDATES="$BATS_TEST_TMPDIR/shim/git" \
    "$T/bin/quorum-state" --task demo get status
  [ "$status" -eq 0 ]; [ "$output" = BUILDING ]
  echo "versions: $(grep -c -- '--version' "$GIT_LOG")"; echo "child saw: $(cat "$CHILD_LOG")"
  [ "$(grep -c -- '--version' "$GIT_LOG")" -le 1 ]
  [ -s "$CHILD_LOG" ]; ! grep -qv '^git$' "$CHILD_LOG"
}
