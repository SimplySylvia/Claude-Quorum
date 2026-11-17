#!/usr/bin/env bats
load ../helpers

# Each case runs the runner with PATH holding only $FAKE: a grep link and #!/bin/sh fakes of bats, getconf and, when
# the case needs it, parallel. The fake bats logs its arguments, one per line, to $BATS_LOG.
setup() {
  FAKE="$BATS_TEST_TMPDIR/fake"
  mkdir -p "$FAKE"
  ln -s "$(command -v grep)" "$FAKE/grep"
  BATS_LOG="$BATS_TEST_TMPDIR/bats.log"
  printf '#!/bin/sh\nfor a in "$@"; do printf "%%s\\n" "$a"; done > "%s"\n' "$BATS_LOG" > "$FAKE/bats"
  chmod +x "$FAKE/bats"
}

# fake NAME BODY: write $FAKE/NAME, a #!/bin/sh script running BODY.
fake() { printf '#!/bin/sh\n%s\n' "$2" > "$FAKE/$1"; chmod +x "$FAKE/$1"; }

# runner: run the runner under PATH=$FAKE with the arguments `-r tests/` and `a b`, then print what bats got.
runner() {
  rm -f "$BATS_LOG"
  PATH="$FAKE" "$BASH" "$REPO_ROOT/assets/src/run-bats.sh" -r tests/ 'a b' || return 1
  cat "$BATS_LOG"
}

SERIAL=$'-r\ntests/\na b'

@test "run-bats uses --jobs only when GNU parallel is on PATH and the CPU count is a positive integer" {
  # GNU parallel and 6 CPUs: bats --jobs 6, then the same arguments.
  fake parallel 'echo "GNU parallel 20240122"'
  fake getconf 'echo 6'
  run runner
  [ "$status" -eq 0 ]
  [ "$output" = $'--jobs\n6\n'"$SERIAL" ]

  # A parallel that isn't GNU parallel: plain bats.
  fake parallel 'echo "parallel from moreutils"'
  run runner
  [ "$status" -eq 0 ]
  [ "$output" = "$SERIAL" ]

  # No parallel on PATH: plain bats.
  rm -f "$FAKE/parallel"
  run runner
  [ "$status" -eq 0 ]
  [ "$output" = "$SERIAL" ]

  # GNU parallel, but getconf fails, prints 0, or prints something that isn't a number: plain bats.
  fake parallel 'echo "GNU parallel 20240122"'
  fake getconf 'exit 1'
  run runner
  [ "$status" -eq 0 ]
  [ "$output" = "$SERIAL" ]
  fake getconf 'echo 0'
  run runner
  [ "$status" -eq 0 ]
  [ "$output" = "$SERIAL" ]
  fake getconf 'echo 4x'
  run runner
  [ "$status" -eq 0 ]
  [ "$output" = "$SERIAL" ]
}
