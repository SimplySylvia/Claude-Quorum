#!/usr/bin/env bats
load ../helpers

FIX="$BATS_TEST_DIRNAME/../fixtures"

@test "keeps the blueprint's six sections in order" {
  run "$BIN/quorum-render-review"
  [ "$status" -eq 0 ]
  echo "$output" | grep '^## ' > "$BATS_TEST_TMPDIR/h"
  run cat "$BATS_TEST_TMPDIR/h"
  [ "${lines[0]}" = "## 1. Core Review Philosophy" ]
  [ "${lines[1]}" = "## 2. Severity Tags (Mandatory)" ]
  [ "${lines[2]}" = "## 3. What Failure Looks Like in This Repository" ]
  [ "${lines[3]}" = "## 4. Paths to Skip" ]
  [ "${lines[4]}" = "## 5. Convergence & Loop Rules" ]
  [ "${lines[5]}" = "## 6. Learned Rules (Self-Updating Project Memory)" ]
}

@test "no placeholders left" {
  run bash -c "'$BIN/quorum-detect-stack' '$FIX/node-ts' | '$BIN/quorum-render-review' --from-detect"
  [[ "$output" != *"{{"* ]]
}

@test "node profile fills section 3; lockfiles and build output fill section 4" {
  run bash -c "'$BIN/quorum-detect-stack' '$FIX/node-ts' | '$BIN/quorum-render-review' --from-detect"
  [[ "$output" == *"Unhandled promise rejections"* ]]
  [[ "$output" == *'- Lockfiles (`package-lock.json`, `pnpm-lock.yaml`'* ]]
  [[ "$output" == *'`node_modules/`'* ]]
  [[ "$output" != *'`*.snap`'* ]]
  [[ "$output" == *"this repo's stack (Node / TypeScript)"* ]]
}

@test "several profiles each get a labeled block" {
  run "$BIN/quorum-render-review" --profile go --profile rust
  [[ "$output" == *"**Go:**"* ]]
  [[ "$output" == *"**Rust:**"* ]]
}

@test "empty repo: generic profile and a placeholder skip line" {
  run bash -c "'$BIN/quorum-detect-stack' '$FIX/empty' | '$BIN/quorum-render-review' --from-detect"
  [[ "$output" == *"Misrouted environment variables"* ]]
  [[ "$output" == *"none detected yet"* ]]
}

@test "unknown profile is refused" {
  run "$BIN/quorum-render-review" --profile cobol
  [ "$status" -eq 1 ]
}

@test "every stack profile exists for every stack detection can report" {
  for p in node python go rust jvm generic; do [ -f "$REPO_ROOT/skills/init-pipeline/templates/stacks/$p.md" ]; done
}
