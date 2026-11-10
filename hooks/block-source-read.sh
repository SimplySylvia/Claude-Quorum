#!/usr/bin/env bash
# PreToolUse hook: keep the blind user out of the source code.
#
# Active when the tool call comes from the quorum:blind-user agent, or while the blind-mode marker /quorum:blind-test
# creates as a fallback exists: .tasks/<slug>/.blind-mode-active, for calls in the session whose directory (the
# input's cwd) resolves to that task, so a blind test in one task's worktree doesn't blind a session working on
# another; or .tasks/.blind-mode-active, from older runs, for every call. Otherwise it exits 0 at once.
# Paths count relative to the working tree the call is in (a task's worktree, or the root).
#
# In blind mode it blocks (exit 2):
#   - Read, Edit, Write, NotebookEdit of a source path;
#   - Grep and Glob anywhere except under .tasks/;
#   - Bash commands where a reading command (cat, sed, grep, less, ...) gets a source path, ".", or a "<"
#     redirect from one. Each part of a pipeline is checked on its own, so running the app
#     (`python3 app/report.py export | head`) is allowed.
#
# A source path is under one of blind_block_dirs or ends in one of blind_block_exts (plugin options, overridable
# per repo in .claude/quorum.json). For the blind-user agent itself, .tasks/, CLAUDE.md, and REVIEW.md count as
# source too: they hold review findings with file:line and notes about the code. (Lockfile-only mode still allows
# .tasks/, which the orchestrator needs.) This is a safeguard, not a sandbox: running a script that reads source
# (`python3 peek.py`) gets through, because running code is how a user runs the app.
# Bash 3.2 compatible.
set -uo pipefail

ROOT=${CLAUDE_PROJECT_DIR:-$(pwd)}
BIN="$(cd "$(dirname "$0")" && pwd)/../bin"
input=$(cat)

