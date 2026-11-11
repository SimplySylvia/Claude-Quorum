#!/usr/bin/env bats
load ../helpers

setup() { make_repo; }
teardown() { cleanup_repo; }

@test "set records a model choice in .claude/quorum.json, and get reads it back" {
  run "$BIN/quorum-config" get reviewer_model; [ "$status" -eq 0 ]; [ -z "$output" ]
  "$BIN/quorum-config" set reviewer_model inherit
  "$BIN/quorum-config" set helper_model claude-haiku-5-5
  [ "$("$BIN/quorum-config" get reviewer_model)" = inherit ]
  [ "$("$BIN/quorum-config" get helper_model)" = claude-haiku-5-5 ]
  jq -e '.reviewer_model == "inherit"' .claude/quorum.json
}

@test "the user's other keys stay as they are, and get reads them" {
  mkdir -p .claude && echo '{"protected_paths": "Makefile", "blind_block_dirs": "src"}' > .claude/quorum.json
  "$BIN/quorum-config" set reviewer_model opus
  "$BIN/quorum-config" unset reviewer_model
  [ "$(jq -c . .claude/quorum.json)" = '{"protected_paths":"Makefile","blind_block_dirs":"src"}' ]
  [ "$("$BIN/quorum-config" get protected_paths)" = Makefile ]
}

@test "only the model keys can be set, with a value the Agent tool could take" {
  run "$BIN/quorum-config" set protected_paths "*.ini";     [ "$status" -eq 1 ]
  run "$BIN/quorum-config" set reviewer_model "two words";  [ "$status" -eq 1 ]
  run "$BIN/quorum-config" set reviewer_model '${user_config.reviewer_model}'; [ "$status" -eq 1 ]
  [ ! -e .claude/quorum.json ]
}

@test "in a task's worktree it uses the main working tree's file" {
  printf '# P\n' > CLAUDE.md && printf '# R\n' > REVIEW.md && mkdir -p .claude/hooks && echo 'exit 0' > .claude/hooks/verify-completion.sh
  echo ".tasks/" > .gitignore
  git add -A && git -c user.name=t -c user.email=t@example.com commit -qm bootstrap
  "$BIN/quorum-state" --task demo init LOW BUILDING
  wt=$("$BIN/quorum-branch" start demo --worktree | sed -n 2p)
  (cd "$wt" && "$BIN/quorum-config" set helper_model haiku)
  [ "$("$BIN/quorum-config" get helper_model)" = haiku ]
  [ ! -e "$wt/.claude/quorum.json" ]
}

@test "a broken file is reported, not overwritten" {
  mkdir -p .claude && echo '{not json' > .claude/quorum.json
  run "$BIN/quorum-config" set reviewer_model inherit; [ "$status" -eq 1 ]
  [ "$(cat .claude/quorum.json)" = '{not json' ]
}
