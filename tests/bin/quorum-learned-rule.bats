#!/usr/bin/env bats
load ../helpers

setup() { make_repo; "$BIN/quorum-render-review" --profile generic > REVIEW.md; cp REVIEW.md before.md; }
teardown() { cleanup_repo; }

@test "a new REVIEW.md has no rules" {
  run "$BIN/quorum-learned-rule" list
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "add appends to section 6 only, with its source" {
  run "$BIN/quorum-learned-rule" add "All CSV output goes through write_csv()." "csv-export, 2026-10-30"
  [ "$status" -eq 0 ]
  [ "$output" = "- All CSV output goes through write_csv(). (csv-export, 2026-10-30)" ]
  [ "$(tail -n 1 REVIEW.md)" = "- All CSV output goes through write_csv(). (csv-export, 2026-10-30)" ]
  # everything before section 6's last line is unchanged
  n=$(wc -l < before.md)
  [ "$(head -n "$n" REVIEW.md)" = "$(cat before.md)" ]
}

@test "rules keep their order, and a duplicate is refused with exit 3" {
  "$BIN/quorum-learned-rule" add "Rule one."
  "$BIN/quorum-learned-rule" add "Rule two." "t, 2026-10-30"
  run "$BIN/quorum-learned-rule" add "rule ONE."
  [ "$status" -eq 3 ]
  run "$BIN/quorum-learned-rule" list
  [ "${lines[0]}" = "Rule one." ]
  [ "${lines[1]}" = "Rule two. (t, 2026-10-30)" ]
  [ "${#lines[@]}" -eq 2 ]
}

@test "a section after section 6 stays after the rules" {
  printf '\n## 7. Notes\nkeep me\n' >> REVIEW.md
  "$BIN/quorum-learned-rule" add "New rule."
  run awk '/^- New rule\.$/ { r = NR } /^## 7\. Notes/ { n = NR } END { print (r < n) }' REVIEW.md
  [ "$output" = "1" ]
  grep -q '^keep me$' REVIEW.md
}

@test "refuses multi-line rules and a REVIEW.md without section 6" {
  run "$BIN/quorum-learned-rule" add "$(printf 'a\nb')"
  [ "$status" -eq 1 ]
  echo "# empty" > REVIEW.md
  run "$BIN/quorum-learned-rule" add "x"
  [ "$status" -eq 1 ]
}
