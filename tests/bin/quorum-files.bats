#!/usr/bin/env bats
load ../helpers
bats_require_minimum_version 1.5.0

# A task `demo` on feat/demo, branched from main at the init commit. .tasks/ isn't ignored here, so the record
# itself has to leave it out.
setup() {
  make_repo
  git config user.name t; git config user.email t@example.com
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  git checkout -q -b feat/demo
  T=$'\t'
  LIST="$WORK/.tasks/demo/files.tsv"
}
teardown() { chmod -R u+w "$WORK" 2>/dev/null || true; cleanup_repo; }

qs() { "$BIN/quorum-state" --task demo "$@"; }
record() { "$BIN/quorum-files" "$@" record; }
commit() { git add -- "$@" && git commit -q -m "change $*"; }
# The build starts here: main moves up to HEAD, as the task branch starts from the default branch's tip.
start_build() {
  git checkout -q main && git merge -q --ff-only feat/demo && git checkout -q feat/demo
  qs set base_sha "$(git rev-parse HEAD)"
}
# The row for a path, and the row we expect from its 7 fields.
row() { awk -F '\t' -v p="$1" 'NR > 1 && $4 == p' "$LIST"; }
want() { local IFS="$T"; printf '%s' "$*"; }
paths() { tail -n +2 "$LIST" | cut -f 4 | tr '\n' ' '; }
# Nothing but files.tsv and state.md in the task folder, and no scratch file in .tasks/.
no_temp() {
  [ -z "$(ls -A "$WORK/.tasks/demo" | grep -v -x -e files.tsv -e state.md -e plan.md)" ]
  [ -z "$(ls -A "$WORK/.tasks" | grep -v -x -e demo -e .active)" ]
}

@test "record writes files.tsv with its header and sorted tab-separated rows, atomically" {
  record
  head -n 1 "$LIST" | grep -Eq '^# quorum-files 1 head=[0-9a-f]{40} base=- since=- recorded=[0-9]+$'
  [ "$(wc -l < "$LIST" | tr -d ' ')" = 1 ]

  start_build; base=$(git rev-parse HEAD)
  mkdir a; printf 'x\n' > b.txt; printf 'x\n' > a/b.txt; commit b.txt a/b.txt
  printf 'x\n' > C.txt; printf 'x\ny\n' > a.txt
  before=$(ls -i "$LIST" | awk '{ print $1 }')
  record
  head -n 1 "$LIST" | grep -Eq "^# quorum-files 1 head=$(git rev-parse HEAD) base=$base since=- recorded=[0-9]+\$"
  [ -z "$(awk -F '\t' 'NR > 1 && NF != 7' "$LIST")" ]
  [ "$(paths)" = "C.txt a.txt a/b.txt b.txt " ]
  [ "$(tail -n +2 "$LIST" | cut -f 4 | LC_ALL=C sort)" = "$(tail -n +2 "$LIST" | cut -f 4)" ]
  # Moved into place, not rewritten: a new file each time.
  [ "$(ls -i "$LIST" | awk '{ print $1 }')" != "$before" ]
  no_temp
}

