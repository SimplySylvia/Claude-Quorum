# TODO

Feature work to come back to, most valuable first. The first two are designed far enough to start on; the rest are
sketches. Each item says why it matters, which mostly comes from comparing Quorum with the plugins people use for
the same job (Superpowers, Compound Engineering, and Anthropic's `code-review`, `feature-dev`, and
`pr-review-toolkit`), as of November 2026.

## 0. Retake the dashboard screenshots

The diagrams are redrawn (the agent map's `/quorum:review` band and the new `/quorum:run` diagram); the other
diagrams' content didn't change. What's left needs a person at a fullscreen terminal:

- `assets/dashboard-review.png` and `assets/dashboard-done.png`. The pane now has a **Spend** section, which only
  appears for agents that really ran in the session: `assets/src/dashboard-demo.sh` writes `.tasks/` files and
  starts no agents, so its screenshots show no Spend. For the review screenshot, run `/quorum:run` on a copy of
  `tests/e2e/sales-app` (bootstrapped as `evals/_fixture/make.sh` does) and take it during the review loop; the
  demo script is still right for the done screenshot.
- Update their alt text in the README to mention the Spend section.

## 1. `/quorum:review`: what's left

The command itself shipped (see `CHANGELOG.md`, Unreleased). Still to do:

- **The dashboard doesn't show reviews.** A review is never the active task, so the pane and status line ignore
  it. Show the newest review in `REVIEWING` or `FIXING` (its reviewers, then the voter, as for a review round),
  without hiding an active task.
- **The dashboard screenshots:** see item 0.
- **Run its eval** (`evals/run.sh --case review-standalone-finds-bug`) and a `--comment` eval against a fake `gh`.
- **`/quorum:codify-lesson` from a review.** It reads a task's round files; let it read a review's `run-<N>/`
  files too, so a false alarm in a PR review can become a rule.

## 2. `/quorum:run`: what's left

The command shipped (see `CHANGELOG.md`, Unreleased), with each stage's instructions moved to `steps.md` so `run`
and the stage commands share them. Still to do:

- **Run its evals:** `run-low-to-ready` (a whole LOW task: the most expensive case in the suite) and
  `run-high-asks-tier`, plus the existing stage cases, since every stage skill moved into `steps.md`.
- **The dashboard during a run:** "autopilot · next stop: plan approval" in the band, and a toast at each stop, so a
  user can work elsewhere and come back when asked. The dashboard can't tell a run from single commands today.
- **Context length.** A whole MEDIUM task is long for one conversation. Measure one with the Spend section and the
  transcript size, and see whether the chat rule (one line per stage) is enough.
- **`--fast` for LOW** (item 3) fits here as a `run` flag.

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
