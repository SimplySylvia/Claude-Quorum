# TODO

Feature work to come back to, most valuable first. The first two are designed far enough to start on; the rest are
sketches. Each item says why it matters, which mostly comes from comparing Quorum with the plugins people use for
the same job (Superpowers, Compound Engineering, and Anthropic's `code-review`, `feature-dev`, and
`pr-review-toolkit`), as of November 2026.

## 1. `/quorum:review`: what's left

The command itself shipped (see `CHANGELOG.md`, Unreleased). Still to do:

- **The dashboard doesn't show reviews.** A review is never the active task, so the pane and status line ignore
  it. Show the newest review in `REVIEWING` or `FIXING` (its reviewers, then the voter, as for a review round),
  without hiding an active task.
- **The diagrams.** `assets/src/diagrams.py`'s agent map has a band per command; add one for `/quorum:review`.
- **Run its eval** (`evals/run.sh --case review-standalone-finds-bug`) and a `--comment` eval against a fake `gh`.
- **`/quorum:codify-lesson` from a review.** It reads a task's round files; let it read a review's `run-<N>/`
  files too, so a false alarm in a PR review can become a rule.

## 2. `/quorum:run`: the whole pipeline, stopping only where a person must decide

**Why.** Quorum is eight commands run by hand. Superpowers now runs a plan straight through, stopping only when
blocked, and Compound Engineering has `/lfg`, which plans, builds, reviews, fixes, and commits on its own. People
who trust the checks want to start a task and come back to a PR. Quorum is better placed for this than either: its
gates are enforced by hooks and `quorum-state`, not by asking the model to stop itself, so an autopilot can't skip
proof.

**What it does.**

```
/quorum:run <what to build>        # start a task and take it as far as it can go
/quorum:run                        # continue the active task from wherever it stopped
/quorum:run --until review         # stop after a stage: spec, plan, build, review, blind, pr
/quorum:run --yes                  # also accept the proposals that only need a nod (see below)
```

It reads the task's status and runs the next stage from `pipeline-laws`' stage map, again and again, until it
reaches a gate, an end state, or `--until`. Because each step comes from `state.md`, stopping and running it again
picks up where it left off, and running a single stage command in between still works.

**Where it stops (the gates).** Each is a decision only the user can make, so `run` asks and waits:

| Gate | When | With `--yes` |
|---|---|---|
| Slug, risk tier, and research choice | spec | accepted as proposed (HIGH still asks) |
| Model choices | spec, if not configured | `inherit` |
| Docs for a new feature | spec | the places the repo documents similar features |
| Mockup sign-off | UI tasks, before planning | always asks |
| Plan approval | after plan review | accepted if no `[IMPORTANT]` survives (HIGH still asks) |
| HALTED | the review loop or blind test runs out of rounds | always stops, with the post-mortem |
| ESCALATED | the Stop hook fails 3 times | always stops |
| Human review | `AWAITING-HUMAN` (MEDIUM and HIGH) | always stops; drafts the PR first |

It never pushes, opens a PR, or merges; it ends with `/quorum:pr-draft`'s output and the commands to run.

**The hard design question: how `run` reaches the stages.** Every stage skill has
`disable-model-invocation: true` so Claude never starts a review on its own, and that may also stop a running
`/quorum:run` from invoking them through the Skill tool. Options:

1. **Shared step files.** Move each stage's body into `skills/<stage>/steps.md`; the stage's `SKILL.md` becomes a
   short wrapper that reads it, and `run` reads the same files in order. One source of truth, no invocation
   question. Costs a refactor of every stage skill and their evals.
2. **Check whether a user-invoked skill may invoke `disable-model-invocation` skills.** If the harness allows it
   from inside a user-started command, `run` is mostly a loop over the stage map. Verify before choosing.
3. **A Workflow script.** Deterministic, but needs the user to opt into workflows and loses the conversational
   gates.

