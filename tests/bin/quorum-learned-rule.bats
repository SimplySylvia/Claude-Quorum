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

@test "remove takes a rule out of section 6, with or without its source" {
  "$BIN/quorum-learned-rule" add "Rule one." "t, 2026-01-01"
  "$BIN/quorum-learned-rule" add "Rule two."
  run "$BIN/quorum-learned-rule" remove "rule one."
  [ "$status" -eq 0 ]; [ "$output" = "removed: Rule one. (t, 2026-01-01)" ]
  [ "$("$BIN/quorum-learned-rule" list)" = "Rule two." ]
  run "$BIN/quorum-learned-rule" remove "Rule three."; [ "$status" -eq 1 ]
}

@test "audit dates each rule's last citation, and calls an old uncited rule stale" {
  old=$(date -v-200d +%Y-%m-%d 2>/dev/null || date -d '200 days ago' +%Y-%m-%d)
  recent=$(date -v-10d +%Y-%m-%d 2>/dev/null || date -d '10 days ago' +%Y-%m-%d)
  "$BIN/quorum-learned-rule" add "All CSV output goes through write_csv() in app/report.py." "a, $old"
  "$BIN/quorum-learned-rule" add "Missing-file errors print one line on stderr and exit 1." "b, $old"
  "$BIN/quorum-learned-rule" add "Dates are ISO 8601 in every output." "c, $recent"
  mkdir -p .tasks/t/review/round-1
  echo 'DROP [IMPORTANT] app/report.py:9 — (d) learned rule: "All CSV output goes through write_csv()"' > .tasks/t/review/round-1/votes.md
  touch -t "$(date -v-20d +%Y%m%d0000 2>/dev/null || date -d '20 days ago' +%Y%m%d0000)" .tasks/t/review/round-1/votes.md
  run "$BIN/quorum-learned-rule" audit
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 3 ]
  [[ "${lines[0]}" == "All CSV output goes through write_csv() in app/report.py. (a, $old)	$old	"*"	kept" ]]
  [[ "${lines[0]}" != *"	never	"* ]]
  [ "${lines[1]}" = "Missing-file errors print one line on stderr and exit 1. (b, $old)	$old	never	stale" ]
  [ "${lines[2]}" = "Dates are ISO 8601 in every output. (c, $recent)	$recent	never	kept" ]
  run "$BIN/quorum-learned-rule" audit --days 300
  [[ "${lines[1]}" == *"	kept" ]]
}

@test "pattern rules go in .claude/quorum.json, once each" {
  run "$BIN/quorum-learned-rule" pattern add "app/*.py" "','\.join\(" "Use write_csv(); never join fields by hand." "csv, 2026-11-11"
  [ "$status" -eq 0 ]
  jq -e '.pattern_rules[0].glob == "app/*.py" and .pattern_rules[0].source == "csv, 2026-11-11"' .claude/quorum.json
  [ "$("$BIN/quorum-learned-rule" pattern list)" = "$(printf 'app/*.py\t%s\t%s' "','\.join\(" "Use write_csv(); never join fields by hand.")" ]
  run "$BIN/quorum-learned-rule" pattern add "app/*.py" "','\.join\(" "again"; [ "$status" -eq 3 ]
  run "$BIN/quorum-learned-rule" pattern add "*.py" "(" "bad regex"; [ "$status" -eq 1 ]
}