agent=$(printf '%s' "$input" | jq -r '.agent_type // empty' 2>/dev/null)
markers() { for m in "$ROOT"/.tasks/.blind-mode-active "$ROOT"/.tasks/*/.blind-mode-active; do [ -e "$m" ] && return 0; done; return 1; }
if [ "$agent" != "quorum:blind-user" ] && ! markers; then exit 0; fi
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$cwd" ] && [ -d "$cwd" ]; then cd "$cwd" 2>/dev/null || true; fi
if [ "$agent" != "quorum:blind-user" ] && [ ! -e "$ROOT/.tasks/.blind-mode-active" ]; then
  task=$("$BIN/quorum-active-task" 2>/dev/null) || exit 0
  [ -e "$ROOT/.tasks/$task/.blind-mode-active" ] || exit 0
fi
strict=0; [ "$agent" = "quorum:blind-user" ] && strict=1
CODE=$("$BIN/quorum-active-task" --code 2>/dev/null) || CODE=$ROOT

dirs=${CLAUDE_PLUGIN_OPTION_BLIND_BLOCK_DIRS:-src,app,lib,packages,Source,Content}
exts=${CLAUDE_PLUGIN_OPTION_BLIND_BLOCK_EXTS:-ts,tsx,js,jsx,py,rs,go,cpp,h,java,kt,rb}
if [ -f "$ROOT/.claude/quorum.json" ]; then
  d=$(jq -r '.blind_block_dirs // empty' "$ROOT/.claude/quorum.json" 2>/dev/null); [ -z "$d" ] || dirs=$d
  e=$(jq -r '.blind_block_exts // empty' "$ROOT/.claude/quorum.json" 2>/dev/null); [ -z "$e" ] || exts=$e
fi

block() {
  echo "BLOCKED BY BLIND-TEST HOOK: You are operating as a First-Time User. Do not read source code. Test the application strictly through its live UI, HTTP endpoints, or CLI interface. ($1)" >&2
  exit 2
}

# is_source PATH: under a blocked dir, or with a blocked extension. Paths are taken relative to the repo root.
is_source() {
  local p=$1 d e
  p=${p#\"}; p=${p%\"}; p=${p#\'}; p=${p%\'}
  case "$p" in "$CODE"/*) p=${p#"$CODE"/} ;; "$ROOT"/*) p=${p#"$ROOT"/} ;; esac
  while [ "${p#./}" != "$p" ]; do p=${p#./}; done
  [ -n "$p" ] || return 1
  if [ "$strict" -eq 1 ]; then
    case "$p" in .tasks|.tasks/*|CLAUDE.md|REVIEW.md) return 0 ;; esac
  else
    case "$p" in .tasks/*|.tasks) return 1 ;; esac
  fi
  local IFS=,
  for d in $dirs; do
    [ -n "$d" ] || continue
    case "$p" in "$d"|"$d"/*) return 0 ;; esac
  done
  for e in $exts; do
    [ -n "$e" ] || continue
    case "$p" in *."$e") return 0 ;; esac
  done
  return 1
}

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty')
case "$tool" in
  Read|Edit|Write|NotebookEdit)
    path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    if is_source "$path"; then block "$tool $path"; fi ;;

  Grep|Glob)
    path=$(printf '%s' "$input" | jq -r '.tool_input.path // empty')
    rel=${path#"$CODE"/}; rel=${rel#"$ROOT"/}
    if [ "$strict" -eq 0 ]; then case "$rel" in .tasks|.tasks/*) exit 0 ;; esac; fi
    block "$tool is disabled in blind mode" ;;

  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    readers=" cat bat tac head tail less more sed awk gawk grep egrep fgrep rg ag ack strings xxd od hexdump nl cut sort uniq wc diff cmp vi vim nvim view nano emacs code open find tree ls file python3 python node ruby perl "
    # One pipeline stage per line.
    printf '%s\n' "$cmd" | awk '{ gsub(/\|\||&&|[|;&]/, "\n"); print }' | while IFS= read -r seg; do
      set -f
      # shellcheck disable=SC2086  # word-splitting the stage is the point
      set -- $seg
      set +f
      # skip env assignments and wrappers (sudo, env, xargs, command, time)
      while [ $# -gt 0 ]; do
        case "$1" in *=*|sudo|env|xargs|command|time|nohup) shift ;; *) break ;; esac
      done
      [ $# -gt 0 ] || continue
      prog=${1##*/}; shift
      case "$readers" in *" $prog "*) ;; *) continue ;; esac
      # Interpreters only count as readers with -c/-e code (python3 app/x.py runs the app, which is allowed).
      case "$prog" in
        python3|python|node|ruby|perl)
          inline=0; for a in "$@"; do case "$a" in -c|-e|-E) inline=1 ;; esac; done
          [ $inline -eq 1 ] || continue ;;
      esac
      prev=""
      for a in "$@"; do
        case "$a" in
          .|./|'*'|'**') case "$prog" in grep|egrep|fgrep|rg|ag|ack|find|tree|ls) echo "blocked: $prog $a"; exit 0 ;; esac ;;
        esac
        a2=${a#<}
        if is_source "$a2"; then echo "blocked: $prog $a"; exit 0; fi
        # text inside -c/-e code: look for source paths in quotes
        if [ "$prev" = "-c" ] || [ "$prev" = "-e" ]; then
          for w in $(printf '%s' "$a" | tr -c 'A-Za-z0-9._/-' ' '); do
            if is_source "$w"; then echo "blocked: $prog reading $w"; exit 0; fi
          done
        fi
        prev=$a
      done
    done > "${TMPDIR:-/tmp}/quorum-blind.$$" 2>/dev/null
    verdict=$(cat "${TMPDIR:-/tmp}/quorum-blind.$$" 2>/dev/null); rm -f "${TMPDIR:-/tmp}/quorum-blind.$$"
    # a bare "< source" redirect also reads the file
    if [ -z "$verdict" ]; then
      for w in $(printf '%s' "$cmd" | awk '{ while (match($0, /<[ ]*[^ <>|;&]+/)) { t = substr($0, RSTART + 1, RLENGTH - 1); gsub(/^ +/, "", t); print t; $0 = substr($0, RSTART + RLENGTH) } }'); do
        if is_source "$w"; then verdict="blocked: redirect from $w"; break; fi
      done
    fi
    if [ -n "$verdict" ]; then block "$verdict"; fi ;;
esac
exit 0
