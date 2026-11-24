#!/usr/bin/env bash
# SubagentStop hook: save the stopping agent's report to the file its prompt names.
#
# A stage's steps end an agent's prompt with a line `Report file: <path>`. When the agent stops, this hook writes
# its report to that path, byte for byte, so the orchestrator doesn't retype the reply. The report is the `message`
# of the agent's last SubagentHandback call in its transcript (the input's `agent_transcript_path`), or the input's
# `last_assistant_message` when the transcript has no such call. The prompt is the transcript's first `user` entry;
# of its lines that start with `Report file: `, the last counts.
#
# The path is relative to the task root (`quorum-active-task --root` from the input's `cwd`: the main working tree,
# or a task's own worktree) and must name a file under its `.tasks/`. Never written: `rd.md`, `eval.md` and
# `state.md` in any letter case, and a path with a segment that starts or ends with a dot, since this hook writes
# with no tool call for protect-checks.sh to see. The path is checked as written, and links are followed: the main
# tree's `.tasks/<slug>` is a link into the worktree of a task that has one.
#
# Anything else exits 0 without a word: no jq, input or a transcript it can't read, an empty `agent_type` or a
# transcript that isn't there (Claude Code fires both beside an agent's own stop), no such line, an empty report.
# This hook only saves; it never blocks a stop.
# Bash 3.2 compatible.
set -uo pipefail
exec >/dev/null 2>&1

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"

command -v jq || exit 0
input=$(cat || true)

# --binary on every jq call: without it jq on Windows writes CRLF line ends.
agent_type=$(printf '%s' "$input" | jq --binary -r '.agent_type // empty') || exit 0
[ -n "$agent_type" ] || exit 0
transcript=$(printf '%s' "$input" | jq --binary -r '.agent_transcript_path // empty') || exit 0
transcript=${transcript//\\//}  # on Windows a path has backslashes
[ -f "$transcript" ] || exit 0
cwd=$(printf '%s' "$input" | jq --binary -r '.cwd // empty') || exit 0
cwd=${cwd//\\//}
[ -d "$cwd" ] || exit 0

# What follows `Report file: ` on the last line of the prompt that starts with it.
path=$(jq --binary -rs '
  [.[] | select(.type == "user")][0].message.content
  | if type == "string" then . else (map(select(.type == "text").text) | join("")) end
  | [split("\n")[] | select(startswith("Report file: "))] | last // empty | .[13:]' "$transcript") || exit 0
path=${path//\\//}
while :; do
  case "$path" in *' '|*$'\t'|*$'\r') path=${path%?} ;; *) break ;; esac
done

# A file under .tasks/, by a path with no drive or stream (`:`), no empty segment, and no segment that starts or
# ends with a dot (`..`, `.active`, and `rd.md.`, which Windows opens as `rd.md`).
case "$path" in .tasks/*) ;; *) exit 0 ;; esac
case "/${path#.tasks/}/" in *:*|*//*|*/.*|*./*) exit 0 ;; esac
case "$(printf '%s' "${path##*/}" | tr '[:upper:]' '[:lower:]')" in rd.md|eval.md|state.md) exit 0 ;; esac

cd "$cwd" || exit 0
root=$("$BIN/quorum-active-task" --root) || exit 0
[ -n "$root" ] || exit 0
target="$root/$path"
[ ! -d "$target" ] || exit 0
mkdir -p "${target%/*}" || exit 0

# Straight from jq into a file beside the target: a shell variable would drop the newlines a report ends with.
tmp=$(mktemp "$target.XXXXXX") || exit 0
{ printf '%s\n' "$input"; cat "$transcript"; } | jq --binary -js '
  .[0] as $input
  | [.[1:][] | select(.type == "assistant") | .message.content[]?
     | select(.type == "tool_use" and .name == "SubagentHandback") | .input.message | strings]
  | if length > 0 then last else ($input.last_assistant_message | strings) end' > "$tmp"
if [ -s "$tmp" ]; then mv -f "$tmp" "$target" || rm -f "$tmp"; else rm -f "$tmp"; fi
exit 0
