---
name: build
description: Start the first build for the active Quorum task from its approved plan. Creates the feat/<slug> or fix/<slug> branch, records base_sha, and runs the builder agent, which follows plan.md and can't finish until the repo's checks pass. Run after /quorum:plan.
disable-model-invocation: true
argument-hint: "[slug]"
---

# Build the active task

Use the slug in `$ARGUMENTS`, or `quorum-active-task`. Work from the repo root.

## 1. Check the status

`quorum-state get status` must be `BUILDING`, and `quorum-state get plan_approved` must be set (`/quorum:plan`
records it when the user approves `plan.md`). Otherwise say what the status is and which command comes next (see
the `pipeline-laws` skill's stage map), then stop.

## 2. Branch

Run `quorum-branch start <slug>` (add `--fix` when `rd.md` describes a bug fix). It creates or switches to the
branch and records `base_sha`. If it refuses because of uncommitted changes, show `git status` and ask the user
to commit or stash. Never discard their changes.

## 3. Run the builder

Start the `quorum:builder` agent with this prompt (fill in the slug):

> Build task `<slug>` from its approved plan. Read `CLAUDE.md`, `REVIEW.md`, `.tasks/<slug>/rd.md`,
> `.tasks/<slug>/eval.md`, and `.tasks/<slug>/plan.md`. Implement the plan's steps on the current branch, run the
> checks, and commit. Note any deviation from the plan under its `## Deviations`. This is the first build; there are
> no review findings yet.

The builder's SubagentStop hook keeps it working until `.claude/hooks/verify-completion.sh` passes.

## 4. Report

Show the builder's report (changes, commits, check output). Then start `quorum:prover`:

> Task `<slug>`. Run `bash .claude/hooks/verify-completion.sh` and every row in `.tasks/<slug>/eval.md`. Read
> `CLAUDE.md` first.

Save its reply verbatim to `.tasks/<slug>/proof-build.md` and show it. If any row fails, say which, and offer to
start the builder again with the failures.

The next steps are `/quorum:simplify-diff`, then `/quorum:review-loop`.
