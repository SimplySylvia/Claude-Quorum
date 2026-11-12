# TODO

Feature work to come back to, most valuable first. Items 0 to 3, 11, and 12 finish work already shipped; the rest are
sketches. Each item says why it matters, which mostly comes from comparing Quorum with the plugins people use for
the same job, from two audits on 2026-11-10:

- **Superpowers 7.0.2.** It's a set of working habits that start by themselves in any session, where Quorum is a
  pipeline whose gates are enforced by hooks and agents. Take the habits that help a build go right the first time;
  keep the gates.
- **The rest of the field:** spec-kit 1.4.0, OpenSpec 1.17.0, GSD (gsd-core 1.20.1), BMAD 6.12.4, Compound
  Engineering 3.37.1, ECC 2.2.3, elephant-goldfish 0.1.1, QualityLayer 13.0.1 (from its docs; the source is
  encrypted), and Anthropic's `code-review`, `pr-review-toolkit`, `feature-dev`, `security-guidance`, and `hookify`.
  Almost all of them enforce their process with instructions only; Quorum's blocking hooks, voter, blind user,
  accessibility checks, approved lessons, and dashboard have no open-source equal. Their most common complaint is
  token and context cost, so prefer a lens inside an existing agent, or a script, to a new agent.

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

- **The dashboard during a run:** "autopilot · next stop: plan approval" in the band, and a toast at each stop, so a
  user can work elsewhere and come back when asked. The dashboard can't tell a run from single commands today.
- **Context length.** A whole MEDIUM task is long for one conversation. Measure one with the Spend section and the
  transcript size, and see whether the chat rule (one line per stage) is enough. If it isn't, item 5 is the fix.

## 3. Worktrees: what's left

A worktree per task shipped in 0.9.0. A real headless `/quorum:run --worktree` on `tests/e2e/sales-app` reached
`READY` inside the worktree with the main working tree untouched, and the `run-worktree-fallback` and
`run-worktree-second-task` evals pass (2026-11-10). Still to do:

- **Fewer refused commands.** In the real run, Claude Code refused 11 compound Bash commands in the worktree that it
  couldn't show stay inside it; the model split them and went on, at the cost of turns. The stages now ask for one
  simple command per call. Count the refusals again on the next real run.
- **An eval that enters the worktree.** Evals never offer `EnterWorktree`, so only the fallback has an eval; the
  path through the worktree was checked by hand.
- **Blind tests side by side** can clash on the dev server's port. Pass a free port through the start command, or
  note it in `CLAUDE.md`.
- **Lessons reach a worktree late.** `/quorum:codify-lesson` writes the main working tree's `REVIEW.md`; a task's
  worktree reads its own committed copy.

## 4. Proof that Quorum helps: a baseline and a public benchmark