@test "record lists modified, added, deleted, renamed, untracked, and binary files with their line counts" {
  printf '1\n2\n3\n' > mod1.txt; printf '1\n2\n' > mod2.txt; printf 'a\nb\nc\n' > del.txt
  for i in 1 2 3 4 5 6 7 8 9 10; do echo "line $i"; done > old.txt
  printf '*.log\n' > .gitignore; printf '\0a' > tracked.bin
  commit mod1.txt mod2.txt del.txt old.txt .gitignore tracked.bin
  start_build

  printf '4\n' >> mod1.txt; printf 'n\n' > new.txt; git rm -q del.txt
  git mv old.txt renamed.txt; sed 's/^line 10$/line ten/' renamed.txt > r.tmp && mv r.tmp renamed.txt
  printf '\0b' > tracked.bin
  commit mod1.txt new.txt renamed.txt tracked.bin
  printf '3\n' >> mod2.txt
  printf '1\n2\n3\n4\n' > four.txt; printf '\0\1\2' > blob.bin; echo ignored > x.log
  echo note > .tasks/demo/note.md
  # An untracked nested repo and a FIFO are neither regular files nor symlinks.
  mkdir sub; echo s > sub/s.txt; git -C sub init -q; git -C sub add s.txt; git -C sub commit -q -m s
  mkfifo pipe

  run --separate-stderr record
  [ "$status" -eq 0 ]; [ -z "$stderr" ]
  [ "$(row mod1.txt)" = "$(want M 1 0 mod1.txt - - -)" ]
  [ "$(row mod2.txt)" = "$(want M 1 0 mod2.txt - - -)" ]
  [ "$(row new.txt)" = "$(want A 1 0 new.txt - - -)" ]
  [ "$(row del.txt)" = "$(want D 0 3 del.txt - - -)" ]
  [ "$(row renamed.txt)" = "$(want R 1 1 renamed.txt old.txt - -)" ]
  [ "$(row four.txt)" = "$(want A 4 0 four.txt - - -)" ]
  [ "$(row tracked.bin)" = "$(want M bin bin tracked.bin - - -)" ]
  [ "$(row blob.bin)" = "$(want A bin bin blob.bin - - -)" ]
  [ "$(paths)" = "blob.bin del.txt four.txt mod1.txt mod2.txt new.txt renamed.txt tracked.bin " ]
}

@test "record counts an untracked link, to a directory too, as 1 line and an unreadable untracked file as bin" {
  start_build
  printf 'x\n' > ok.txt
  mkdir dir; echo d > dir/d.txt; git add dir/d.txt; git commit -q -m dir
  ln -s dir dirlink; ln -s nowhere dangling
  printf 'secret\n' > unreadable.txt; chmod 000 unreadable.txt

  run --separate-stderr record
  [ "$status" -eq 0 ]; [ -z "$stderr" ]
  [ "$(row ok.txt)" = "$(want A 1 0 ok.txt - - -)" ]
  [ "$(row dangling)" = "$(want A 1 0 dangling - - -)" ]
  [ "$(row dirlink)" = "$(want A 1 0 dirlink - - -)" ]
  [ "$(row unreadable.txt)" = "$(want A bin bin unreadable.txt - - -)" ]
  [ "$(paths)" = "dangling dir/d.txt dirlink ok.txt unreadable.txt " ]
}

@test "record diffs against the merge-base, so a rebase adds no upstream files" {
  start_build; base=$(git rev-parse HEAD)
  echo t > task.txt; commit task.txt
  git checkout -q main
  echo u > upstream.txt; commit upstream.txt
  git checkout -q feat/demo
  git rebase -q main
  mb=$(git merge-base HEAD main)
  [ "$mb" != "$base" ]

  record
  head -n 1 "$LIST" | grep -Eq "^# quorum-files 1 head=$(git rev-parse HEAD) base=$mb since=- "
  [ "$(paths)" = "task.txt " ]
  [ -z "$(row upstream.txt)" ]
}

@test "record runs git in the task worktree and writes the list to the task folder" {
  echo s > shared.txt; commit shared.txt
  qs set base_sha "$(git rev-parse HEAD)"
  git checkout -q main
  git merge -q --ff-only feat/demo
  wt="$BATS_TEST_TMPDIR/wt"
  git worktree add -q "$wt" feat/demo
  qs set worktree "$wt"
  echo c > "$wt/wt-committed.txt"; git -C "$wt" add wt-committed.txt; git -C "$wt" commit -q -m c
  echo more >> "$wt/wt-committed.txt"
  echo n > "$wt/wt-new.txt"
  # The main tree has changes of its own, which aren't the task's.
  echo main > main-only.txt; echo edited >> shared.txt

  run --separate-stderr record --task demo
  [ "$status" -eq 0 ]; [ -z "$stderr" ]
  [ -f "$WORK/.tasks/demo/files.tsv" ]
  [ ! -e "$wt/.tasks" ]
  head -n 1 "$LIST" | grep -Eq "^# quorum-files 1 head=$(git -C "$wt" rev-parse HEAD) "
  [ "$(row wt-committed.txt)" = "$(want A 2 0 wt-committed.txt - - -)" ]
  [ "$(row wt-new.txt)" = "$(want A 1 0 wt-new.txt - - -)" ]
  [ "$(paths)" = "wt-committed.txt wt-new.txt " ]
}

