#!/usr/bin/env bash
# Sourced by the guard hooks: read a Bash tool call's command line well enough to see what it runs. Not a sandbox:
# a command can always hide what it does (a script, eval), so the hooks catch the plain forms an agent uses.
# Bash 3.2 compatible.

# The command's stages (split at |, ||, &&, ;, &), one per line, with quote characters removed but quoted text kept:
# for finding the paths a stage names.
stages() { printf '%s\n' "$1" | awk '{ gsub(/\|\||&&|[|;&]/, "\n"); print }' | tr -d "\"'"; }

# The same with quoted text emptied: for reading a stage's flags, so `-m "skip -n"` holds no -n.
bare_stages() {
  printf '%s\n' "$1" | sed -e 's/"[^"]*"/""/g' -e "s/'[^']*'/''/g" | awk '{ gsub(/\|\||&&|[|;&]/, "\n"); print }'
}

# commit_flags STAGE: if STAGE runs `git commit` (git, quorum-git, or a path to git, with any global options before
# the subcommand), print the git global options and the commit's arguments, one per line; else exit 1.
commit_flags() {
  local w seen_git=0 globals="" want_arg=0
  set -f
  # shellcheck disable=SC2086  # word-splitting the stage is the point
  set -- $1
  set +f
  while [ $# -gt 0 ]; do
    case "$1" in *=*|sudo|env|command|time|nohup) [ "$seen_git" = 0 ] && { shift; continue; } ;; esac
    if [ "$seen_git" = 0 ]; then
      case "${1##*/}" in git|quorum-git) seen_git=1 ;; esac
      shift; continue
    fi
    if [ "$want_arg" = 1 ]; then globals="$globals$1"$'\n'; want_arg=0; shift; continue; fi
    case "$1" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path) globals="$globals$1"$'\n'; want_arg=1; shift ;;
      -*) globals="$globals$1"$'\n'; shift ;;
      commit) shift; printf '%s' "$globals"; for w in "$@"; do printf '%s\n' "$w"; done; return 0 ;;
      *) return 1 ;;
    esac
  done
  return 1
}
