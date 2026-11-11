#!/usr/bin/env bash
# PreToolUse hook: while a task is BUILDING or IN_REVIEW, keep the checks that decide "done" as the task found them.
#
# The Stop hook won't let a task finish until .claude/hooks/verify-completion.sh passes, so a builder (or the main
# session, talked into it) could pass it by weakening what it runs. During a task this blocks (exit 2):
#   - Edit, Write, and NotebookEdit of a protected file;
#   - Bash commands that write one (a > or >> redirect, tee, cp, mv, rm, truncate, ln, install, sed -i, perl -i);
#   - git commit with --no-verify (or -n), or with core.hooksPath set, which skip the repo's commit hooks;
#   - quorum-state push, set, or clear of `unlocked`: only the user unlocks a file, with `! quorum-state ...`.
#
# Protected: the task's own spec and checks (.tasks/<slug>/rd.md and eval.md, which the prover holds it to) once its
# build has started (base_sha is set; a fast-path task is BUILDING while it still writes them),
# verify-completion.sh, .claude/settings*.json and quorum.json, CI configs (.github/workflows/,
# .gitlab-ci.yml, .circleci/, .buildkite/), commit hooks (.husky/, .pre-commit-config.yaml, lefthook.yml), and the
# usual test, lint, type-check, and format configs at any depth (tsconfig*.json, eslint, prettier, biome, jest,
# vitest, playwright, pytest.ini, tox.ini, setup.cfg, mypy, ruff, .flake8, .golangci.*, clippy.toml, rustfmt.toml,
# ...). The protected_paths plugin option, and `protected_paths` in .claude/quorum.json, add comma-separated
# globs; a glob without a / matches a file name at any depth. A path in the task's `unlocked` list is allowed: the
# plan's Checks changes, which /quorum:plan unlocks when the user approves the plan, or one the user unlocked.
#
# Anything else, and any failure to tell, exits 0 at once. Bash 3.2 compatible.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN="$HERE/../bin"
# shellcheck source=hooks/shell-words.sh
. "$HERE/shell-words.sh"

input=$(cat 2>/dev/null || true)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
case "$tool" in Edit|Write|NotebookEdit|Bash) ;; *) exit 0 ;; esac
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
if [ -n "$cwd" ] && [ -d "$cwd" ]; then cd "$cwd" 2>/dev/null || exit 0; fi

task=$("$BIN/quorum-active-task" 2>/dev/null) || exit 0
status=$("$BIN/quorum-state" --task "$task" get status 2>/dev/null) || exit 0
case "$status" in BUILDING|IN_REVIEW) ;; *) exit 0 ;; esac
CODE=$("$BIN/quorum-active-task" --code 2>/dev/null) || exit 0

SPEC=""
[ -z "$("$BIN/quorum-state" --task "$task" get base_sha 2>/dev/null)" ] || SPEC=".tasks/$task/rd.md .tasks/$task/eval.md"
PROTECTED="$SPEC .claude/hooks/verify-completion.sh .claude/settings.json .claude/settings.local.json .claude/quorum.json
.github/workflows/* .gitlab-ci.yml .circleci/* .buildkite/* .husky/* .pre-commit-config.yaml lefthook.yml .lefthook.yml
tsconfig*.json jsconfig.json .eslintrc .eslintrc.* eslint.config.* .eslintignore .prettierrc .prettierrc.* prettier.config.*
.prettierignore biome.json biome.jsonc .stylelintrc .stylelintrc.* stylelint.config.* jest.config.* vitest.config.*
vitest.workspace.* playwright.config.* cypress.config.* karma.conf.* .mocharc .mocharc.* pytest.ini tox.ini setup.cfg
mypy.ini .mypy.ini ruff.toml .ruff.toml .flake8 .pylintrc pylintrc pyrightconfig.json noxfile.py .golangci.yml
.golangci.yaml .golangci.toml .golangci.json clippy.toml .clippy.toml rustfmt.toml .rustfmt.toml deny.toml
checkstyle*.xml detekt.yml .swiftlint.yml .rubocop.yml phpunit.xml phpunit.xml.dist phpstan.neon"
extra=${CLAUDE_PLUGIN_OPTION_PROTECTED_PATHS:-}
if [ -f "$CODE/.claude/quorum.json" ]; then
  x=$(jq -r '.protected_paths // empty' "$CODE/.claude/quorum.json" 2>/dev/null); [ -z "$x" ] || extra="$extra,$x"
fi
PROTECTED="$PROTECTED $(printf '%s' "$extra" | tr ',' ' ')"
unlocked=$("$BIN/quorum-state" --task "$task" get unlocked 2>/dev/null || true)

# glob_match PATH GLOB: a glob with a / matches the whole relative path; one without matches the file name.
# shellcheck disable=SC2254  # the glob is meant to match as a glob
glob_match() {
  case "$2" in
    */*) case "$1" in $2) return 0 ;; esac ;;
    *) case "${1##*/}" in $2) return 0 ;; esac ;;
  esac
  return 1
}