Leaning towards 1, after checking 2.

**Context budget.** A whole MEDIUM task in one conversation is long: research, two spec reviews, two plan rounds,
up to three review rounds, a blind test. The orchestrator only reads agents' replies and saves them, but that adds
up. Ideas: print a one-line progress note per stage and keep the verbatim replies in files, not in the chat; make
sure the stage skills already say "save verbatim, show the summary" (most do).

**Dashboard.** The band could show "autopilot: running · next gate: plan approval", and a toast at each gate, so
a user can work elsewhere and come back when asked.

**Open questions.**

- Should `run` do `/quorum:simplify-diff` after the build? (Yes: it's cheap and shrinks every review round.)
- Should it offer `/quorum:codify-lesson` at the end when a Pattern Category came back in more than one round?
- Evals: a LOW task end to end on the fixture app reaching `READY` with a proof at HEAD; a MEDIUM task stopping at
  plan approval without `--yes`; `run` with no task and no request asks what to build instead of guessing.

## 3. A fast path for LOW tasks

One command for a small change: a short spec, a build, one Logic Hunter review, and the proof, with no separate plan
round. Could be `/quorum:run --fast`, or what `run` does by itself for LOW. Keep the Stop hook and the proof rule:
the fast path drops ceremony, not checks.

## 4. Lessons that suggest themselves

`/quorum:codify-lesson` waits for the user. Compound Engineering's best idea is that every task leaves a lesson
for the next. Suggest it (never write it) when:

- the same Pattern Category survives more than one round of a task, or shows up in two tasks;
- the voter drops the same kind of false alarm twice;
- the blind test finds something every reviewer missed.

Also have the planner read `REVIEW.md`'s section 6 explicitly, so a lesson shapes the next plan, not only the next
review.

## 5. A worktree per task, and more than one active task

Today there's one active task and it lives in the main working tree. A worktree per task (`git worktree add` at
`/quorum:build`) would let two tasks run side by side and keep a running review from blocking other work.
`quorum-active-task` becomes per worktree; the dashboard shows the worktree's task.

## 6. CI mode

A GitHub Action that runs `/quorum:review` headless (`claude -p`) on each PR and posts the kept findings, with the
repo's `REVIEW.md`. Pairs with item 1: the same reviewers and voter, on every PR, with no one remembering to run
them. Needs the `github-actions` hardening rules (pinned actions, least-privilege token, no script injection from
PR titles).

## 7. A public benchmark

Run Quorum's review and Anthropic's `code-review` on the fixture apps with planted bugs (the evals already plant
some), and publish how many real bugs each finds, how many false alarms it raises, and what it costs in tokens (the
dashboard's Spend section now counts them). It's Quorum's own "proof before done" applied to its claims, and the
strongest argument a README can make.

## 8. Smaller follow-ups from this release

- **The models on the dashboard.** Show the task's `reviewer_model` and `helper_model` in the pane, next to the
  Spend section's per-model counts, so a mismatch (a choice that didn't take) is visible.
- **Spend per round, kept.** The Spend section only covers agents since the last command, in this session. Keeping
  per-round totals in `state.md` would need the dashboard to write `.tasks/`, which it deliberately never does;
  find another way (a skill step that asks the dashboard for its totals?) or leave it.
- **Evals for this release.** A case where `spec-and-eval` asks the model questions with options from the Agent
  tool and records both in `state.md`; a case where a configured `reviewer_model` skips the question; a case where
  the voter rescores a low-confidence finding after checking it. These make real model calls, so they weren't run
  as part of the change.

## 9. Later

- **Other harnesses.** Superpowers and Compound Engineering also run in Codex and Cursor. Quorum's hooks and the
  dashboard are Claude Code features, so this means a reduced Quorum elsewhere: worth it only once the core is
  settled.
- **The official marketplace.** Submit once `/quorum:review` exists, so the first thing a new user tries works in
  any repo.
