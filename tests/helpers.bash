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
