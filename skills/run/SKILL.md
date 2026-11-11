---
name: run
description: Take a Quorum task through the whole pipeline in one command, from spec to drafted PR, stopping only where you must decide (the tier, the models, docs, mockup sign-off, plan approval, a halt, and the human review). Starts a new task from a request, or continues the active one from wherever it stopped. With --fast, a LOW task takes the fast path: a short spec, a build, one reviewer, and the proof, with no plan round. Follows the same steps as each stage command, keeps every gate and check, and never pushes, opens, or merges a PR.
disable-model-invocation: true
argument-hint: "[<what to build>] [--bug] [--fast] [--worktree] [--until spec|plan|build|review|blind|pr] [--yes] [--research | --no-research] [--models]"
---

# Run the pipeline

You take one task through Quorum's stages, one after another, by following each stage's own steps. You add no
shortcuts: every check, gate, and agent a stage command runs, you run, and its rules (the Stop hook, the proof
before `READY`, the round caps) hold as they always do.

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

## Values

The stage steps use these. A setting that still reads as `${user_config…}` wasn't set: use its default.

- `<plugin root>`: `${CLAUDE_PLUGIN_ROOT}`
- `<session>`: `${CLAUDE_SESSION_ID}`
- `<max_rounds>`: ${user_config.max_rounds} (default `3`)
- `<nit_cap>`: ${user_config.nit_cap} (default `2`)
- `<security_on_medium>`: ${user_config.security_on_medium} (default `false`)
- `<reviewer_model>`: ${user_config.reviewer_model} (default `ask`)
- `<helper_model>`: ${user_config.helper_model} (default `ask`)
- `<worktrees>`: ${user_config.worktrees} (default `false`)
- `<arguments>`: what this skill passes to each stage (the **Arguments** column below), not its own.

This run's own arguments: `$ARGUMENTS`. They hold an optional request (what to build), and these flags:
`--until <stage>`, `--yes` (only when the user typed it), `--research` or `--no-research`, `--models`, `--fast`,
`--worktree`, and `--bug`.

**`--bug`** treats the request as a bug: the spec reproduces it before anything else, the reproduction becomes the
first check, and the final proof must show it fixed (`Bug: VERIFIED`).

**`--worktree`** builds the task in its own git worktree (as the `worktrees` setting does for every task): the build
stage gets it, and the stages after it work there. This working tree stays free for another task meanwhile.

**`--fast`** puts a new LOW task on the fast path: a short spec with no spec reviewers, no mockup, no plan round, a
build, a review by the Logic & Edge-Case Hunter alone (still with the voter and the round cap), the proof, and the PR
draft. It drops ceremony, not checks: the Stop hook, `eval.md`, and the proof before `READY` hold as always. The spec
steps record it in `state.md` (`fast: true`), and the later stages read it from there, so it only matters when the
run starts a new task; for a MEDIUM or HIGH task it's dropped.

## 1. Before the first stage

- If `REVIEW.md` or `.claude/hooks/verify-completion.sh` is missing, suggest `/quorum:init-pipeline` and stop.
- **A request and an active task** (`quorum-active-task` prints a slug whose status isn't `READY`,
  `AWAITING-HUMAN`, or `HALTED`): ask whether to continue that task or start the new one. Starting the new one
  leaves the old task's files as they are; it only stops being active (`quorum-active-task --clear`).
- **No request and no active task:** if `quorum-active-task --list` shows unfinished tasks (a status other than
  `READY`, `AWAITING-HUMAN`, and `HALTED`), for example ones building in their own worktrees, ask whether to
  continue one of them (`quorum-active-task --set <slug>`) or start a new task. Otherwise ask what to build, then go
  on with the answer as the request.
- Tell the user, in one line, what will happen: the stages ahead (on the fast path: spec, build, review, PR), where it will stop to ask, and that `--until`
  stops it earlier.

## 2. The loop

