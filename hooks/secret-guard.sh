#!/usr/bin/env bash
# PreToolUse hook: keep credentials out of the conversation and out of commits, in every session (secret_guard
# plugin option, default on).
#
# It blocks (exit 2):
#   - Read, or Grep with a path, of a credential file (bin/quorum-secrets path: .env, private keys, .npmrc, ...);
#   - Bash commands where a reading command (cat, head, grep, sed, less, ...) or a redirect names one;
#   - git commit when the lines it adds hold a secret (quorum-secrets staged; with -a or --all, every change to
#     tracked files). The message names each file:line and the kind of secret, never the secret;
#   - WebSearch whose query, or WebFetch whose URL, holds a secret (quorum-secrets text): research must never send
#     one off the machine, and deep research searches a lot.
# Anything else, and any failure to tell, exits 0. Bash 3.2 compatible.
set -uo pipefail

case "$(printf '%s' "${CLAUDE_PLUGIN_OPTION_SECRET_GUARD:-true}" | tr '[:upper:]' '[:lower:]')" in
  false|0|no|off) exit 0 ;;
esac

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"
# shellcheck source=hooks/shell-words.sh
. "$HERE/shell-words.sh"

input=$(cat 2>/dev/null || true)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$cwd" ] && [ -d "$cwd" ]; then cd "$cwd" 2>/dev/null || exit 0; fi

secret() { "$BIN/quorum-secrets" path "$1" 2>/dev/null; }
block() {
  {
    echo "BLOCKED BY QUORUM: $1"
    echo "Quorum's secret guard keeps credentials out of the conversation and out of commits. Ask the user for what you need from it instead (they can turn the guard off with the secret_guard plugin option)."
  } >&2
  exit 2
}

case "$tool" in
  WebSearch|WebFetch)
    q=$(printf '%s' "$input" | jq -r '.tool_input.query // .tool_input.url // empty')
    if [ -n "$q" ] && ! kinds=$(printf '%s\n' "$q" | "$BIN/quorum-secrets" text 2>/dev/null); then
      [ -n "$kinds" ] && block "this $tool would send what looks like a secret ($(printf '%s' "$kinds" | tr '\n' ',' | sed 's/,$//; s/,/, /g')) off the machine. Search with generic terms only."
    fi ;;

  Read)
    path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
    if [ -n "$path" ] && secret "$path"; then block "$path is a credential file."; fi ;;

  Grep)
    path=$(printf '%s' "$input" | jq -r '.tool_input.path // empty')
    if [ -n "$path" ] && secret "$path"; then block "$path is a credential file."; fi ;;

  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    readers=" cat bat tac head tail less more sed awk gawk grep egrep fgrep rg ag ack strings xxd od hexdump nl cut sort uniq wc diff cmp vi vim nvim view nano emacs code open base64 cp scp rsync curl "
    while IFS= read -r stage; do
      set -f
      # shellcheck disable=SC2086  # word-splitting the stage is the point
      set -- $stage
      set +f
      while [ $# -gt 0 ]; do case "$1" in *=*|sudo|env|command|time|nohup|xargs) shift ;; *) break ;; esac; done
      [ $# -gt 0 ] || continue
      prog=${1##*/}; shift
      reads=0; case "$readers" in *" $prog "*) reads=1 ;; esac
      for a in "$@"; do
        a2=${a#<}; a2=${a2#@}
        case "$a" in '<'?*|'@'?*) ;; *) [ "$reads" = 1 ] || continue ;; esac
        if secret "$a2"; then block "this command reads $a2, a credential file."; fi
      done
    done <<EOF
$(stages "$cmd")
EOF
    # a bare "< file" redirect reads it too
    for w in $(printf '%s' "$cmd" | tr -d "\"'" | awk '{ while (match($0, /<[ ]*[^ <>|;&]+/)) { t = substr($0, RSTART + 1, RLENGTH - 1); gsub(/^ +/, "", t); print t; $0 = substr($0, RSTART + RLENGTH) } }'); do
      if secret "$w"; then block "this command reads $w, a credential file."; fi
    done
    while IFS= read -r stage; do
      flags=$(commit_flags "$stage") || continue
      all=""; printf '%s\n' "$flags" | grep -Eq '^(--all|-[A-Za-z]*a[A-Za-z]*)$' && all=--all
      # shellcheck disable=SC2086  # $all is one flag or nothing
      if found=$("$BIN/quorum-secrets" staged $all 2>/dev/null); then continue; fi
      [ -n "$found" ] || continue
      block "the commit would add what looks like a secret:
$found
Remove it (use an environment variable, or the repo's secret store), or if it's a fake value in a test, add \`quorum: allow-secret\` to its line."
    done <<EOF
$(bare_stages "$cmd")
EOF
    ;;
esac
exit 0
