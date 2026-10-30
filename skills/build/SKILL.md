---
name: build
description: Start the first build for the active Quorum task. Records mockup sign-off for UI tasks, creates the feat/<slug> or fix/<slug> branch, records base_sha, and runs the builder agent, which can't finish until the repo's checks pass. Run after /quorum:spec-and-eval.
disable-model-invocation: true
argument-hint: "[slug]"
---

# Build the active task

Use the slug in `$ARGUMENTS`, or `quorum-active-task`. Work from the repo root.

## 1. Check the status

`quorum-state get status` must be `DRAFT-AWAITING-VISUAL-SIGNOFF` or `BUILDING`. For any other status, say what it
is and which command comes next (see the `pipeline-laws` skill's stage map), then stop.

## 2. Mockup sign-off (UI tasks)

If the status is `DRAFT-AWAITING-VISUAL-SIGNOFF`, ask the user whether they've reviewed
`.tasks/<slug>/mockup.html` and approve it. Never assume approval.

- If they approve: `quorum-state set signoff <today, YYYY-MM-DD>`, then `quorum-state set status BUILDING`.
- If they want changes: update `mockup.html` with them and ask again. Don't start building.

## 3. Branch

Run `quorum-branch start <slug>` (add `--fix` when `rd.md` describes a bug fix). It creates or switches to the
branch and records `base_sha`. If it refuses because of uncommitted changes, show `git status` and ask the user
to commit or stash. Never discard their changes.

## 4. Run the builder

Start the `quorum:builder` agent with this prompt (fill in the slug):

> Build task `<slug>`. Read `CLAUDE.md`, `REVIEW.md`, `.tasks/<slug>/rd.md`, and `.tasks/<slug>/eval.md`.
> Implement the requirements on the current branch, run the checks, and commit. This is the first build; there
> are no review findings yet.

The builder's SubagentStop hook keeps it working until `.claude/hooks/verify-completion.sh` passes.

## 5. Report

Show the builder's report (changes, commits, check output). Then run the `eval.md` task checks yourself and show
the results; if any fail, say which, and offer to start the builder again with the failures.

The next steps are `/quorum:simplify-diff`, then `/quorum:review-loop`.