Superpowers tests each skill by first running an agent without it, and its release notes give the numbers ("found
the conflict 8 of 8 times"). `evals/run.sh` passes `--ablation none`, so a case runs only with the plugin unless it's
given `--ablation with-without`, which adds a no-plugin arm and reports the score delta. Of the peers, only
Superpowers and Compound Engineering measure against a baseline, so this is an edge worth having.

- **More baseline cases.** `baseline-done-with-failing-check` measures the Stop hook with `--ablation with-without`
  (see CONTRIBUTING). The agent cases can't be baselines: they name a Quorum agent, which the no-plugin arm doesn't
  have, and Quorum's commands are user-only, so a shared prompt never reaches the reviewers or the voter. More
  baselines fit what fires unasked: the check lock (a session that weakens a test to pass), the secret guard, the
  map guard. Rerun the baseline for each release that changes a hook, and put the delta in the CHANGELOG.
- **SWE-bench Verified.** Plain Claude Code, `/quorum:run --yes --fast`, and `/quorum:run --yes` on the same model
  and the same random subset (a 10-task pilot, then 50), scored by the hidden tests. Report the false-done rate
  (success claimed while hidden tests fail) beside resolve rate, regressions (PASS_TO_PASS), and cost per solved task.
- **The public benchmark.** Run Quorum's review and Anthropic's `code-review` on real bugs: bug-fix commits from
  open-source repos, reverted, so the right answer is known (planted bugs are ours, so they're easy to argue with).
  Publish how many real bugs each finds, how many false alarms it raises, and what it costs in tokens (the
  dashboard's Spend section now counts them). It's Quorum's own "proof before done" applied to its claims, and the
  strongest argument a README can make.

## 5. Large plans: what's left

A plan of 4 or more steps is built a step at a time, with a checkpoint per step, and mechanical steps can use a
cheaper model. Still to do:

- **Independent steps in parallel.** GSD and Compound Engineering both run independent units as waves of fresh
  workers, each in its own worktree, after checking the units don't touch the same files. Worth it once the
  slices have had a real run on a large task.
- **Measure it.** Compare one MEDIUM task's context and cost built whole and in slices, with the Spend section.

## 6. Review lenses chosen by the diff

The peers' reviewer lists cover kinds of defect Quorum's six don't name. Add them as lenses that a reviewer turns on
when the diff calls for them, not as new agents, since agent count is what peers' users complain about most.

- **Silent failures:** swallowed errors, empty catches, fallbacks that hide a failure (Anthropic's and ECC's
  `silent-failure-hunter`), in the Logic & Edge-Case Hunter.
- **Data migrations, API contracts, and performance and concurrency** (Compound Engineering's conditional reviewers),
  in the Architecture, Security & Drift Hunter, turned on by migrations, public API files, or hot paths in the diff.
- **A second opinion from another vendor's model** for HIGH tasks, as an option: an adversarial pass through Codex or
  Gemini when its CLI is installed, with findings going through the same voter (Compound Engineering, GSD,
  QualityLayer, ECC). It catches what a single model family is blind to.

## 7. CI mode

A GitHub Action that runs `/quorum:review` headless (`claude -p`) on each PR and posts the kept findings, with the
repo's `REVIEW.md`. Pairs with item 1: the same reviewers and voter, on every PR, with no one remembering to run
them. Superpowers' gates are instructions to the model, so it can't do this; Quorum's are agents and scripts. Needs
the `github-actions` hardening rules (pinned actions, least-privilege token, no script injection from PR titles).

## 8. After the PR, and changing a spec

Quorum ends at the drafted PR. Peers follow it further, and let a spec change without starting over.

- **Answer review comments and watch CI.** `/quorum:pr-followup` reads the PR's new comments and CI failures, sorts
  them like review findings (the voter decides which are real), has the builder fix the kept ones under the Stop
  hook, and shows the user the commits; it pushes only after a yes, and stops after 3 CI attempts (Compound
  Engineering's `resolve-pr-feedback` and `babysit-pr`, QualityLayer's `pr watch`).
- **Revise a spec in place.** `spec-and-eval --revise <slug>` changes `rd.md` and `eval.md` for a task that isn't
  halted, reruns the spec reviewers on the change, and marks the plan for review again. `--redesign` only starts
  over after a halt. Hard-to-update specs are spec-kit's most upvoted issue (#1191).

## 9. `/quorum:diagnose`

When a task halts, escalates, or costs more than expected, the post-mortem says what the review loop saw, not why
the session went that way. Superpowers' `diagnosing-superpowers` reads the session's transcripts and reports what
happened, with a `path:line` citation for every finding. A Quorum version would read the transcripts plus
`.tasks/<slug>/` (the state log, the rounds, the votes) and answer: which agent repeated work, which finding came
back and why, where the tokens went (alongside the dashboard's Spend). Read-only, and it never sends anything
anywhere.

## 10. Smaller follow-ups from this release

- **Spend per round, kept.** The Spend section only covers agents since the last command, in this session. Keeping
  per-round totals in `state.md` would need the dashboard to write `.tasks/`, which it deliberately never does;
  find another way (a skill step that asks the dashboard for its totals?) or leave it.
- **Context warnings.** GSD, ECC, and QualityLayer warn when the session's context runs low, and show cost per stage.
  The dashboard could show both, and warn in the band before a long stage starts.
- **Evals for this release.** A case where `spec-and-eval` asks the model questions with options from the Agent
  tool and records both in `state.md`; a case where a configured `reviewer_model` skips the question; a case where
  the voter rescores a low-confidence finding after checking it. These make real model calls, so they weren't run
  as part of the change.

## 11. Deep research: what's left

Deep research and `/quorum:research` shipped in 0.10.0. Still to do:

- **Measure it.** After a few tasks, compare `research_decision` against the cost: does deep research change
  decisions often enough to make it the default for HIGH?
- **Cost on the fixture app:** a `standard` run against today's single researcher.
- **Saved page copies.** hyperresearch checks each sentence against a copy saved at fetch time; Quorum's source
  verifier reopens the live page, which may have changed since.

## 12. Maps, grilling, and retro: what's left

`/quorum:map`, grilling, and `/quorum:retro` shipped in 0.11.0, from a comparison with Matt Pocock's skills
(mattpocock/skills, 2026-10-31): wayfinder, grilling, and retro. Still to do, after a few real maps:

- **The first chart's size.** Charting stops at 8 tickets so later ones don't go stale before early answers change
  them. Check whether real maps hit 8 and whether the fog graduated well, then keep it, make it a setting, or tie it
  to which questions are already sharp.
- **What the map's agents cost.** A code question's facts researcher and the decision check add two agents per
  ticket, and the hand-off review two to four. Measure how often each changes a decision; drop the ones that don't.
- **Maps on the dashboard.** The pane shows tasks only; a map's frontier and its ready tasks would fit the **Other
  tasks** list.
- **A tracker.** Wayfinder keeps its map on GitHub or Linear issues, so the frontier shows in the tracker's UI. Quorum
  keeps it in `.tasks/`; mirroring tickets to a tracker would let a team see and claim them.

## 13. Later

- **The official marketplace.** `/quorum:review` exists now, so the first thing a new user tries works in any repo;
  submit once the worktrees release is out.
- **Specs that outlive the task.** OpenSpec merges each change's requirements into lasting per-capability specs,
  and each later change edits them with a delta. `pr-draft` could merge `rd.md` into a `specs/` folder, and
  `spec-and-eval` could read it first. Valuable, but a different shape of product; now that each requirement gets
  a verdict with evidence, those verdicts are what such a spec would record.
- **Other harnesses.** Superpowers runs in 15, spec-kit in 43, OpenSpec in 35, Compound Engineering in 14. Quorum's
  hooks and the dashboard are Claude Code features, so this means a reduced Quorum elsewhere (the laws,
  `/quorum:review`, and the voter): worth it only once the core is settled.
