# How Quorum works

[← Back to the README](../README.md)

## Why each mechanism

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
  [Learning from mistakes](learning-from-mistakes.md).

## Two workflows, start to finish

What you type, and what runs. Amber is where Quorum stops for you; everything else goes on by itself.

**A feature: chart it, research it, build it.** Three commands take an idea too big for one task to a merged first
task: `/quorum:map` charts it and starts the research, `/quorum:map <slug>` settles one decision per session until
nothing is left, and `/quorum:run --map <slug>` takes each task through every stage.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/workflow-feature-dark.svg">
    <img src="../assets/workflow-feature-light.svg" alt="Animation: a feature from a map to a merged task. You type /quorum:map with the idea: you name the destination, and it charts 6 decision tickets; two research tickets start at once. Then /quorum:map with the map's slug, one ticket per session: a researcher gathers the code facts, you decide, and the Feasibility Critic checks each decision. With nothing left to decide, it writes tasks.md with 3 slices, reviewed in map mode, and you approve it. Then /quorum:run --map: task 1's spec comes from the map's decisions; you approve the reviewed plan; the builder writes tests first; review round 1 sends an unescaped CSV field back to the builder, and round 2 converges; the blind test passes; the proof passes and the PR is drafted, and once you merge it, task 2 is ready." width="880">
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
    <source media="(prefers-color-scheme: dark)" srcset="../assets/workflow-bug-dark.svg">
    <img src="../assets/workflow-bug-light.svg" alt="Animation: a bug fix with /quorum:run --bug --fast. It reproduces the bug first: a traceback where it should print nothing and exit 0. The reproduction becomes check 1, and check 1b shows it failing without the fix. On a fix branch, the builder writes the regression test first, sees it fail, then fixes it. The Logic Hunter finds the same crash in export and sends it back; the builder fixes every place the bug class appears, and round 2 converges. The proof shows check 1 passing and 1b failing on the old code: Bug: VERIFIED. The task is READY with its PR drafted, and /quorum:retro turns the lesson into a rule." width="880">
  </picture>
</p>

```
/quorum:run --bug --fast summary crashes on an empty data file
```

## A task, stage by stage

A task moves through stages 0 to 8, and each stage catches defects the others miss. Here a task on the repo's
fixture app carries two planted bugs; a red stage is one sending the work back:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/stages-dark.svg">
    <img src="../assets/stages-light.svg" alt="Animation: one task moving through the stages. Bootstrap and spec and eval pass; plan review finds the plan duplicates an existing loader, and the revised plan is approved; build passes. Review round 1 finds that export ignores DATA_FILE and sends it back to the builder; round 2 converges. The blind test finds that a comma in a customer name splits a CSV row and sends it back to the review loop, which fixes it; the second blind test passes. The lesson becomes a REVIEW.md rule, and the task waits at the human gate." width="880">
  </picture>
</p>

Each band below is a command, and the chips are the agents it starts, with when each one runs underneath. No agent
sees the conversation that produced the code.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/agent-map-dark.svg">
    <img src="../assets/agent-map-light.svg" alt="Agent map. Bootstrap writes CLAUDE.md's Verification Commands, REVIEW.md, and the check script. Spec and eval: researcher (MEDIUM/HIGH), then the spec, linted and every check tried once, then two spec reviewers in parallel; --bug reproduces the bug first, and --deep-research uses lensed researchers instead. Plan: the planner writes plan.md, the same reviewers as the review loop check it in plan mode, the voter drops false alarms, the planner revises up to twice, and you approve it. Build: builder, test first and with the checks locked, then prover; with --worktree, in the task's own git worktree, and for a plan of 4 or more steps, a builder per step. Review loop: up to six reviewers in parallel by tier and by what changed, then the verifier-voter; surviving IMPORTANT findings go to the builder and back into review, and after round 3 the task halts for a redesign. Security and blind test (MEDIUM/HIGH): security reviewer, blind user, live accessibility check, friction triager, prover; blockers go back to the review loop. Human gate: pr-writer, citing each requirement's verdict, then you review and merge. Apart from the stages, review any diff with /quorum:review: the review loop's reviewers by tier, plus security for HIGH, then the verifier-voter, one round, with no task needed; --fix hands the kept findings to the builder, and --comment posts them as a GitHub review after you approve. Research a question, also apart from the stages, with /quorum:research: researchers through four lenses (repo, docs, alternatives, counter) in parallel, then quorum-research-check, the source-verifier, and research.md with viability and candidate tasks, creating no task. Map a large effort, also apart from the stages, with /quorum:map: grilling rounds for the destination and then breadth-first, a researcher per research ticket (deep research for weighty ones), quorum-map check, and tasks.md once the map is cleared; then one ticket per run, with a facts-only researcher before a code question and the spec-reviewer's decision check before it's recorded, where only you answer grilling and prototype tickets; then the map-mode reviewers (architecture, patterns, security for HIGH) and the verifier-voter on the breakdown, and spec-and-eval --from-map for each task once its blockers merge. The band notes that it plans only: a hook blocks building. A last line notes that /quorum:run follows stages 1 to 8 in order by itself, stopping only where you decide." width="880">
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
    <source media="(prefers-color-scheme: dark)" srcset="../assets/review-loop-dark.svg">
    <img src="../assets/review-loop-light.svg" alt="One round of the review loop: pick the diff range (the whole branch in round 1, then only new lines), reviewers in parallel (logic always; architecture, patterns, and docs for MEDIUM/HIGH; tests and accessibility when those change), then the verifier-voter. With nothing IMPORTANT left, the task converges: LOW goes to the prover and READY, MEDIUM/HIGH to the blind test. Otherwise, after round 3 it halts for a redesign; before that, the builder fixes every instance of each Pattern Category and the next round starts. Blind-test blockers enter at the builder." width="640">
  </picture>
</p>

## Risk tiers

`/quorum:spec-and-eval` asks "what happens to the user or system if this breaks?" and picks a tier, which you
confirm. The tier decides how many layers the task gets:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/risk-tiers-dark.svg">
    <img src="../assets/risk-tiers-light.svg" alt="Risk tiers. LOW, for changes a user can't reach: research only with --research, two spec reviewers, one plan reviewer and one code reviewer plus one for each of tests, UI, or docs it touches, no security pass, no blind test, no human review if green. MEDIUM, for anything a user can see or run: research, two spec reviewers, four to six plan reviewers and four to six code reviewers with the voter, a security pass only with security_on_medium, a blind test with live accessibility checks and friction triage, and a focused human review. HIGH, for data, money, or security: everything MEDIUM gets, the security reviewer on the plan, a blocking security pass, and an architectural sign-off. /quorum:run --fast gives a LOW task no spec reviewers, no plan round, and one code reviewer plus the voter; the checks and the proof stay." width="880">
  </picture>
</p>

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
