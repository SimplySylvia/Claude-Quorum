#!/usr/bin/env bats
load ../helpers

FIX="$BATS_TEST_DIRNAME/../fixtures"
detect() { "$BIN/quorum-detect-stack" "$FIX/$1"; }
cmd() { detect "$1" | jq -r ".commands.$2 // \"null\""; }

@test "node + pnpm + TypeScript: scripts become commands" {
  run detect node-ts
  echo "$output" | jq -e '.profile == "node" and .package_manager == "pnpm" and .monorepo == null'
  [ "$(cmd node-ts typecheck)" = "pnpm run type-check" ]
  [ "$(cmd node-ts lint)" = "pnpm run lint" ]
  [ "$(cmd node-ts test)" = "pnpm run test" ]
  [ "$(cmd node-ts dev)" = "pnpm run dev" ]
  echo "$output" | jq -e '.skip_paths | index("pnpm-lock.yaml") and index("*.snap")'
}

@test "npm's placeholder test script is ignored; tsconfig gives a tsc fallback" {
  [ "$(cmd node-npm-default test)" = "null" ]
  [ "$(cmd node-npm-default typecheck)" = "npx tsc --noEmit" ]
  [ "$(cmd node-npm-default dev)" = "npm run start" ]
}

@test "nx monorepo with yarn" {
  run detect monorepo-nx
  echo "$output" | jq -e '.monorepo == "nx" and .package_manager == "yarn"'
  [ "$(cmd monorepo-nx test)" = "yarn run test" ]
}

@test "python + uv: pytest, ruff, mypy" {
  run detect python-uv
  echo "$output" | jq -e '.profile == "python" and .package_manager == "uv"'
  [ "$(cmd python-uv test)" = "uv run pytest" ]
  [ "$(cmd python-uv lint)" = "uv run ruff check ." ]
  [ "$(cmd python-uv typecheck)" = "uv run mypy ." ]
}

@test "go with golangci-lint" {
  [ "$(cmd go test)" = "go test ./..." ]
  [ "$(cmd go typecheck)" = "go vet ./..." ]
  [ "$(cmd go lint)" = "golangci-lint run" ]
}

@test "rust" {
  [ "$(cmd rust lint)" = "cargo clippy -- -D warnings" ]
  [ "$(cmd rust test)" = "cargo test" ]
}

@test "gradle wrapper and maven" {
  [ "$(cmd jvm-gradle test)" = "./gradlew test" ]
  [ "$(cmd jvm-maven test)" = "mvn -q test" ]
}

@test "Makefile targets fill the gaps; profile is generic" {
  run detect makefile
  echo "$output" | jq -e '.profile == "generic"'
  [ "$(cmd makefile test)" = "make test" ]
  [ "$(cmd makefile typecheck)" = "null" ]
}

@test "empty repo: generic profile, every command null" {
  run detect empty
  echo "$output" | jq -e '.profile == "generic" and .stacks == [] and ([.commands[]] | all(. == null))'
}

@test "every command records where it came from" {
  run detect node-ts
  echo "$output" | jq -e '.sources.typecheck == "package.json scripts.type-check"'
}

@test "setup installs from the lockfile, for a fresh worktree" {
  [ "$(cmd node-ts setup)" = "pnpm install --frozen-lockfile" ]
  [ "$(cmd node-npm-default setup)" = "npm ci" ]
  [ "$(cmd python-uv setup)" = "uv sync" ]
  [ "$(cmd rust setup)" = "null" ]
}