@test "record joins each file to the plan steps whose line names it, and lists planned files not yet changed" {
  echo e > exist.ts; commit exist.ts
  cat > .tasks/demo/plan.md <<'MD'
# Plan: demo

## Steps
1. **Add a** — `a.ts` · requirements: 1
   - Reuses: `reuse-only.ts:4`, `a.ts`
2. **The `file_icons` option** — `c.ts`, run `quorum-files record` · requirements: 2
3. **More** — `a.ts:12`, `b.ts`, `exist.ts`, `-rf`, `lib/`, `.tasks/demo/plan.md` · requirements: 3
4. **Docs** — `d.md` · requirements: 1 · see `after.ts`

## Tests
1. `not-a-step.ts`
MD

  # Before the build starts: only the planned rows.
  record
  head -n 1 "$LIST" | grep -Eq ' base=- since=- '
  [ "$(paths)" = "a.ts b.ts c.ts d.md exist.ts " ]
  [ "$(row a.ts)" = "$(want A - - a.ts - 1,3 -)" ]
  [ "$(row exist.ts)" = "$(want M - - exist.ts - 3 -)" ]

  start_build
  printf '1\n2\n' > a.ts; commit a.ts
  record
  [ "$(row a.ts)" = "$(want A 2 0 a.ts - 1,3 -)" ]
  [ "$(row b.ts)" = "$(want A - - b.ts - 3 -)" ]
  [ "$(row c.ts)" = "$(want A - - c.ts - 2 -)" ]
  [ "$(row exist.ts)" = "$(want M - - exist.ts - 3 -)" ]
  [ "$(paths)" = "a.ts b.ts c.ts d.md exist.ts " ]

  rm .tasks/demo/plan.md
  record
  [ "$(row a.ts)" = "$(want A 2 0 a.ts - - -)" ]
  [ "$(paths)" = "a.ts " ]
}

@test "record marks files changed since the last round sha" {
  printf 'x\n' > x.txt; printf 'y\n' > y.txt; commit x.txt y.txt
  start_build
  printf 'x2\n' >> x.txt; printf 'y2\n' >> y.txt; commit x.txt y.txt
  record
  head -n 1 "$LIST" | grep -Eq ' since=- '
  [ -z "$(awk -F '\t' 'NR > 1 && $7 != "-"' "$LIST")" ]

  round=$(git rev-parse HEAD); qs push round_shas "$round"
  printf 'x3\n' >> x.txt; commit x.txt
  printf 'u\n' > u.txt
  record
  head -n 1 "$LIST" | grep -Eq " since=$round "
  [ "$(row x.txt | cut -f 7)" = 1 ]
  [ "$(row y.txt | cut -f 7)" = 0 ]
  [ "$(row u.txt | cut -f 7)" = 1 ]
}

