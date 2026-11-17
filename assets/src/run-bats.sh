#!/usr/bin/env bash
# Run bats with the given arguments, in parallel when it can be.
#
#   assets/src/run-bats.sh [bats args]    e.g. assets/src/run-bats.sh -r tests/
#
# Runs `bats --jobs N ARGS` when `parallel --version` reports GNU parallel (which bats needs for --jobs) and
# N, from `getconf _NPROCESSORS_ONLN`, is a positive integer; plain `bats ARGS` otherwise. Bash 3.2 compatible.
set -u

n=$(getconf _NPROCESSORS_ONLN 2>/dev/null) || n=
if parallel --version 2>/dev/null | grep -q 'GNU parallel'; then
  case "$n" in
    '' | *[!0-9]*) ;;
    *[1-9]*) exec bats --jobs "$n" "$@" ;;
  esac
fi
exec bats "$@"
