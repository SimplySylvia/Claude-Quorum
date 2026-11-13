#!/usr/bin/env bash
# Sourced by the guard hooks: read a Bash tool call's command line well enough to see what it runs. Not a sandbox:
# a command can always hide what it does (a script, eval), so the hooks catch the plain forms an agent uses.
# Bash 3.2 compatible.

# The command without its heredoc bodies: the lines after `<<EOF` (or `<<'EOF'`, `<<-EOF`) up to the terminator are
# data, such as a reviewer's notes quoting `> app.py`, not commands.
no_heredocs() {
  printf '%s\n' "$1" | awk '
    skip != "" { t = $0; if (dash) sub(/^\t+/, "", t); if (t == skip) skip = ""; next }
    { print
      if (match($0, /<<-?[ \t]*["\047]?[A-Za-z_][A-Za-z0-9_]*["\047]?/)) {
        d = substr($0, RSTART, RLENGTH); dash = (d ~ /^<<-/); sub(/^<<-?[ \t]*/, "", d); gsub(/["\047]/, "", d); skip = d
      } }'
}

# The command's stages (split at |, ||, &&, ;, &), one per line, with quote characters removed but quoted text kept:
# for finding the paths a stage names.
stages() { no_heredocs "$1" | awk '{ gsub(/\|\||&&|[|;&]/, "\n"); print }' | tr -d "\"'"; }

# cd_dir COMMAND: the directory the command's first `cd` stage moves to, if it names a literal one; for resolving
# the relative paths the stages after it write. Prints nothing for no cd, a bare `cd`, `cd -`, or a variable.
cd_dir() {
  stages "$1" | awk '$1 == "cd" && NF >= 2 && $2 != "-" && $2 !~ /\$/ { print $2; exit }'
}

# The same with quoted text emptied: for reading a stage's flags, so `-m "skip -n"` holds no -n.
bare_stages() {
  no_heredocs "$1" | sed -e 's/"[^"]*"/""/g' -e "s/'[^']*'/''/g" | awk '{ gsub(/\|\||&&|[|;&]/, "\n"); print }'
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

# write_targets CMD: the paths CMD writes, one per line: a > or >> redirect's target, the arguments of tee, cp, mv,
# rm, truncate, ln, and install, and the files of sed -i and perl -i.
write_targets() {
  local stage prog inplace prev a target writers=" tee cp mv rm truncate ln install " base
  base=$(cd_dir "$1")
  while IFS= read -r stage; do
    set -f
    # shellcheck disable=SC2086  # word-splitting the stage is the point
    set -- $stage
    set +f
    while [ $# -gt 0 ]; do case "$1" in *=*|sudo|env|command|time|nohup) shift ;; *) break ;; esac; done
    [ $# -gt 0 ] || continue
    prog=${1##*/}; shift
    inplace=0; case "$prog" in sed|perl) for a in "$@"; do case "$a" in -i|-i*|--in-place*|-pi*) inplace=1 ;; esac; done ;; esac
    prev=""
    for a in "$@"; do
      target=""
      case "$a" in
        '>'|'>>'|'>|'|'1>'|'2>'|'&>') ;;
        '>>'?*) target=${a#>>} ;;
        '>'?*) target=${a#>} ;;
        *) case "$prev" in '>'|'>>'|'>|'|'1>'|'2>'|'&>') target=$a ;; esac
           if [ -z "$target" ] && case "$writers" in *" $prog "*) true ;; *) false ;; esac; then target=$a; fi
           # sed -i and perl -i edit files that exist: their other words are the script and its options.
           if [ -z "$target" ] && [ "$inplace" = 1 ] && { [ -f "$a" ] || { [ -n "$base" ] && [ -f "$base/$a" ]; }; }; then
             target=$a
           fi ;;
      esac
      [ -z "$target" ] || printf '%s\n' "$target"
      prev=$a
    done
  done <<EOF
$(stages "$1")
EOF
}

# git_subcommand STAGE: if STAGE runs git (git, quorum-git, or a path to git), print its subcommand; else exit 1.
git_subcommand() {
  local seen_git=0 want_arg=0
  set -f
  # shellcheck disable=SC2086  # word-splitting the stage is the point
  set -- $1
  set +f
  while [ $# -gt 0 ]; do
    if [ "$seen_git" = 0 ]; then
      case "$1" in *=*|sudo|env|command|time|nohup) shift; continue ;; esac
      case "${1##*/}" in git|quorum-git) seen_git=1; shift; continue ;; *) return 1 ;; esac
    fi
    if [ "$want_arg" = 1 ]; then want_arg=0; shift; continue; fi
    case "$1" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path) want_arg=1; shift ;;
      -*) shift ;;
      *) printf '%s\n' "$1"; return 0 ;;
    esac
  done
  return 1
}