Repeat: read the status, find its row, follow that stage's `<plugin root>/skills/<stage>/steps.md` with the row's
arguments, and go round again.

**Keep the slug.** Once the task exists (the active one from step 1, or the one the spec creates), always read its
status with `quorum-state --task <slug> get status`. Stages clear the active task when they finish (`READY`,
`AWAITING-HUMAN`, `HALTED`), so a plain `quorum-state get status` would stop finding it. The "no task" row is
only for the first stage of a run that starts a new task. If a stage needs the task active and it isn't, set it
again with `quorum-active-task --set <slug>`. Stop at a row that
says stop, after the stage `--until` names, or after 12 stages in one run (then say where the task is and that
`/quorum:run` continues it).

| Status | Stage to follow | Arguments | `--until` name |
|---|---|---|---|
| no task | `spec-and-eval` | the request, plus `--research`, `--no-research`, `--models`, `--yes`, `--fast`, and `--bug` as given | `spec` |
| `DRAFT-AWAITING-VISUAL-SIGNOFF`, `PLANNING` | `plan` | the slug, plus `--yes` as given unless the risk is HIGH | `plan` |
| `BUILDING`, `base_sha` not set | `build` | the slug, plus `--worktree` as given | `build` |
| `BUILDING`, `base_sha` set | `simplify-diff`, then `review-loop` | none | `build` (before the review loop) |
| `IN_REVIEW` | `review-loop` | none | `review` |
| `CONVERGED` | `blind-test` | none | `blind` |
| `BLIND-TEST` | an earlier blind test was cut off: `rm -f .tasks/<slug>/.blind-mode-active .tasks/.blind-mode-active`, stop any server it left running, `quorum-state set status CONVERGED`, say so, and follow `blind-test` | none | `blind` |
| `READY`, `AWAITING-HUMAN` | `pr-draft`, unless `.tasks/<slug>/pr.md` already exists; then stop | the slug | `pr` |
| `HALTED` | stop: show the post-mortem's two redesign options, and say `/quorum:spec-and-eval --redesign <slug>` restarts it | | |
| `ESCALATED` | stop: show the last check failure; the user fixes the environment or the checks, then runs `/quorum:run` again | | |

`--models` asks again only in the first stage of this run that starts reviewers or helpers; drop it after that.

## 3. Rules while running

- **Gates are the user's.** Every question a stage's steps ask (the slug, tier, and research choice; the models;
  docs; mockup sign-off; plan approval; checking out, posting, or filing anything), ask it and wait. Ask with
  AskUserQuestion where the choices are known, so the run goes on in the same turn after the answer.
- **`--yes` doesn't cover HIGH.** With `--yes`, the spec steps accept your proposals without asking, except that you
  still ask the user to confirm a HIGH tier. Plan approval for a HIGH task always asks (the table leaves `--yes`
  out).
- **Don't hand off.** When a stage's steps end by telling the user which command to run next, don't: go round the
  loop, which reaches that stage by its status. A stage's steps that say "stop" end that stage, not the run, unless
  the status didn't change (a precondition failed): then stop the run, say why, and what fixes it.
- **Keep the chat short.** Agents' replies go to the files the steps name, verbatim, as always. In the chat, show a
  gate's content in full (the research options, the spec review, the plan, the summary before human review), and
  for everything else one line per stage: what ran and its result, for example
  `▸ Review round 1: 1 IMPORTANT kept (Unescaped CSV fields) → builder`.
- **Never** push, open or merge a PR, or change the default branch. The run ends with the PR drafted at the most.

## 4. When it stops

Say where the task is (status, round, risk), why it stopped (a gate's question, `--until`, the end, a halt, or a
precondition), and the next step. At the end of a task (`pr.md` drafted):

- the PR commands the `pr-draft` steps gave, for the user to run;
- for MEDIUM and HIGH, that the human review in the summary comes first;
- the lessons the stages suggested (the review loop's and the blind test's), once each.
