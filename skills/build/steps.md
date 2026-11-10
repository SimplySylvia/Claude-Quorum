<!-- The steps of /quorum:build, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Build the active task

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

Use the slug in `<arguments>`, or `quorum-active-task`. Work from the repo root.

**Unfinished reviews.** First run `quorum-reviews heal <session>`. It marks any `/quorum:review` this session left
unfinished as `INTERRUPTED`, and removes a `--fix` marker it left, which would otherwise point this task's builder
at the review. If it prints ids, mention them in one line.

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
