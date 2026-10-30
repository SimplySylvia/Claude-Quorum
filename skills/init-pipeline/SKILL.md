---
name: init-pipeline
description: Bootstrap the current repo for Quorum. Detects the stack and its fast checks, adds a Verification Commands section to CLAUDE.md, writes REVIEW.md from the review template, generates .claude/hooks/verify-completion.sh, dry-runs it, and gitignores .tasks/. Run once per repo before /quorum:spec-and-eval.
disable-model-invocation: true
argument-hint: "[--yes]"
---

# Bootstrap this repo for Quorum

Set up the project files the rest of Quorum reads. The plugin never hardcodes a stack's commands; everything comes
from the files you write here. Work from the repo root (`quorum-active-task --root`). Never edit the repo's code or
its existing config other than the files listed below.

`$ARGUMENTS` may contain `--yes`: then accept the detected commands, skip null ones, and write without asking. Use
it only when the user typed it.

Templates live in `${CLAUDE_PLUGIN_ROOT}/skills/init-pipeline/templates/`. The `bin/` helpers
(`quorum-detect-stack`, `quorum-render-review`, `quorum-render-verify`, `quorum-active-task`) are on your PATH.

## 1. Check what's already here

- If both `REVIEW.md` and `.claude/hooks/verify-completion.sh` exist, the repo is already bootstrapped. Say so, and
  offer to re-detect the commands and update `CLAUDE.md` and the check script. Never rewrite an existing `REVIEW.md`
  (step 4) without the user asking.
- Note whether `CLAUDE.md`, `REVIEW.md`, and `.gitignore` exist.

## 2. Detect the stack

Run `quorum-detect-stack` and show the user a short table: stack, package manager, monorepo tool, and for each of
build, typecheck, lint, test, dev: the command and where it came from (`sources`). Detection only reads files.

## 3. Confirm the commands

- Ask the user to confirm or correct each command in one question, unless `--yes`. Offer "none" for any that don't
  apply. For a `null` command, ask what to use, or "none".
- In a monorepo (`monorepo` is `nx` or `turbo`), point out that whole-repo commands can be slow, and offer the
  affected-only form if the user wants it (for example `npx nx affected -t test`).
- The fast checks are **typecheck, lint, and test**. At least one must be set, or the Stop hook has nothing to run;
  if all three are "none", stop and explain.

## 4. Draft the files (don't write yet)

Write drafts to a temporary folder first.

1. **`CLAUDE.md`.** Render `templates/CLAUDE.section.md`, replacing each `{{…}}` with the confirmed command in
   backticks, or `none`.
   - If `CLAUDE.md` has a `## Verification Commands` section, replace that section and the
     `## Code Review & Verification Standards` section that follows it. Keep everything else byte for byte.
   - Otherwise append the rendered section to the end.
   - With no `CLAUDE.md`, create one: a `# <repo name>` title, a `## Tech Stack` section of 2–4 lines from the
     detection and the top-level folders (`ls`), then the rendered section. Don't invent architecture you
     haven't read.
   - Keep a new file under 100 lines. If an existing file goes over 100, say so but don't trim the user's content.
2. **`REVIEW.md`** (only if it doesn't exist): `quorum-detect-stack | quorum-render-review --from-detect`.
   If it exists, leave it unchanged, and never touch its section 6 (Learned Rules).
3. **`.claude/hooks/verify-completion.sh`**: `quorum-render-verify` with `--typecheck`, `--lint`, and `--test` for
   each confirmed command that isn't "none".
4. **`.gitignore`**: add a `.tasks/` line if no line already ignores `.tasks` (create the file if needed).

## 5. Show the diff and confirm

Show `diff -u` of each existing file against its draft, and the full text of each new file. Ask the user to
confirm before writing (skip with `--yes`).

## 6. Write

Write the files, `chmod +x .claude/hooks/verify-completion.sh`, and `mkdir -p .tasks`. Don't commit; the user decides.
Claude Code treats `.claude/` as a protected folder and asks before writing there; tell the user to expect that
prompt. If the write is refused, don't write the other files either: a half-set-up repo is worse than none. Say
what's left to do.

## 7. Dry-run the checks

Run `bash .claude/hooks/verify-completion.sh` from the repo root and show the result.

- If it passes, say so.
- If it fails, show which checks failed and the last lines of output. Explain that during a task the Stop hook
  will block "done" until these pass. Offer to change the commands. Don't fix the repo's code here.
- If a tool is missing (for example `command not found`), say which one and how the repo expects it to be installed
  if its README says. Otherwise ask.

## 8. Wrap up

List the files written, and suggest committing `CLAUDE.md`, `REVIEW.md`, `.claude/hooks/verify-completion.sh`, and
`.gitignore`. The next step for a new task is `/quorum:spec-and-eval`.
