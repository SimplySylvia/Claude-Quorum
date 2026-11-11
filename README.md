<div align="center">

<img src=".claude-plugin/icon.png" alt="Quorum icon" width="96">

# Quorum

**A spec-to-pull-request pipeline for Claude Code that checks the work at every stage. The spec and the plan are
reviewed before any code exists, fresh-context reviewers check the code against them, a blind user tries the result,
and nothing counts as done without proof.**

<p>
  <a href="https://code.claude.com/docs/en/plugins-reference"><img src="https://img.shields.io/badge/Claude_Code-plugin-D97757?logo=claude&logoColor=white" alt="Claude Code plugin"></a>
  <a href=".claude-plugin/plugin.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FSimplySylvia%2FClaude-Quorum%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=6b4fd8" alt="Version"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/hooks-bash-4EAA25?logo=gnubash&logoColor=white" alt="Hooks: bash"></a>
  <a href="https://github.com/SimplySylvia/Claude-Quorum/actions/workflows/ci.yml"><img src="https://github.com/SimplySylvia/Claude-Quorum/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="CONTRIBUTING.md#evals"><img src="https://img.shields.io/badge/evals-claude_plugin_eval-6E56CF" alt="Evals"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
</p>

[Quick start](#quick-start) · [Two workflows](#two-workflows-start-to-finish) · [How it works](#how-it-works) ·
[Running a task](#running-a-task) · [Mapping a large effort](#mapping-a-large-effort) · [Guardrails](#guardrails) ·
[Reference](#reference) · [Known limits](#known-limits)

</div>

## Why

When an agent writes most of the code, it goes wrong in a few predictable ways, and asking it to check its own work
doesn't help. Quorum has one mechanism for each:

- **It builds before the details are settled.** A spec that can't work, or a plan that rebuilds a helper the repo
  already has, is cheap to fix on paper and expensive after review. Two spec reviewers check the spec against the
  code, then the same reviewers who will later check the code review the plan, so the build starts from something
  already checked.
- **It specs big work on guesses.** An effort too big for one task has decisions nobody has made yet. A map charts
  them first, gets each one made by you, with the facts behind it, and only then hands the work off as tasks.
- **It grades its own homework.** The agent that wrote the code shares every assumption behind it. Quorum's
  reviewers are separate subagents with a fresh context: they see the diff, the spec, and the plan, never the
  builder's reasoning, and each looks from its own angle: logic, architecture, repo patterns, docs, tests, or
  accessibility.
- **It calls the work done too early.** A Stop hook won't let a task finish until the repo's checks pass, and the
  prover runs every check in the spec and shows the output, including that each new test fails without the fix.
- **Reviews never end.** Builder and reviewer argue for dozens of rounds over the same nits. Quorum caps the loop
  at 3 rounds, reviews only new lines after round 1, limits nits to 2, and runs a voter that drops weak findings.
- **Lessons don't stick.** A bug fixed today comes back next week. Quorum turns it into the cheapest thing that
  stops it, a check before a sentence, and each new plan reads what earlier tasks learned. See
  [Learning from mistakes](#learning-from-mistakes).

The idea underneath is the [Swiss cheese model](https://pmc.ncbi.nlm.nih.gov/articles/PMC1117770/): no single check
is perfect, so stack several different ones whose holes sit in different places. Each dot below is a kind of defect;
it travels right until a layer has no hole in its path. The orange one is the case the model warns about, which is
why every task still carries a rollback plan.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/swiss-cheese-dark.svg">
    <img src="assets/swiss-cheese-light.svg" alt="Animation: eight layers (spec review, plan review, checks and proof, reviewers, voter, security pass, blind test, human gate), each stopping a different kind of defect: a spec that can't meet its goal, a plan that rebuilds a helper or skips docs, a failing test, a regression test that can't fail, an unhandled edge case, a missing auth check, a dead-end screen, and right code with the wrong design. The voter filters a reviewer's false alarm, and one defect escapes where the holes line up, which is what the rollback plan is for." width="880">
  </picture>
</p>

## Quick start

You need [Claude Code](https://code.claude.com/docs) with plugin support, plus `bash`, `git`, and `jq`. This repo is
both the plugin and a single-plugin marketplace:

```
/plugin marketplace add SimplySylvia/Claude-Quorum
/plugin install quorum@quorum
```

Then, once in the repo you want to protect, bootstrap it, and take a task through every stage:

```
/quorum:init-pipeline                            # once: CLAUDE.md, REVIEW.md, verify-completion.sh, .tasks/
/quorum:run Add a CSV export to the sales report # spec → plan → build → review → blind test → PR draft
```

`/quorum:run` stops only where you must decide, and running it again continues from wherever the task stopped.

**Where to start**, by what's in front of you:

| You have | Run |
|---|---|
| A change to make | `/quorum:run <what to build>` (see [Running a task](#running-a-task)) |
| A small change no user can reach: copy, docs, a test | `/quorum:run --fast <what to build>` |
| A bug | `/quorum:run --bug <what's broken>`: it reproduces the bug first, and is done when it's proven fixed |
| A branch or pull request to review, with no setup | `/quorum:review` or `/quorum:review 123` (see [Reviewing any diff](#reviewing-any-diff)) |
| A question: is it worth doing, and which way? | `/quorum:research <question>` (see [Researching before you build](#researching-before-you-build)) |
| An effort too big for one task, with the way unclear | `/quorum:map <the problem>` (see [Mapping a large effort](#mapping-a-large-effort)) |
| A finished task, and the wish to do better next time | `/quorum:retro` (see [Learning from mistakes](#learning-from-mistakes)) |

Every command is user-only: Claude never starts a review loop, or any other Quorum command, on its own. Every one is
in the [Commands](#commands) reference.

## Two workflows, start to finish

What you type, and what runs. Amber is where Quorum stops for you; everything else goes on by itself.

**A feature: chart it, research it, build it.** Three commands take an idea too big for one task to a merged first
task: `/quorum:map` charts it and starts the research, `/quorum:map <slug>` settles one decision per session until
nothing is left, and `/quorum:run --map <slug>` takes each task through every stage.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/workflow-feature-dark.svg">
    <img src="assets/workflow-feature-light.svg" alt="Animation: a feature from a map to a merged task. You type /quorum:map with the idea: you name the destination, and it charts 6 decision tickets; two research tickets start at once. Then /quorum:map with the map's slug, one ticket per session: a researcher gathers the code facts, you decide, and the Feasibility Critic checks each decision. With nothing left to decide, it writes tasks.md with 3 slices, reviewed in map mode, and you approve it. Then /quorum:run --map: task 1's spec comes from the map's decisions; you approve the reviewed plan; the builder writes tests first; review round 1 sends an unescaped CSV field back to the builder, and round 2 converges; the blind test passes; the proof passes and the PR is drafted, and once you merge it, task 2 is ready." width="880">
  </picture>
</p>

```
/quorum:map Let regional managers run their own weekly reports   # destination, tickets, research
/quorum:map regional-reporting                                   # one decision per session, then tasks.md
/quorum:run --map regional-reporting                             # the next ready task, through every stage
```

**A bug fix: reproduce it, fix it, prove it.** One command. A LOW bug takes the fast path, with no plan round, but
keeps every check: the reproduction becomes the first one, and the task isn't done until the proof shows it fixed.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/workflow-bug-dark.svg">
    <img src="assets/workflow-bug-light.svg" alt="Animation: a bug fix with /quorum:run --bug --fast. It reproduces the bug first: a traceback where it should print nothing and exit 0. The reproduction becomes check 1, and check 1b shows it failing without the fix. On a fix branch, the builder writes the regression test first, sees it fail, then fixes it. The Logic Hunter finds the same crash in export and sends it back; the builder fixes every place the bug class appears, and round 2 converges. The proof shows check 1 passing and 1b failing on the old code: Bug: VERIFIED. The task is READY with its PR drafted, and /quorum:retro turns the lesson into a rule." width="880">
  </picture>
</p>

```
/quorum:run --bug --fast summary crashes on an empty data file
```

## How it works

### A task, stage by stage

A task moves through stages 0 to 8, and each stage catches defects the others miss. Here a task on the repo's
fixture app carries two planted bugs; a red stage is one sending the work back:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/stages-dark.svg">
    <img src="assets/stages-light.svg" alt="Animation: one task moving through the stages. Bootstrap and spec and eval pass; plan review finds the plan duplicates an existing loader, and the revised plan is approved; build passes. Review round 1 finds that export ignores DATA_FILE and sends it back to the builder; round 2 converges. The blind test finds that a comma in a customer name splits a CSV row and sends it back to the review loop, which fixes it; the second blind test passes. The lesson becomes a REVIEW.md rule, and the task waits at the human gate." width="880">
  </picture>
</p>

Each band below is a command, and the chips are the agents it starts, with when each one runs underneath. No agent
sees the conversation that produced the code.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/agent-map-dark.svg">
    <img src="assets/agent-map-light.svg" alt="Agent map. Bootstrap writes CLAUDE.md's Verification Commands, REVIEW.md, and the check script. Spec and eval: researcher (MEDIUM/HIGH), then the spec, linted and every check tried once, then two spec reviewers in parallel; --bug reproduces the bug first, and --deep-research uses lensed researchers instead. Plan: the planner writes plan.md, the same reviewers as the review loop check it in plan mode, the voter drops false alarms, the planner revises up to twice, and you approve it. Build: builder, test first and with the checks locked, then prover; with --worktree, in the task's own git worktree, and for a plan of 4 or more steps, a builder per step. Review loop: up to six reviewers in parallel by tier and by what changed, then the verifier-voter; surviving IMPORTANT findings go to the builder and back into review, and after round 3 the task halts for a redesign. Security and blind test (MEDIUM/HIGH): security reviewer, blind user, live accessibility check, friction triager, prover; blockers go back to the review loop. Human gate: pr-writer, citing each requirement's verdict, then you review and merge. Apart from the stages, review any diff with /quorum:review: the review loop's reviewers by tier, plus security for HIGH, then the verifier-voter, one round, with no task needed; --fix hands the kept findings to the builder, and --comment posts them as a GitHub review after you approve. Research a question, also apart from the stages, with /quorum:research: researchers through four lenses (repo, docs, alternatives, counter) in parallel, then quorum-research-check, the source-verifier, and research.md with viability and candidate tasks, creating no task. Map a large effort, also apart from the stages, with /quorum:map: grilling rounds for the destination and then breadth-first, a researcher per research ticket (deep research for weighty ones), quorum-map check, and tasks.md once the map is cleared; then one ticket per run, with a facts-only researcher before a code question and the spec-reviewer's decision check before it's recorded, where only you answer grilling and prototype tickets; then the map-mode reviewers (architecture, patterns, security for HIGH) and the verifier-voter on the breakdown, and spec-and-eval --from-map for each task once its blockers merge. The band notes that it plans only: a hook blocks building. A last line notes that /quorum:run follows stages 1 to 8 in order by itself, stopping only where you decide." width="880">
  </picture>
</p>

<details>
<summary>Files each agent leaves in <code>.tasks/</code></summary>

| Command | Agent | File |
|---|---|---|
| `spec-and-eval` | `researcher` | `research.md`; with `--deep-research`, also `research/<n>-<lens>.md` per researcher and `research/verify.md` |
| | `spec-reviewer` (both personas) | `spec-review/feasibility.md`, `spec-review/improver.md` |
| `plan` | `planner` | `plan.md` |
| | plan reviewers and `verifier-voter`, per round | `plan-review/round-<n>/*.md`, `votes.md`, `survivors.md` |
| `build` | `prover` | `proof-build.md` |
| `review-loop` | reviewers, per round | `review/round-<n>/logic.md`, `architecture.md`, `patterns.md`, `docs.md`, `tests.md`, `a11y.md`, all in `candidates.md` |
| | `verifier-voter` | `review/round-<n>/votes.md`, then `survivors.md` |
| | `prover` (LOW) | `proof-final.md` |
| `blind-test` | `security-reviewer`, `blind-user`, `a11y-auditor`, `friction-triager` | `blind/security-<n>.md`, `blind-<n>.md`, `a11y-<n>.md`, `triage-<n>.md` |
| | `prover` | `proof-final.md` |
| `pr-draft` | `pr-writer` | `pr.md`, `pr-body.md` |
| `research` (no task) | `researcher` per lens, `source-verifier` | `.tasks/research-<slug>/`: `question.md`, `evidence.md`, `research/*.md`, `research.md` |
| `map` (no task) | `researcher`, `spec-reviewer` (decision mode) | `.tasks/map-<slug>/`: `research/<NN>.md`, `research/<NN>-facts.md`, `research-<NN>/` for deep research, `review/<NN>-feasibility.md` |
| | map-mode reviewers and `verifier-voter` | `.tasks/map-<slug>/tasks-review/round-<n>/*.md`, `votes.md`, `survivors.md` |

The paths are under `.tasks/<slug>/` unless they say otherwise. The diagrams are drawn by `assets/src/diagrams.py`;
run it again after changing which agents a command starts.

</details>

One round of the review loop: the reviewers check the code against the spec and the plan, the voter drops false
alarms, and the builder fixes each surviving bug class everywhere it appears before the next round looks at just its
new lines.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/review-loop-dark.svg">
    <img src="assets/review-loop-light.svg" alt="One round of the review loop: pick the diff range (the whole branch in round 1, then only new lines), reviewers in parallel (logic always; architecture, patterns, and docs for MEDIUM/HIGH; tests and accessibility when those change), then the verifier-voter. With nothing IMPORTANT left, the task converges: LOW goes to the prover and READY, MEDIUM/HIGH to the blind test. Otherwise, after round 3 it halts for a redesign; before that, the builder fixes every instance of each Pattern Category and the next round starts. Blind-test blockers enter at the builder." width="640">
  </picture>
</p>

### From a problem to merged code

For an effort too big for one task, a map comes first. It settles the decisions, then hands them off as tasks, and
each task goes through every stage above:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/map-flow-dark.svg">
    <img src="assets/map-flow-light.svg" alt="From a problem to merged code. 1, chart it with /quorum:map and the problem: the destination, grilled until it's one or two concrete lines, plus what's out of scope; a breadth-first survey of every open decision; then at most 8 tickets, with research tickets started at once, in parallel. If it fits one task, charting stops and points to /quorum:spec-and-eval. 2, decide, with /quorum:map and the map's slug, one ticket per session: claim the first ticket waiting on nothing still open; you decide, after a researcher gathers the facts a code question rests on; the Feasibility Critic checks the decision against the code and earlier decisions; then the next ticket, in the next session. 3, hand off, once nothing is left to decide: tasks.md, vertical slices with a tier, what each waits on, and the decisions behind it; a review by the architecture reviewer, the pattern auditor, the security reviewer for HIGH tasks, and the voter; then you approve it. 4, build each task with /quorum:run --map: the spec comes from decisions.md; the whole pipeline runs, plan, build, review loop, blind test, proof; it drafts the PR and you merge it; then the next task whose blockers have merged. 5, learn with /quorum:retro. A map session plans only: a hook blocks it from changing the code." width="880">
  </picture>
</p>

## Running a task

### One command: `/quorum:run`

`/quorum:run` follows each stage's own steps, in order, so a task gets exactly what the separate commands give it:
the same agents, the same checks, the same caps. It goes on by itself between stages and stops where only you can
decide:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/run-dark.svg">
    <img src="assets/run-light.svg" alt="/quorum:run: spec, plan, build, simplify, review loop, blind test, and PR draft, in order, with arrows between them. It stops to ask at the spec (one proposal of slug, tier, research, and docs, plus the models the first time in a repo; --yes accepts all but a HIGH tier; then a follow-up round only if your answers open new questions) and at the plan (mockup sign-off for UI work, then plan approval with the plan's open questions; --yes approves a clean plan except for HIGH), and after the PR draft for your review of MEDIUM and HIGH tasks; it never pushes or opens the PR. It stops if the review loop halts after the round cap or the blind test's fixes don't converge. Blind-test blockers go back to the review loop. LOW tasks skip the blind test and end READY. --until stops after a stage, and running it again continues from the task's status. --fast takes a LOW task through with no spec reviewers, no plan stage, and one reviewer; --worktree builds the task in its own git worktree; --bug reproduces the bug first and is done only when the proof shows it fixed; --deep-research runs lensed researchers in parallel and checks every claim against its source; --map starts the next ready task of a cleared map." width="880">
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

### Stage by stage

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

### More than one task at a time

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

## Before a task

### Researching before you build

`/quorum:research <question>` is for research that decides what the task is: whether something is worth doing, and
which way. For example, "is it worth caching the parsed data, and how?" It creates only the research, in
`.tasks/research-<slug>/`, and never a task.

1. **One gate.** It proposes 2 to 6 sub-questions, each with a lens, and you approve or edit them:
   - **repo precedent:** what the code does today. This researcher isn't told what's being built;
   - **official docs:** for the versions the lockfile pins, with a deprecation check;
   - **alternatives and prior art;**
   - **counter-evidence:** against the leading option, without seeing what supports it.
2. **Researchers in parallel.** Each writes its findings to its own file and returns a few lines, under a
   tool-call budget set by `--effort quick|standard|deep` (2, 3, or up to 6 researchers). For runtime questions, it
   first asks which connected tools (an observability server, logs, a profiler) to gather evidence from.
3. **Every claim carries its evidence.** Claims are tagged `VERIFIED` (with `path:line @ sha` and the line's text),
   `CITED` (with the quote, the URL, the date, and the version), or `ASSUMED`.
   - `quorum-research-check` re-finds every repo quote, and drops a claim whose quote is gone.
   - The `source-verifier` agent reopens only the pages a decision rests on, plus claims with numbers or no quote.
     It drops what the page doesn't say, and flags docs for the wrong version.
   - Assumptions come to you, never into a spec as fact. It offers to settle them in one round.
4. **One gap round at most**, and then the report: the usual options and recommendation, plus **Viability**,
   **Candidate tasks**, **Assumptions to confirm**, and **Remaining gaps**.
5. **Starting a task from it.** `/quorum:spec-and-eval --from-research <slug> <n>` starts a task from a candidate,
   with the research already done. When the candidates are many and depend on each other, it suggests a map.

Inside a task, `--deep-research [quick|standard|deep]` on `/quorum:spec-and-eval` or `/quorum:run` researches the
same way in place of the single researcher. It's opt-in. `state.md` records whether research changed a decision
(`research_decision`), to show whether it pays for itself. The secret guard also checks every web query and URL,
including the researchers'.

### Mapping a large effort

Some work is too big for one task, and the way to it isn't clear yet: a new subsystem, a migration, a product area.
A spec written that early rests on guesses. `/quorum:map` finds the way first, as a map of decisions in
`.tasks/map-<slug>/`. It's an idea taken from Matt Pocock's
[wayfinder](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md) skill, with
Quorum's research, checks, and task pipeline behind it.

```
/quorum:map Let regional managers run their own weekly reports, with trends and alerts   # chart it
/quorum:map regional-reporting            # resolve the next decision with you, one per session
/quorum:run --map regional-reporting      # once it's cleared: the next ready task, through every stage
```

1. **Chart it.** It grills you for the **destination**, one or two concrete lines, and what's out of scope. Then it
   grills breadth-first across everything the destination touches, and charts what it finds:
   - **Tickets**, at most 8 at first, each a question with a type: `grilling` (you talk it through), `research`
     (a `researcher` finds the facts, started at once and in parallel), `prototype` (a throwaway HTML file you react
     to), or `task` (work outside the repo that must happen first, like getting access). Each ticket lists the
     tickets it waits on.
   - **Not yet specified:** questions it can see coming but can't phrase yet. They become tickets as answers clear
     the way, so the map doesn't go stale charting what it can't see.
   - **Out of scope:** work beyond the destination, which never comes back as a ticket.

   If the survey finds nothing unclear, it says the effort fits one task and points you to `/quorum:spec-and-eval`.
2. **Work through it.** Each `/quorum:map <slug>` claims the first ticket on the **frontier** (open, and waiting on
   nothing still open), resolves it with you, adds one line to the map's **Decisions so far**, turns the questions
   the answer made sharp into new tickets, and stops. One ticket per session keeps each decision in a clear
   context. `--revise` reopens a decision that turned out wrong and lists the decisions that rested on it.
3. **Hand it off.** Once nothing is left to decide, it breaks the destination into Quorum tasks in `tasks.md`:
   vertical slices, each one pull request, with its tier, the tasks it waits on, and the decisions it rests on.
   You approve the breakdown after it's reviewed (below).
4. **Build it.** `/quorum:run --map <slug>` starts the next task whose blockers have merged and takes it through
   every stage; `/quorum:spec-and-eval --from-map <slug> <n>` starts one by number. The spec saves the map's
   decisions to `decisions.md`, writes them into the requirements and non-goals, and doesn't ask again what the map
   decided. The spec reviewers and the planner read them too.

**Quorum's agents back up each decision, and none of them makes it:**

- **Research tickets** get a `researcher` each, or for a weighty one (a new dependency, an architecture choice,
  something security rests on) a deep research, whose claims are checked against their sources.
- **A grilling question about the code or a dependency** gets a `researcher` first, in a facts-only mode: what the
  code does today, what the docs say for the pinned version, and the constraints, with no recommendation. You decide
  from facts instead of guesses.
- **Before a decision is recorded,** the `spec-reviewer`'s Feasibility Critic checks it against the code and the
  map's earlier decisions. A problem comes back to you in one round, and your answer stands.
- **The task breakdown** is reviewed in map mode before you approve it: the architecture reviewer checks that each
  task is a real vertical slice and its blocking edges are true, the pattern auditor that no task rebuilds what the
  repo has, and for a HIGH task the security reviewer that nothing is exposed before the task that guards it
  merges. The voter drops false alarms, and what it keeps comes to you with a recommended fix.

**A map plans and never builds.** Its tickets are questions, not build steps, and a hook blocks a map session from
editing the repo outside `.tasks/`, writing into it from Bash, committing, or starting a branch. The map's Notes
can't lift that, because the agent writes the Notes. Only you answer a `grilling` or `prototype` ticket:
`quorum-map resolve` refuses one answered by the agent. A task waits until the tasks it depends on have **merged**,
because its branch starts from the default branch; `quorum-map --map <slug> tasks` shows which have started, which
merged, and which are ready. `bin/quorum-map` keeps the map's index, the frontier, claims, and blocking edges
without a model, and `quorum-map check` catches a broken map: a cycle, a ticket with no question, or a decision
missing from the index.

## Reviewing any diff

`/quorum:review` runs the review loop's reviewers and voter on a diff that isn't a Quorum task: the current
branch, a pull request (`123` or its URL), or a git range (`main..HEAD`). It needs no spec, no plan, and no
bootstrap.

```
/quorum:review                 # this branch against the default branch
/quorum:review 123             # a GitHub PR; add --comment to post the findings on it, after you approve them
```

- **Intent instead of a spec.** The reviewers judge the change against the PR's description, or the commit
  messages for a branch or range, and the code.
- **The same reviewers, by tier.** It proposes a risk tier from what the diff changes and you confirm it (or pass
  `--tier`), which picks the reviewers exactly as the review loop does, plus the security reviewer for HIGH. One
  round, then the voter.
- **Without `REVIEW.md`,** reviewers follow the template's general rules, and the report suggests
  `/quorum:init-pipeline` for rules tailored to the repo.
- **`--comment`** turns the kept `[IMPORTANT]` findings into a GitHub review: inline comments where the line is in
  the PR's diff, the rest in its summary. It shows you every comment and posts nothing without your yes.
- **`--fix`** has the builder fix the kept findings in one commit. The Stop hook checks its work as it does in a
  task, so it needs `verify-completion.sh`; then it offers a review of the fix.
- **A wrong finding becomes a rule.** `/quorum:codify-lesson` reads a review's runs as it reads a task's rounds, so
  a false alarm the voter kept, or one it keeps dropping, can become a line in `REVIEW.md` for the next review.

Each review keeps its runs in `.tasks/review-<id>/` (`review-pr-123`, `review-feat-csv-export`), apart from any
task, so running it again on the same PR reuses its model choice. On a Quorum task's own branch it sends you to
`/quorum:review-loop`, which checks the code against the task's spec and plan.

## Where Quorum asks you

Wherever a decision is yours, Quorum asks in **grilling rounds**: every question that can be asked now, in one
message, each with the answer it recommends and worded so "yes" accepts it. It looks facts up instead of asking you,
never asks again what you or a map already decided, and leaves a question that depends on an open one for the next
round. That happens:

- **at the spec:** the proposal and design questions together, then a follow-up round only when your answers open
  new questions;
- **after research:** the approach, and each of the research's assumptions to confirm, which never go into a spec
  as fact until you confirm them;
- **on a spec-review finding only you can settle,** such as what a requirement should mean;
- **at plan approval,** for the plan's open questions, instead of leaving them for the builder to guess;
- **when choosing a redesign** for a halted task;
- **throughout a map.**

Building, reviewing, and proving never stop to ask. With `--yes`, Quorum takes its recommended answers and lists
them, except where you must answer (a HIGH tier, and a map's grilling and prototype tickets). The `grilling` skill
also works on its own: ask Claude to grill you on a plan.

## Learning from mistakes

A lesson is only learned once it changes what the next build or review does, and the surest change is one a machine
checks. Quorum suggests one when a Pattern Category comes back, the voter drops the same false alarm twice, or the
blind test finds what every reviewer missed, and writes it only after you say yes.

- **`/quorum:codify-lesson`** turns one lesson into the cheapest thing that stops it, in this order: a check the
  repo already has but `verify-completion.sh` never ran, a regression test, a lint rule, a pattern rule a hook
  blocks during tasks, a one-line rule in `REVIEW.md`, or a pointer in `CLAUDE.md` when an agent couldn't find
  something. `--audit` offers to retire rules no review has cited in months, and steering lines that do nothing.
- **`/quorum:retro`** looks back over a whole task, a map, a session, or a stretch of work (`--since <date>`), after
  Matt Pocock's [retro](https://github.com/mattpocock/skills/blob/main/skills/engineering/retro/SKILL.md). It reads
  Quorum's records (rounds, false alarms, blind-test blockers, halts, plan deviations, reopened decisions, research
  that changed nothing) and the session logs: `quorum-session` counts the tool calls, failed commands, hook blocks,
  files read again and again, and long searches, never the content. It ranks what it finds most severe first, from
  checks and review rules to broken commands, missing access, and Quorum settings worth changing; applies the ones
  you pick in `codify-lesson`'s order; and saves the retro to `.tasks/retro-<date>/`, so a declined idea isn't
  proposed again for nothing.

Each new plan reads what earlier tasks learned (`quorum-lessons history`): post-mortems, blind-test blockers,
findings that kept coming back, and the learned rules, and says how it avoids each.

## The dashboard

While a task is active, Quorum shows where it is without you asking:

<p align="center">
  <img src="assets/dashboard-review.png" alt="Claude Code with the Quorum dashboard docked on the right, for the task &quot;Export the sales rows as CSV&quot;, ticket SALES-12. The task card: csv-export, IN_REVIEW, MEDIUM, the goal, the stepper with Spec, Plan, and Build ticked and Review at round 2 of 3, and the plan&#39;s 2 review rounds, approved 2026-11-08. The Now card, code review round 2 of 3: 2 of 4 reviewers replied, Logic and edge cases clean, Architecture and drift 1 NIT, Patterns, Docs, and the verifier vote waiting, and a Next button for /quorum:review-loop that fills the prompt. Below, folding sections: Requirements opened by itself, 3 of 4 met, requirement 1 failing, then what&#39;s out of scope; Checks opened by itself, 5 of 6 pass, a warning that the proof ran before HEAD, and a PASS or FAIL badge on each check, with 1b, honors DATA_FILE, failing; Review rounds folded to r1 1 IMPORTANT, r2 reviewing; Other tasks folded to 1 unfinished task, 1 in worktrees. Above the prompt, the band: an IN_REVIEW badge, csv-export, MEDIUM, a dot per stage, Review 2/3, reviewers 2/4, checks 5/6, 1 check failing and proof older than HEAD in red, the Next button, and Dashboard." width="880">
</p>
<p align="center">
  <img src="assets/dashboard-done.png" alt="The same task finished. The task card: AWAITING-HUMAN, every stage ticked and the PR stage waiting, the plan&#39;s 2 review rounds approved 2026-11-08 and 1 blind-test run, and PR #42 as a link with a copy button. The Now card, its border amber because the task waits on you: waiting for you, next, get PR #42 reviewed and merged. Every section folded to its summary, nothing wrong: Requirements 4 of 4 met, Checks 6 of 6 pass, Review rounds r1 1 IMPORTANT, r2 clean, and Other tasks, 1 unfinished task, 1 in worktrees. Above the prompt, the band: an AWAITING-HUMAN badge, csv-export, MEDIUM, five ticked dots and the PR&#39;s, PR #42, checks 6/6, and Dashboard." width="880">
</p>

<sub>Both are the demo task from `assets/src/dashboard-demo.sh` (see [CONTRIBUTING.md](CONTRIBUTING.md)): mid-review, and
finished with its PR open.</sub>

- **The band above the prompt:** the task's status, a dot per stage, the round's progress, anything wrong in red,
  and **▶ Next** and **Dashboard** buttons.
- **The pane,** which opens by itself during a task (`/quorum-dashboard` shows or hides it):
  - **Task card:** title, goal, status, a stage stepper, and the PR once there is one.
  - **Now card:** what the current stage is doing, such as each reviewer's progress and the findings the voter
    kept. Its border turns amber when it's your move and red when the task is stuck.
  - **Folding sections:** Requirements, Checks, Review rounds, Spend (tokens and models used, the models the task
    chose, and a warning when an agent ran on another), Other tasks, and Other agents. A section with a problem opens
    by itself.
- **▶ Next** puts the next command in your prompt to send or edit. It never sends it for you.
- **Toasts** when a task converges, halts, escalates, or is ready for you.
- **`/quorum:review`:** the one this session is running gets a card of its own, with its reviewers, the voter's
  kept findings, and the builder during `--fix`. It sits under a task's cards, or takes the band and pane when
  there's no task. Finished reviews stay in a **Reviews** section, and an unfinished one is flagged as interrupted.

The pane docks beside the chat in a wide fullscreen terminal, and sits above the prompt otherwise. The dashboard only
reads `.tasks/`, so `claude -p`, cloud sessions, and the VS Code chat panel work as before, without it. It shows
tasks and reviews; maps and research aren't on it yet.

## Risk tiers

`/quorum:spec-and-eval` asks "what happens to the user or system if this breaks?" and picks a tier, which you
confirm. The tier decides how many layers the task gets:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/risk-tiers-dark.svg">
    <img src="assets/risk-tiers-light.svg" alt="Risk tiers. LOW, for changes a user can't reach: research only with --research, two spec reviewers, one plan reviewer and one code reviewer plus one for each of tests, UI, or docs it touches, no security pass, no blind test, no human review if green. MEDIUM, for anything a user can see or run: research, two spec reviewers, four to six plan reviewers and four to six code reviewers with the voter, a security pass only with security_on_medium, a blind test with live accessibility checks and friction triage, and a focused human review. HIGH, for data, money, or security: everything MEDIUM gets, the security reviewer on the plan, a blocking security pass, and an architectural sign-off. /quorum:run --fast gives a LOW task no spec reviewers, no plan round, and one code reviewer plus the voter; the checks and the proof stay." width="880">
  </picture>
</p>

## Guardrails

- **Proof before done.** The Stop hook blocks finishing during a task until the repo's fast checks pass; after 3
  failures in a row it lets you go and marks the task `ESCALATED`. A task can't be marked `READY` or
  `AWAITING-HUMAN` without the prover's `proof-final.md`, run at the current commit, with no failed check.
- **Root cause before fixes.** The builder writes each new test first and shows it failing before the code that
  makes it pass. When a check fails, it follows the `debugging` skill: reproduce, read the whole error, check what
  changed, and name the cause with evidence before changing code. It also checks each review finding against the
  code, and disputes a wrong one with evidence; the voter rechecks disputes, and an upheld one becomes a lesson.
- **Bugs are proven fixed.** With `--bug`, the spec reproduces the bug before anything else, and the task isn't done
  until the final proof shows the reproduction passing and failing without the fix (`Bug: VERIFIED`).
- **Every requirement gets a verdict.** The final proof marks each requirement in `rd.md` as MET, PARTIAL,
  MISSING, or CONTRADICTS. MET needs evidence: the checks that pass, and the `file:line` that does the work, real
  and wired in rather than a stub. Anything but MET goes back to the review loop. The proof also lists code no
  requirement asked for. The dashboard's Requirements section shows each verdict, and the PR draft cites them.
- **The spec and plan are linted first.** `quorum-validate` checks, without a model, that every requirement has
  a check and every check a requirement, and that every plan step names the requirements it serves. It also
  flags vague words. The reviewers start only after that passes.
- **The checks can't be weakened mid-task.** While a task builds or is in review, a hook blocks edits to the
  task's own `rd.md` and `eval.md` (once its build has started), `verify-completion.sh`, CI workflows, and the
  usual test, lint, type-check, and format configs. It also blocks `git commit --no-verify` and commits with
  `core.hooksPath` set. It applies to the builder and the main session alike. A change the task really needs goes
  in `plan.md`'s **Checks changes**, which you approve with the plan. Otherwise only you can unlock a file, with
  `! quorum-state push unlocked <path>`. Add your own with the `protected_paths` option or `.claude/quorum.json`.
- **Maps don't build.** In a `/quorum:map` session, a hook blocks edits to the repo outside `.tasks/`, Bash commands
  that write into it, commits and pushes, and starting a task's branch. It applies only to that session.
- **Secrets stay out.** In every session, a hook blocks reading `.env` and other credential files, and blocks a
  commit whose new lines look like a key or token. It names the file, line, and kind, never the value. A fake value
  in a test passes with `quorum: allow-secret` on its line. The `secret_guard` option turns it off.
- **No silent reviewers.** A reviewer that returns nothing, or a reply without a summary, is rerun once. If it fails
  again, the round stops instead of converging without it.
- **Findings stay on the change.** Before the voter, `quorum-findings scope` drops findings on lines the diff
  doesn't change, or on a line with a lint-ignore comment. It keeps `[PRE-EXISTING]` ones, and says why for each
  drop.
- **Hard caps.** At most 3 review rounds, then `HALTED` with a post-mortem and two redesign options.
- **Quiet outside a task.** Apart from the secret guard, the hooks do nothing unless a task is building, in review,
  or escalated, a blind test is running, or the session is working on a map.
- **Asks before writing** to `CLAUDE.md`, `REVIEW.md`, or your global `~/.claude/CLAUDE.md`, with a diff first.
- **Local data only.** Blind tests and `eval.md` checks use local, temporary, or synthetic data, never production.

## Models

Models change often, so Quorum doesn't name any. The first task in a repo asks two questions, with the models
Claude Code offers at that moment as the choices:

- **Reviewers:** the spec, plan, code, accessibility, and security reviewers, the voter, and the source verifier,
  in tasks, reviews, research, and maps. The recommended answer is your session's model, since these decide what
  gets fixed.
- **Helpers:** the PR writer and the friction triager, which summarize and sort. The fastest model is recommended.

The answers go in the task's `state.md`, and every later command uses them. They're also remembered for the repo
in `.claude/quorum.json` (`quorum-config`), so later tasks don't ask; commit the file to share the choice with your
team. Run any command that starts reviewers or helpers with `--models` to choose again. To set a choice for every
repo instead, set the `reviewer_model` and `helper_model` plugin options to `inherit` or a model name; a repo's
remembered choice wins over them. If a recorded model is retired, Quorum asks again. The researcher, planner,
builder, prover, and blind user always run on your session's model.

## What it sets up in your repo

The plugin never hardcodes a test command; it reads them from these files.

```
your-repo/
├── CLAUDE.md                      # + "## Verification Commands" and a link to REVIEW.md
├── REVIEW.md                      # review rules, failure modes for your stack, paths to skip, learned rules
├── .claude/
│   ├── hooks/verify-completion.sh # your fast checks: typecheck, lint, unit tests
│   └── quorum.json                # remembered model choices, pattern rules, per-repo overrides
└── .tasks/                        # always gitignored
    ├── <slug>/                    # a task
    │   ├── rd.md                  # requirements, non-goals, risk tier, rollback plan
    │   ├── eval.md                # runnable pass/fail checks
    │   ├── plan.md                # files, reuse, tests, docs, a11y, security; approved before building
    │   ├── research.md            # MEDIUM/HIGH, or with --research
    │   ├── decisions.md           # a task from a map: the decisions it rests on
    │   ├── mockup.html            # UI tasks only
    │   └── state.md               # status, round, SHAs, pending findings, models, the PR once opened
    ├── map-<slug>/                # a map: map.md, tickets/, research/, review/, tasks.md
    ├── research-<slug>/           # a standalone research
    ├── review-<id>/               # a standalone review
    └── retro-<date>/              # a retro
```

## Reference

### Commands

| Command | What it does | Options |
|---|---|---|
| `/quorum:init-pipeline` | Bootstraps a repo: `CLAUDE.md`'s Verification Commands, `REVIEW.md`, `verify-completion.sh`, `.tasks/` | `--yes` |
| `/quorum:run [<request>]` | Takes a task through every stage, or continues the active one | `--fast`, `--bug`, `--worktree`, `--deep-research [quick\|standard\|deep]`, `--research`, `--no-research`, `--map <map>`, `--until <stage>`, `--yes`, `--models` |
| `/quorum:spec-and-eval <request>` | Stage 1: the tier, research, `rd.md`, `eval.md`, and the spec review | `--bug`, `--research`, `--no-research`, `--deep-research [...]`, `--from-research <slug> [<n>]`, `--from-map <map> <n>`, `--redesign <slug>`, `--models` |
| `/quorum:plan` | Stage 2: `plan.md`, reviewed and approved | `--yes`, `--models` |
| `/quorum:build` | Stage 3: the build, on `feat/<slug>` or `fix/<slug>` | `--worktree` |
| `/quorum:simplify-diff` | Strips debug code and needless abstractions, and reruns the checks | |
| `/quorum:review-loop` | Stages 4–5: the reviewers, the voter, and the builder, up to 3 rounds | `--models` |
| `/quorum:blind-test` | Stage 6, MEDIUM/HIGH: the security pass, the blind user, live accessibility checks | `--models` |
| `/quorum:pr-draft` | Stage 8: the PR description from the spec and the proof | `--models` |
| `/quorum:review [<PR> \| <range>]` | Reviews any diff, with no task | `--comment`, `--fix`, `--tier LOW\|MEDIUM\|HIGH`, `--yes`, `--models` |
| `/quorum:research <question>` | Researches whether and how, creating no task | `--effort quick\|standard\|deep`, `--yes` |
| `/quorum:map <problem> \| <map> [<ticket>]` | Charts an effort as decisions, works one ticket, or hands off its tasks | `--revise "<what changed>"`, `--yes` |
| `/quorum:codify-lesson [<what went wrong>]` | Turns one lesson into a check or a rule | `--audit [--days N]` |
| `/quorum:retro [<task> \| <map>]` | Finds what the next build should do differently | `--session [<id>]`, `--since YYYY-MM-DD` |
| `/quorum-dashboard` | Shows or hides the dashboard pane | |

<details>
<summary><b>Agents</b>: what each of the 14 sees and does</summary>

| Agent | Sees | Job |
|---|---|---|
| `researcher` | the request, the repo, official docs online | Repo precedent and two or three approaches with sources; recommends one. In deep research, one sub-question through one lens, with every claim's evidence in its findings file (it can write only there). For a map's decision, only the facts it rests on, with no recommendation |
| `source-verifier` | the claims a script couldn't settle, and the pinned versions | Reopens each cited page: supported, unsupported (dropped), wrong version, or unreachable |
| `spec-reviewer` | `rd.md`, `eval.md`, research, a map's decisions, the code | Feasibility Critic (does the spec match the code?) or Spec Improver (clear, testable, covered?). In decision mode, checks a map's decision against the code and the map |
| `planner` | `rd.md`, `eval.md`, research, a map's decisions, mockup, the code, plan-review findings | Writes `plan.md` (files, reuse, tests, docs, a11y, security; expand–contract for wide refactors) and revises it |
| `builder` | spec, plan, checks, `CLAUDE.md`, surviving findings | Builds from `plan.md` and fixes code; one commit per round; notes deviations from the plan |
| `prover` | `eval.md`, `CLAUDE.md` | Runs every check, fail-before-fix rows in a temporary worktree; reports PASS/FAIL with output |
| `code-reviewer` | its diff range, the plan, or a map's `tasks.md`; spec, `CLAUDE.md`, `REVIEW.md` | Logic & edge cases; architecture, security & drift; or test adequacy. Flags code that drifts from the plan, and in map mode tasks that aren't real slices or wait on the wrong things |
| `pattern-auditor` | its diff range, the plan, or a map's `tasks.md`; `CLAUDE.md`, `REVIEW.md`, repo rules, the rest of the repo | Reinvented helpers, broken conventions and repo rules; every finding cites the precedent |
| `docs-auditor` | its diff range or the plan, the repo's docs, `CLAUDE.md`, `REVIEW.md` | Docs the change made wrong or left missing; lists linked docs outside the repo |
| `a11y-auditor` | the plan (plan mode), its diff range (diff mode), or the running app (live mode) | WCAG 2.2 A and AA, with a list of what needs a human |
| `verifier-voter` | candidate findings on the plan, the code, or a map's tasks; spec or map, `REVIEW.md` | Opens each cited `file:line`; keeps or drops it |
| `security-reviewer` | the plan, the branch diff, or a map's `tasks.md` with a HIGH task; spec, `CLAUDE.md`, `REVIEW.md` | Exploitable vulnerabilities only; every finding blocks |
| `blind-user` | the user goal and the app's entry point | Uses the running app; blocked from reading source |
| `friction-triager` | blind report, spec, branch diff | Sorts friction into caused, related, data gap, or unrelated; drafts follow-ups |
| `pr-writer` | spec, state log, proof, diff, the repo's PR template | Drafts the PR description, ending with its merge danger (a one-way or two-way door, and the blast radius), and lists commits that must not ship |

</details>

<details>
<summary><b>Configuration</b>: plugin options and their defaults</summary>

Set through Claude Code's plugin options; defaults are in `.claude-plugin/plugin.json`. A repo can override the
blind-test block lists in `.claude/quorum.json`, which helps in monorepos.

| Option | Default | What it does |
|---|---|---|
| `max_rounds` | `3` | Hard cap on review-loop rounds |
| `nit_cap` | `2` | Most `[NIT]` findings per review pass |
| `stop_hook_enabled` | `true` | Turn the Stop-hook check off for a while |
| `verify_timeout_s` | `300` | Timeout for `verify-completion.sh` |
| `security_on_medium` | `false` | Also run the security pass for MEDIUM tasks |
| `reviewer_model` | `ask` | Model for the spec, plan, code, and security reviewers and the voter: `ask`, `inherit`, or a model name |
| `helper_model` | `ask` | Model for the PR writer and the friction triager: `ask`, `inherit`, or a model name |
| `secret_guard` | `true` | Block reading credential files and committing lines that look like secrets |
| `protected_paths` | (none) | More check files a task can't change while it builds or is in review, as comma-separated globs |
| `mechanical_model` | (none: the session's model) | Model for the steps of a large plan that the plan marks mechanical; a mid-tier model at the least |
| `worktrees` | `false` | Build each task in its own git worktree (see [More than one task at a time](#more-than-one-task-at-a-time)) |
| `blind_block_dirs` | `src,app,lib,packages,Source,Content` | Folders the blind user can't read |
| `blind_block_exts` | `ts,tsx,js,jsx,py,rs,go,cpp,h,java,kt,rb` | File types the blind user can't read |

</details>

<details>
<summary><b>Repository layout</b>: where the plugin's parts live</summary>

| Path | What |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest, including the `userConfig` options |
| `.claude-plugin/marketplace.json` | Marketplace manifest (lists this repo as its only plugin) |
| `skills/` | `init-pipeline`, `spec-and-eval`, `plan`, `build`, `simplify-diff`, `review-loop`, `blind-test`, `pr-draft`, `codify-lesson`, `retro`, `review`, `research`, `map`, `run`, and the model-invocable `pipeline-laws`, `debugging`, and `grilling`. Each stage `run` chains keeps its instructions in `steps.md`, which its `SKILL.md` and `run` both follow |
| `agents/` | `researcher`, `spec-reviewer`, `planner`, `builder`, `prover`, `code-reviewer`, `pattern-auditor`, `docs-auditor`, `a11y-auditor`, `verifier-voter`, `security-reviewer`, `blind-user`, `friction-triager`, `pr-writer` |
| `hooks/` | `hooks.json` plus `session-laws.sh`, `block-source-read.sh`, `protect-checks.sh`, `map-guard.sh`, `secret-guard.sh` (all three read commands with `shell-words.sh`), `stop-verify.sh`, `record-pr.sh`, and `dashboard/`, the dashboard's hooks module |
| `types/` | The type contract for the values the dashboard keeps in the session |
| `bin/` | `quorum-branch`, `quorum-detect-stack`, `quorum-findings`, `quorum-learned-rule`, `quorum-render-review`, `quorum-render-verify`, `quorum-active-task`, `quorum-state`, `quorum-reviews`, `quorum-lessons`, `quorum-secrets`, `quorum-validate`, `quorum-config`, `quorum-plan`, `quorum-map`, `quorum-session`, `quorum-research-check`, `quorum-git` (on the Bash PATH while the plugin is enabled) |
| `libexec/` | `git`, which `quorum-git` puts first on PATH when it runs a real git by full path, so git's own child processes (`git worktree add` starts some) reach it too |
| `tests/` | bats tests for every hook and helper, `claude plugin test` tests for the dashboard, fixture repos per stack, and `e2e/sales-app`, a small runnable app for live end-to-end runs |
| `evals/` | `claude plugin eval` suite: risk tiering, one case per agent, the spec, plan, build, and run paths, research, maps, the retro, voter false-alarm drops, blind-mode source reads, and a near-miss (listed in [CONTRIBUTING.md](CONTRIBUTING.md#evals)) |
| `assets/` | The README's animations and diagrams, in light and dark versions; `assets/src/diagrams.py` draws the diagrams, and `assets/src/dashboard-demo.sh` builds a demo task for the dashboard |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`CHANGELOG.md`](CHANGELOG.md) · [`TODO.md`](TODO.md) · [`LICENSE`](LICENSE) | Development guide · release notes · planned features · MIT license |

</details>

## Contributing

Tests, evals, trying a local build, redrawing the diagrams, and releasing are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Known limits

- **Claude Code asks before writing `.claude/hooks/`**, so `init-pipeline` brings one approval prompt.
- **The check, map, and secret guards read commands, they don't sandbox them.** They catch the plain forms an agent
  uses (`cat .env`, `sed -i` on a config, `--no-verify`), not a script written to hide what it does. They also don't
  cover a test script inside `package.json` or `pyproject.toml`, which hold dependencies too. `Grep` over a whole
  folder can still show lines from a `.env` in it.
- **The blind guard is a safeguard, not a sandbox.** It blocks reading source, but running a script that reads
  source gets through, because running code is how a user runs the app.
- **Agents add up.** A MEDIUM or HIGH round runs 4–6 reviewers, a voter, and a builder, for up to 3 rounds, after
  research, two spec reviewers, and up to 2 plan-review rounds. On a map, a code question adds a facts researcher
  and a decision check, and the hand-off adds 2 to 3 reviewers and the voter. See [Models](#models) for choosing
  what they run on.
- **A cut-off map session stays guarded.** If a map session ends before `quorum-map leave`, the guard keeps blocking
  edits in that session until you run it.
- **Accessibility checks are partial.** Automated scans find only part of WCAG 2.2; the a11y auditor lists the
  rest under "Needs a human". A clean report isn't a conformance claim.
- **`verify-completion.sh` should stay fast.** The Stop hook runs it on every finish; put slow suites in `eval.md`.

## License

[MIT](LICENSE).
