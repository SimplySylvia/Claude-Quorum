# Shared setup: a throwaway git repo per test, with Quorum's bin/ and hooks/ on hand.
REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
BIN="$REPO_ROOT/bin"
HOOKS="$REPO_ROOT/hooks"

make_repo() {
  WORK="$(mktemp -d)"
  cd "$WORK"
  git init -q -b main
  git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
  unset CLAUDE_PROJECT_DIR
}

cleanup_repo() { rm -rf "$WORK"; }

# git_shim DIR: write DIR/git, a counting git that appends its arguments to $GIT_LOG as one line, then runs the git
# that was on PATH when the shim was made. Put DIR first on PATH (and in QUORUM_GIT_CANDIDATES) to count git calls.
git_shim() {
  local real; real=$(command -v git)
  mkdir -p "$1"
  printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "${GIT_LOG:-/dev/null}"\nexec "%s" "$@"\n' "$real" > "$1/git"
  chmod +x "$1/git"
}