# protected PATH: prints PATH relative to the code if it's protected and not unlocked.
protected() {
  local p=$1 g
  # an absolute path may name the working tree through a symlink (macOS /var is /private/var)
  p=${p#"$CODE"/}; p=${p#"$(pwd -P)"/}; p=${p#"$(pwd)"/}; p=${p#"${CLAUDE_PROJECT_DIR:-/nonexistent}"/}
  while [ "${p#./}" != "$p" ]; do p=${p#./}; done
  [ -n "$p" ] || return 1
  set -f
  for g in $unlocked; do glob_match "$p" "$g" && { set +f; return 1; }; done
  for g in $PROTECTED; do
    [ -n "$g" ] || continue
    if glob_match "$p" "$g"; then set +f; printf '%s\n' "$p"; return 0; fi
  done
  set +f
  return 1
}

block() {
  {
    echo "BLOCKED BY QUORUM: $1"
    echo "Task '$task' is $status, and the checks that decide when it's done can't change while it is: the Stop hook runs them."
    echo "If the task needs this change, say why and ask the user. A change to the check script or a config belongs in plan.md's \"## Checks changes\" section, which the user approves with the plan."
    echo "Or ask the user; if they agree, they run it themselves: ! quorum-state --task $task push unlocked <path>"
  } >&2
  exit 2
}

case "$tool" in
  Edit|Write|NotebookEdit)
    path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    if rel=$(protected "$path"); then block "$tool $rel is a protected check file."; fi ;;

  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    if printf '%s' "$cmd" | grep -Eq 'quorum-state([[:space:]]+--task[[:space:]]+[^[:space:]]+)?[[:space:]]+(push|set|clear)[[:space:]]+unlocked'; then
      block "only the user unlocks a protected check file."
    fi
    while IFS= read -r stage; do
      flags=$(commit_flags "$stage") || continue
      if printf '%s\n' "$flags" | grep -Eq '^(--no-verify|-[A-Za-z]*n[A-Za-z]*)$'; then
        block "git commit --no-verify skips the repo's commit hooks."
      fi
      if printf '%s\n' "$flags" | grep -qi 'core\.hooksPath'; then block "git commit with core.hooksPath set skips the repo's commit hooks."; fi
    done <<EOF
$(bare_stages "$cmd")
EOF
    writers=" tee cp mv rm truncate ln install "
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
             if [ -z "$target" ] && { case "$writers" in *" $prog "*) true ;; *) false ;; esac || [ "$inplace" = 1 ]; }; then target=$a; fi ;;
        esac
        if [ -n "$target" ] && rel=$(protected "$target"); then block "this command writes $rel, a protected check file."; fi
        prev=$a
      done
    done <<EOF
$(stages "$cmd")
EOF
    ;;
esac
exit 0
