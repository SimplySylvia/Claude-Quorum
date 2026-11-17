#!/usr/bin/env bash
# Sourced by bin/quorum-git, the bin/ helpers and the hooks: find out once which git works, and export the answer so
# every child process reuses it instead of running `git --version` again. Not run on its own.
#
# quorum_git_probe sets and exports exactly two variables, and never changes PATH:
#   QUORUM_GIT_USE    `git` when the git on PATH works, else the first candidate that does (QUORUM_GIT_CANDIDATES,
#                     space-separated, default /opt/homebrew/bin/git /usr/local/bin/git), else `git` again
#   QUORUM_GIT_PROBE  the key the answer was taken under: PATH, a newline, then the candidates
# An exported answer is reused only when its key equals this process's PATH and candidates, and its value is `git` or
# an absolute path to an executable file. Anything else (a stale answer from another PATH, a missing or relative
# path) means a fresh probe. Bash 3.2 compatible.

quorum_git_probe() {
  local key candidate
  key="$PATH"$'\n'"${QUORUM_GIT_CANDIDATES:-/opt/homebrew/bin/git /usr/local/bin/git}"
  if [ "${QUORUM_GIT_PROBE:-}" = "$key" ]; then
    case "${QUORUM_GIT_USE:-}" in
      git) export QUORUM_GIT_USE QUORUM_GIT_PROBE; return 0 ;;
      /*) if [ -f "$QUORUM_GIT_USE" ] && [ -x "$QUORUM_GIT_USE" ]; then export QUORUM_GIT_USE QUORUM_GIT_PROBE; return 0; fi ;;
    esac
  fi
  QUORUM_GIT_USE=git
  # `command`, because the helpers define a git() function that calls quorum-git, which would recurse.
  if ! command git --version >/dev/null 2>&1; then
    for candidate in ${QUORUM_GIT_CANDIDATES:-/opt/homebrew/bin/git /usr/local/bin/git}; do
      if [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then QUORUM_GIT_USE=$candidate; break; fi
    done
  fi
  QUORUM_GIT_PROBE=$key
  export QUORUM_GIT_USE QUORUM_GIT_PROBE
}
