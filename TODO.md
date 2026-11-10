# TODO

Feature work to come back to, most valuable first. The first two are designed far enough to start on; the rest are
sketches. Each item says why it matters, which mostly comes from comparing Quorum with the plugins people use for
the same job (Superpowers, Compound Engineering, and Anthropic's `code-review`, `feature-dev`, and
`pr-review-toolkit`), as of November 2026.

## 0. A dashboard screenshot that shows Spend

The 0.5.0 screenshots come from `assets/src/dashboard-demo.sh`, which starts no agents, so they don't show the
pane's **Spend** section (it counts agents that really ran in the session). Next time the screenshots are retaken,
take the review one during a real `/quorum:run` on a bootstrapped copy of `tests/e2e/sales-app`, and add Spend to
its alt text. Open it with `--plugin-dir` and the installed Quorum disabled, so the round cap is the default 3.

## 1. `/quorum:review`: what's left

The command itself shipped in 0.5.0. Still to do:

- **Reviews still running in another session.** The dashboard can't tell a live session from a dead one, so such a
  review shows as "running elsewhere or interrupted" until that session runs another Quorum command. If Claude Code
  ever lists live sessions, check against that.
- **The dashboard screenshots:** see item 0; add one of a review.
- **A `--comment` eval** against a fake `gh` (`review-standalone-finds-bug` passed on 2026-11-10).

## 2. `/quorum:run`: what's left

The command shipped in 0.5.0, with each stage's instructions moved to `steps.md` so `run`
and the stage commands share them. Still to do:

- **Run its evals:** `run-high-asks-tier`, plus the existing stage cases, since every stage skill moved into
  `steps.md` (`run-low-to-ready` passed on 2026-11-10).
- **The dashboard during a run:** "autopilot · next stop: plan approval" in the band, and a toast at each stop, so a
  user can work elsewhere and come back when asked. The dashboard can't tell a run from single commands today.
- **Context length.** A whole MEDIUM task is long for one conversation. Measure one with the Spend section and the
  transcript size, and see whether the chat rule (one line per stage) is enough.

## 3. A fast path for LOW tasks: what's left

`/quorum:run --fast` is built (unreleased). Still to do:

- **Run its eval,** `run-fast-low`, which makes real model calls.
- **Whether `run` should offer it by itself** when the spec settles on LOW, instead of waiting for the flag.

## 4. A worktree per task, and more than one active task

Today there's one active task and it lives in the main working tree. A worktree per task (`git worktree add` at
`/quorum:build`) would let two tasks run side by side and keep a running review from blocking other work.
`quorum-active-task` becomes per worktree; the dashboard shows the worktree's task.

## 5. CI mode

A GitHub Action that runs `/quorum:review` headless (`claude -p`) on each PR and posts the kept findings, with the
repo's `REVIEW.md`. Pairs with item 1: the same reviewers and voter, on every PR, with no one remembering to run
them. Needs the `github-actions` hardening rules (pinned actions, least-privilege token, no script injection from
PR titles).

## 6. A public benchmark

Run Quorum's review and Anthropic's `code-review` on the fixture apps with planted bugs (the evals already plant
some), and publish how many real bugs each finds, how many false alarms it raises, and what it costs in tokens (the
dashboard's Spend section now counts them). It's Quorum's own "proof before done" applied to its claims, and the
strongest argument a README can make.

## 7. Smaller follow-ups from this release

- **Spend per round, kept.** The Spend section only covers agents since the last command, in this session. Keeping
  per-round totals in `state.md` would need the dashboard to write `.tasks/`, which it deliberately never does;
  find another way (a skill step that asks the dashboard for its totals?) or leave it.
- **Evals for this release.** A case where `spec-and-eval` asks the model questions with options from the Agent
  tool and records both in `state.md`; a case where a configured `reviewer_model` skips the question; a case where
  the voter rescores a low-confidence finding after checking it. These make real model calls, so they weren't run
  as part of the change.

## 8. Later

- **Other harnesses.** Superpowers and Compound Engineering also run in Codex and Cursor. Quorum's hooks and the
  dashboard are Claude Code features, so this means a reduced Quorum elsewhere: worth it only once the core is
  settled.
- **The official marketplace.** Submit once `/quorum:review` exists, so the first thing a new user tries works in
  any repo.
