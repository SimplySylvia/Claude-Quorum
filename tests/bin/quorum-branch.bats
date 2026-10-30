#!/usr/bin/env bats
load ../helpers

setup() {
  make_repo
  echo one > a.txt && git add a.txt && git -c user.name=t -c user.email=t@example.com commit -qm one
  mkdir -p .tasks/demo && echo ".tasks/" > .gitignore && git add .gitignore && git -c user.name=t -c user.email=t@example.com commit -qm ignore
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  "$BIN/quorum-active-task" --set demo
}
teardown() { cleanup_repo; }
commit() { echo "$1" >> a.txt; git -c user.name=t -c user.email=t@example.com commit -qam "$1"; }

@test "default: main" {
  run "$BIN/quorum-branch" default
  [ "$output" = "main" ]
}

@test "start: creates feat/<slug> from main and records base_sha" {
  main_sha=$(git rev-parse main)
  run "$BIN/quorum-branch" start demo
  [ "$status" -eq 0 ]
  [ "$output" = "feat/demo" ]
  [ "$(git branch --show-current)" = "feat/demo" ]
  [ "$("$BIN/quorum-state" get base_sha)" = "$main_sha" ]
}

@test "start --fix uses fix/<slug>" {
  run "$BIN/quorum-branch" start demo --fix
  [ "$output" = "fix/demo" ]
}

@test "start: refuses with uncommitted changes, allows untracked files" {
  echo dirty >> a.txt
  run "$BIN/quorum-branch" start demo
  [ "$status" -eq 1 ]
  [[ "$output" == *"uncommitted changes"* ]]
  git checkout -q a.txt
  touch untracked.txt
  run "$BIN/quorum-branch" start demo
  [ "$status" -eq 0 ]
}

@test "start: already on the branch keeps it and the base" {
  "$BIN/quorum-branch" start demo
  base=$("$BIN/quorum-state" get base_sha)
  commit two
  run "$BIN/quorum-branch" start demo
  [ "$output" = "feat/demo" ]
  [ "$("$BIN/quorum-state" get base_sha)" = "$base" ]
}

@test "start: needs a state file" {
  run "$BIN/quorum-branch" start nope
  [ "$status" -eq 1 ]
}

@test "range: base..HEAD before any builder round, then the last recorded SHA" {
  "$BIN/quorum-branch" start demo
  base=$("$BIN/quorum-state" get base_sha)
  commit two
  run "$BIN/quorum-branch" range
  [ "$output" = "$base..HEAD" ]
  rec=$("$BIN/quorum-branch" record)
  commit three
  run "$BIN/quorum-branch" range
  [ "$output" = "$rec..HEAD" ]
  [ "$(git diff --name-only "$rec..HEAD")" = "a.txt" ]
}

@test "range: fails before base_sha is set" {
  run "$BIN/quorum-branch" range
  [ "$status" -eq 1 ]
  [[ "$output" == *"/quorum:build"* ]]
}
