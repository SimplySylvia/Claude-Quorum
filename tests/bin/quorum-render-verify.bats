#!/usr/bin/env bats
load ../helpers

setup() { make_repo; mkdir -p .claude/hooks; }
teardown() { cleanup_repo; }

render() { "$BIN/quorum-render-verify" "$@" > .claude/hooks/verify-completion.sh; chmod +x .claude/hooks/verify-completion.sh; }

@test "needs at least one check" {
  run "$BIN/quorum-render-verify"
  [ "$status" -eq 1 ]
}

@test "all checks pass: exit 0" {
  render --typecheck 'true' --lint 'echo lint-ok' --test 'true'
  run .claude/hooks/verify-completion.sh
  [ "$status" -eq 0 ]
  [[ "$output" == *"lint-ok"* ]]
  [[ "$output" == *"All checks passed."* ]]
}

@test "runs every check and names each failure" {
  render --typecheck 'false' --lint 'true' --test 'exit 3'
  run .claude/hooks/verify-completion.sh
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAILED: typecheck test"* ]]
  [[ "$output" == *"== lint"* ]]
}

@test "runs from the repo root wherever it is called from" {
  echo marker > root-marker
  render --test 'test -f root-marker'
  mkdir -p deep/dir && cd deep/dir
  run "$WORK/.claude/hooks/verify-completion.sh"
  [ "$status" -eq 0 ]
}

@test "commands with quotes and pipes survive" {
  render --check "quotes=echo \"it's\" 'fine' | grep -q fine"
  run .claude/hooks/verify-completion.sh
  [ "$status" -eq 0 ]
}

@test "rejects bad check names and newlines" {
  run "$BIN/quorum-render-verify" --check 'Bad Name=true'
  [ "$status" -eq 1 ]
  run "$BIN/quorum-render-verify" --test "$(printf 'a\nb')"
  [ "$status" -eq 1 ]
}

@test "the generated script passes shellcheck" {
  command -v shellcheck >/dev/null || skip "shellcheck not installed"
  render --typecheck 'pnpm run type-check' --lint 'pnpm run lint' --test 'pnpm run test'
  run shellcheck .claude/hooks/verify-completion.sh
  [ "$status" -eq 0 ]
}
