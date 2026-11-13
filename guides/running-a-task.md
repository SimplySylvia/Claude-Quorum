# Running a task

[← Back to the README](../README.md)

## One command: `/quorum:run`

`/quorum:run` follows each stage's own steps, in order, so a task gets exactly what the separate commands give it:
the same agents, the same checks, the same caps. It goes on by itself between stages and stops where only you can
decide:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/run-dark.svg">
    <img src="../assets/run-light.svg" alt="/quorum:run: spec, plan, build, simplify, review loop, blind test, and PR draft, in order, with arrows between them. It stops to ask at the spec (one proposal of slug, tier, research, and docs, plus the models the first time in a repo; --yes accepts all but a HIGH tier; then a follow-up round only if your answers open new questions) and at the plan (mockup sign-off for UI work, then plan approval with the plan's open questions; --yes approves a clean plan except for HIGH), and after the PR draft for your review of MEDIUM and HIGH tasks; it never pushes or opens the PR. It stops if the review loop halts after the round cap or the blind test's fixes don't converge. Blind-test blockers go back to the review loop. LOW tasks skip the blind test and end READY. --until stops after a stage, and running it again continues from the task's status. --fast takes a LOW task through with no spec reviewers, no plan stage, and one reviewer; --worktree builds the task in its own git worktree; --bug reproduces the bug first and is done only when the proof shows it fixed; --deep-research runs lensed researchers in parallel and checks every claim against its source; --map starts the next ready task of a cleared map." width="880">
  </picture>
</p>

| It stops for | When |
|---|---|
| Why the change is wanted | the spec, only when the request doesn't say |
| One proposal: the slug, risk tier, research, docs for a new feature, and for LOW the fast path | the spec, asked once together with any open design questions (with `--yes`, it accepts the proposal, but still asks about a HIGH tier); a follow-up round only if your answers open new questions |
| The reviewer and helper models | the spec, in that same question, only the first time: the answers are remembered for the repo in `.claude/quorum.json` (`--models` asks again), unless the plugin options set them |
| The research sub-questions | with `--deep-research`, before the researchers start (with `--yes`, it goes on) |
| Mockup sign-off | UI tasks, before planning, always |
| Plan approval, with the plan's open questions | after plan review (with `--yes`, approved when nothing `[IMPORTANT]` survives, except for HIGH) |
| A halt | the review loop or blind test runs out of rounds, or the Stop hook escalates |
| Your review | MEDIUM and HIGH tasks end at `AWAITING-HUMAN`, after drafting the PR |

It never pushes, opens, or merges the PR: it ends with the draft and the commands to run. `--until <stage>`
(`spec`, `plan`, `build`, `review`, `blind`, or `pr`) stops it earlier, and running it again without a request
picks up from the task's status, so you can mix it with the single-stage commands. Between stages it prints one
line per stage; agents' full replies stay in `.tasks/<slug>/`.

- **`--fast`** is for LOW tasks: a short spec with no spec reviewers or mockup, no plan round, the build, a review by
  the Logic & Edge-Case Hunter alone (still with the voter and the round cap), the proof, and the PR draft. It drops
  ceremony, not checks: the Stop hook and the proof before `READY` hold as always. A task the spec puts at MEDIUM or
  HIGH takes the full pipeline instead. The dashboard shows the Plan stage as skipped.
- **`--bug`** reproduces the bug before anything else. That reproduction becomes the first check, alongside one that
  shows it failing without the fix, and the task isn't done until the final proof says `Bug: VERIFIED`.
- **Large plans are built a step at a time.** A plan with 4 or more steps gets a fresh builder for each step. Each
  one starts from the last step's commit and leaves the checks passing, and `state.md` records each step as it's
  built (`built_steps`). A cut-off build, or a new session, picks up at the next step instead of starting over. The
  dashboard's stage rail shows "Build 2/5". Steps the planner marks mechanical can run on a cheaper model with the
  `mechanical_model` option. The review loop still reviews the whole branch.

## Stage by stage

Each stage is also a command of its own, for when you want to stop between them or rerun one:

```
/quorum:spec-and-eval          # per task: risk tier, research, rd.md, eval.md, spec review (and a mockup for UI work)
/quorum:plan                   # plan.md: files, reuse, tests, docs, a11y; reviewed, then you approve it
/quorum:build                  # first build on feat/<slug>, following the plan
/quorum:simplify-diff          # strip debug code and needless abstractions, re-run checks
/quorum:review-loop            # fresh reviewers check the code against the plan → voter → builder, up to 3 rounds
/quorum:blind-test             # MEDIUM/HIGH: security pass, then a user test with no source access
/quorum:pr-draft               # READY / AWAITING-HUMAN: PR description from the spec and proof
```

## More than one task at a time

With `--worktree` (`/quorum:build --worktree` or `/quorum:run --worktree`), or the **A worktree per task** option
for every task, the build checks the task's branch out in its own git worktree, at `.claude/worktrees/<slug>`. Then
it runs the repo's **Setup** command there (from `CLAUDE.md`'s Verification Commands, for example
`pnpm install --frozen-lockfile`) and moves the session in. Every stage after that works in the worktree, and your
main working tree stays as it was. While one task is in review or a blind test, you can spec, plan, or build another
in the main working tree or in another session.

- **One `.tasks/`.** The task's folder moves into its worktree, because Claude Code lets a session in a worktree
  write only inside it. The main working tree's `.tasks/<slug>` becomes a link to it, so you, other sessions, and
  the dashboard still find every task in one place. Git never sees either. The dashboard shows the task of the
  worktree you're in, and lists the repo's other unfinished tasks.
- **Each place has its own active task.** In a worktree, it's the worktree's branch. In the main working tree, it's
  the last task started there. `/quorum:run` with no request asks which unfinished task to continue.
- **The Stop hook checks the right tree.** It runs the task's worktree's `verify-completion.sh`, and a blind test
  only blinds the sessions working on its own task.
- **It needs the bootstrap committed.** A worktree gets committed files only, so `CLAUDE.md`, `REVIEW.md`, and
  `.claude/hooks/verify-completion.sh` must be committed. If they aren't, the build says so and builds in the main
  working tree.
- **Cleanup asks first.** A task's worktree stays until its PR merges. The next task Quorum starts then offers to
  remove it (`git worktree remove`; the branch stays), and removes nothing without your yes. The task's folder moves
  back into the main working tree first, with its whole history.

Two tasks' blind tests at once can clash if both start the app on the same port. A lesson
`/quorum:codify-lesson` writes goes into the main working tree's `REVIEW.md`; a worktree's reviewers see it once
it's committed and the task's branch has it.