@test "record exits 0 and keeps the earlier list when git fails, and a usage error exits non-zero" {
  start_build
  echo f > f.txt; echo g > g.txt; commit f.txt g.txt
  record
  cp "$LIST" "$BATS_TEST_TMPDIR/earlier"
  echo more >> f.txt; echo more >> g.txt
  kept() { cmp "$LIST" "$BATS_TEST_TMPDIR/earlier" && no_temp; }

  # Every git call fails.
  broken="$BATS_TEST_TMPDIR/broken"; mkdir -p "$broken"
  printf '#!/bin/sh\nexit 1\n' > "$broken/git"; chmod +x "$broken/git"
  run --separate-stderr env PATH="$broken:$PATH" QUORUM_GIT_CANDIDATES="$broken/git" "$BIN/quorum-files" --task demo record
  [ "$status" -eq 0 ]; [ "${#stderr_lines[@]}" -eq 1 ]; [[ "$stderr" == "quorum-files: "* ]]
  kept

  # Only the diffs fail, after the earlier git calls worked.
  real=$(command -v git); numstat="$BATS_TEST_TMPDIR/numstat"; mkdir -p "$numstat"
  printf '#!/bin/sh\ncase " $* " in *" --numstat "*) exit 1 ;; esac\nexec "%s" "$@"\n' "$real" > "$numstat/git"
  chmod +x "$numstat/git"
  run --separate-stderr env PATH="$numstat:$PATH" QUORUM_GIT_CANDIDATES="$numstat/git" "$BIN/quorum-files" --task demo record
  [ "$status" -eq 0 ]; [ "${#stderr_lines[@]}" -eq 1 ]
  kept

  # Only the untracked file's own count fails: git prints no record, so the list is kept, not filled with bin.
  echo u > untracked.txt
  noindex="$BATS_TEST_TMPDIR/noindex"; mkdir -p "$noindex"
  printf '#!/bin/sh\ncase " $* " in *" --no-index "*) exit 1 ;; esac\nexec "%s" "$@"\n' "$real" > "$noindex/git"
  chmod +x "$noindex/git"
  run --separate-stderr env PATH="$noindex:$PATH" QUORUM_GIT_CANDIDATES="$noindex/git" "$BIN/quorum-files" --task demo record
  [ "$status" -eq 0 ]; [ "${#stderr_lines[@]}" -eq 1 ]
  kept
  rm untracked.txt

  # No active task and no --task: a detached HEAD, and no .tasks/.active.
  git checkout -q --detach
  run --separate-stderr "$BIN/quorum-files" record
  [ "$status" -eq 0 ]; [ "${#stderr_lines[@]}" -eq 1 ]
  kept
  git checkout -q feat/demo

  # The worktree is gone.
  qs set worktree "$BATS_TEST_TMPDIR/gone"
  run --separate-stderr record
  [ "$status" -eq 0 ]; [ "${#stderr_lines[@]}" -eq 1 ]
  kept
  qs clear worktree

  # The task folder can't be written.
  chmod a-w "$WORK/.tasks/demo"
  run --separate-stderr record
  chmod u+w "$WORK/.tasks/demo"
  [ "$status" -eq 0 ]; [ "${#stderr_lines[@]}" -eq 1 ]
  kept

  run "$BIN/quorum-files" frobnicate; [ "$status" -ne 0 ]
  run "$BIN/quorum-files" record --task '../x'; [ "$status" -ne 0 ]
  run "$BIN/quorum-files" record extra; [ "$status" -ne 0 ]
  kept
}

@test "record edge cases: no changes, a space and unicode in a path, a tab in a path, and no default branch" {
  # No changes yet: the header alone.
  start_build
  run --separate-stderr record
  [ "$status" -eq 0 ]; [ -z "$stderr" ]
  [ "$(wc -l < "$LIST" | tr -d ' ')" = 1 ]

  # A space and unicode, committed and untracked; a tab, committed, and a newline, untracked.
  mkdir docs; echo n > "docs/café notes.md"; commit "docs/café notes.md"
  echo n > "naïve file.txt"
  tab=$(printf 'tab\there.txt'); nl=$(printf 'new\nline.txt')
  echo t > "$tab"; commit "$tab"; echo l > "$nl"
  run --separate-stderr record
  [ "$status" -eq 0 ]; [ "${#stderr_lines[@]}" -eq 1 ]
  [ "$(row "docs/café notes.md")" = "$(want A 1 0 "docs/café notes.md" - - -)" ]
  [ "$(row "naïve file.txt")" = "$(want A 1 0 "naïve file.txt" - - -)" ]
  [ "$(paths)" = "docs/café notes.md naïve file.txt " ]
  [ -z "$(awk -F '\t' 'NR > 1 && NF != 7' "$LIST")" ]

  # No default branch: no origin, no main or master, so quorum-branch default is the current branch.
  other="$BATS_TEST_TMPDIR/trunk"; mkdir -p "$other"; cd "$other"
  git init -q -b trunk; git config user.name t; git config user.email t@example.com
  git commit -q --allow-empty -m init
  "$BIN/quorum-state" --task solo init MEDIUM BUILDING
  first=$(git rev-parse HEAD); "$BIN/quorum-state" --task solo set base_sha "$first"
  echo f > feature.txt; commit feature.txt
  run --separate-stderr "$BIN/quorum-files" --task solo record
  [ "$status" -eq 0 ]; [ -z "$stderr" ]
  head -n 1 .tasks/solo/files.tsv | grep -Eq " base=$first "
  [ "$(awk -F '\t' 'NR > 1 { print $1, $4 }' .tasks/solo/files.tsv)" = "A feature.txt" ]
}
