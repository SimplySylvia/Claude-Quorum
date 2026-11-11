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

[Quick start](#quick-start) · [How it works](#how-it-works) · [Risk tiers](#risk-tiers) · [Guardrails](#guardrails) ·
[Reference](#reference) · [Contributing](CONTRIBUTING.md) · [Known limits](#known-limits)

</div>

## Why

When an agent writes most of the code, it goes wrong in a few predictable ways, and asking it to check its own work
doesn't help. Quorum has one mechanism for each:

- **It builds before the details are settled.** A spec that can't work, or a plan that rebuilds a helper the repo
  already has, is cheap to fix on paper and expensive after review. Two spec reviewers check the spec against the
  code, then the same reviewers who will later check the code review the plan, so the build starts from something
  already checked.
- **It grades its own homework.** The agent that wrote the code shares every assumption behind it. Quorum's
  reviewers are separate subagents with a fresh context: they see the diff, the spec, and the plan, never the
  builder's reasoning, and each looks from its own angle: logic, architecture, repo patterns, docs, tests, or
  accessibility.
- **It calls the work done too early.** A Stop hook won't let a task finish until the repo's checks pass, and the
  prover runs every check in the spec and shows the output, including that each new test fails without the fix.
- **Reviews never end.** Builder and reviewer argue for dozens of rounds over the same nits. Quorum caps the loop
  at 3 rounds, reviews only new lines after round 1, limits nits to 2, and runs a voter that drops weak findings.
- **Lessons don't stick.** A bug fixed today comes back next week. `/quorum:codify-lesson` turns it into a
  one-line rule in the repo's `REVIEW.md`, which every future review and plan reads. Quorum suggests one when a
  Pattern Category comes back, the voter drops the same false alarm twice, or the blind test finds what every
  reviewer missed; it writes a rule only after you say yes.

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

Then, in the repo you want to protect:

```
/quorum:init-pipeline          # once per repo: CLAUDE.md, REVIEW.md, verify-completion.sh, .tasks/
/quorum:spec-and-eval          # per task: risk tier, research, rd.md, eval.md, spec review (and a mockup for UI work)
/quorum:plan                   # plan.md: files, reuse, tests, docs, a11y; reviewed, then you approve it
/quorum:build                  # first build on feat/<slug>, following the plan
/quorum:simplify-diff          # strip debug code and needless abstractions, re-run checks
/quorum:review-loop            # fresh reviewers check the code against the plan → voter → builder, up to 3 rounds
/quorum:blind-test             # MEDIUM/HIGH: security pass, then a user test with no source access
/quorum:pr-draft               # READY / AWAITING-HUMAN: PR description from the spec and proof
/quorum:codify-lesson          # optional: save a repeated bug or false alarm as a rule
```

Or let one command take a task through every stage, stopping only where you must decide:

```
/quorum:run Add a CSV export to the sales report   # spec → plan → build → review → blind test → PR draft
/quorum:run --fast Fix the typo in the help text   # LOW only: spec → build → one reviewer → PR draft
/quorum:run --worktree Add a CSV export             # build in its own git worktree; keep working here meanwhile
/quorum:run                                        # continue the active task from wherever it stopped
```

See [Running the whole pipeline](#running-the-whole-pipeline).

Every command is user-only: Claude never starts a review loop on its own.

To try Quorum's reviewers first, no setup needed, review a branch or pull request you already have:

```
/quorum:review                 # this branch against the default branch
/quorum:review 123             # a GitHub PR; add --comment to post the findings on it, after you approve them
```

See [Reviewing any diff](#reviewing-any-diff).

## How it works

A task moves through stages 0 to 8, and each stage catches defects the others miss. Here a task on the repo's
fixture app carries two planted bugs; a red stage is one sending the work back:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/stages-dark.svg">
    <img src="assets/stages-light.svg" alt="Animation: one task moving through the stages. Bootstrap and spec and eval pass; plan review finds the plan duplicates an existing loader, and the revised plan is approved; build passes. Review round 1 finds that export ignores DATA_FILE and sends it back to the builder; round 2 converges. The blind test finds that a comma in a customer name splits a CSV row and sends it back to the review loop, which fixes it; the second blind test passes. The lesson becomes a REVIEW.md rule, and the task waits at the human gate." width="880">
  </picture>
</p>

Each band below is a command you run, and the chips are the agents it starts, with when each one runs underneath.
No agent sees the conversation that produced the code.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/agent-map-dark.svg">
    <img src="assets/agent-map-light.svg" alt="Agent map. Bootstrap writes CLAUDE.md's Verification Commands, REVIEW.md, and the check script. Spec and eval: researcher (MEDIUM/HIGH), then the spec, then two spec reviewers in parallel. Plan: the planner writes plan.md, the same reviewers as the review loop check it in plan mode, the voter drops false alarms, the planner revises up to twice, and you approve it. Build: builder, following the plan, then prover. Review loop: up to six reviewers in parallel by tier and by what changed, then the verifier-voter; surviving IMPORTANT findings go to the builder and back into review, and after round 3 the task halts for a redesign. Security and blind test (MEDIUM/HIGH): security reviewer, blind user, live accessibility check, friction triager, prover; blockers go back to the review loop. Human gate: pr-writer, then you review and merge. Apart from the stages, review any diff with /quorum:review: the review loop's reviewers by tier, plus security for HIGH, then the verifier-voter, one round, with no task needed; --fix hands the kept findings to the builder, and --comment posts them as a GitHub review after you approve. A last line notes that /quorum:run follows stages 1 to 8 in order by itself, stopping only where you decide." width="880">
  </picture>
</p>

<details>
<summary>Files each agent leaves in <code>.tasks/&lt;slug&gt;/</code></summary>

| Command | Agent | File |
|---|---|---|
| `spec-and-eval` | `researcher` | `research.md` |
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

The diagrams are drawn by `assets/src/diagrams.py`; run it again after changing which agents a command starts.

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

## Running the whole pipeline

`/quorum:run` follows each stage's own steps, in order, so a task gets exactly what the separate commands give it:
the same agents, the same checks, the same caps. It goes on by itself between stages and stops where only you can
decide:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/run-dark.svg">
    <img src="assets/run-light.svg" alt="/quorum:run: spec, plan, build, simplify, review loop, blind test, and PR draft, in order, with arrows between them. It stops to ask at the spec (slug, tier, research, models, docs; --yes accepts all but a HIGH tier) and at the plan (mockup sign-off for UI work, then plan approval; --yes approves a clean plan except for HIGH), and after the PR draft for your review of MEDIUM and HIGH tasks; it never pushes or opens the PR. It stops if the review loop halts after the round cap or the blind test's fixes don't converge. Blind-test blockers go back to the review loop. LOW tasks skip the blind test and end READY. --until stops after a stage, and running it again continues from the task's status." width="880">
  </picture>
</p>

| It stops for | When |
|---|---|
| The slug, risk tier, and research choice | the spec (with `--yes`, it accepts its proposals, but still asks about a HIGH tier) |
| The reviewer and helper models | the spec, unless the plugin options set them |
| Docs for a new feature | the spec (with `--yes`, the places the repo documents similar features) |
| Mockup sign-off | UI tasks, before planning, always |
| Plan approval | after plan review (with `--yes`, approved when nothing `[IMPORTANT]` survives, except for HIGH) |
| A halt | the review loop or blind test runs out of rounds, or the Stop hook escalates |
| Your review | MEDIUM and HIGH tasks end at `AWAITING-HUMAN`, after drafting the PR |

It never pushes, opens, or merges the PR: it ends with the draft and the commands to run. `--until <stage>`
(`spec`, `plan`, `build`, `review`, `blind`, or `pr`) stops it earlier, and running it again without a request
picks up from the task's status, so you can mix it with the single-stage commands. Between stages it prints one
line per stage; agents' full replies stay in `.tasks/<slug>/`.

**`--fast`** is for LOW tasks: a short spec with no spec reviewers or mockup, no plan round, the build, a review by
the Logic & Edge-Case Hunter alone (still with the voter and the round cap), the proof, and the PR draft. It drops
ceremony, not checks: the Stop hook and the proof before `READY` hold as always. A task the spec puts at MEDIUM or
HIGH takes the full pipeline instead. The dashboard shows the Plan stage as skipped.

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

## Reviewing any diff

`/quorum:review` runs the review loop's reviewers and voter on a diff that isn't a Quorum task: the current
branch, a pull request (`123` or its URL), or a git range (`main..HEAD`). It needs no spec, no plan, and no
bootstrap.

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

## The dashboard

While a task is active, Quorum shows where it is without you asking:

<p align="center">
  <img src="assets/dashboard-review.png" alt="Claude Code with the Quorum dashboard docked on the right, for the task &quot;Export the sales rows as CSV&quot;, ticket SALES-12. The task card: csv-export, IN_REVIEW, MEDIUM, the goal, the stepper with Spec, Plan, and Build ticked and Review at round 2 of 3, and the plan&#39;s 2 review rounds, approved 2026-11-08. The Now card, code review round 2 of 3: 2 of 4 reviewers replied, Logic and edge cases clean, Architecture and drift 1 NIT, Patterns, Docs, and the verifier vote waiting, and a Next button for /quorum:review-loop that fills the prompt. Below, folding sections: Requirements opened by itself, 3 of 4 met, requirement 1 failing, then what&#39;s out of scope; Checks opened by itself, 5 of 6 pass, a warning that the proof ran before HEAD, and a PASS or FAIL badge on each check, with 1b, honors DATA_FILE, failing; Review rounds folded to r1 1 IMPORTANT, r2 reviewing. Above the prompt, the band: an IN_REVIEW badge, csv-export, MEDIUM, a dot per stage, Review 2/3, reviewers 2/4, checks 5/6, 1 check failing and proof older than HEAD in red, the Next button, and Dashboard." width="880">
</p>
<p align="center">
  <img src="assets/dashboard-done.png" alt="The same task finished. The task card: AWAITING-HUMAN, every stage ticked and the PR stage waiting, the plan&#39;s 2 review rounds approved 2026-11-08 and 1 blind-test run, and PR #42 as a link with a copy button. The Now card, its border amber because the task waits on you: waiting for you, next, get PR #42 reviewed and merged. Every section folded to its summary, nothing wrong: Requirements 4 of 4 met, Checks 6 of 6 pass, Review rounds r1 1 IMPORTANT, r2 clean. Above the prompt, the band: an AWAITING-HUMAN badge, csv-export, MEDIUM, five ticked dots and the PR&#39;s, PR #42, checks 6/6, and Dashboard." width="880">
</p>

<sub>Both are the demo task from `assets/src/dashboard-demo.sh` (see [CONTRIBUTING.md](CONTRIBUTING.md)): mid-review, and
finished with its PR open.</sub>

- **The band above the prompt:** the task's status, a dot per stage, the round's progress, anything wrong in red,
  and **▶ Next** and **Dashboard** buttons.
- **The pane,** which opens by itself during a task (`/quorum-dashboard` shows or hides it):
  - **Task card:** title, goal, status, a stage stepper, and the PR once there is one.
  - **Now card:** what the current stage is doing, such as each reviewer's progress and the findings the voter
    kept. Its border turns amber when it's your move and red when the task is stuck.
  - **Folding sections:** Requirements, Checks, Review rounds, Spend (tokens and models used, the models the task chose, and a warning when an agent ran on another), and Other agents. A
    section with a problem opens by itself.
- **▶ Next** puts the next command in your prompt to send or edit. It never sends it for you.
- **Toasts** when a task converges, halts, escalates, or is ready for you.
- **`/quorum:review`:** the one this session is running gets a card of its own, with its reviewers, the voter's
  kept findings, and the builder during `--fix`. It sits under a task's cards, or takes the band and pane when
  there's no task. Finished reviews stay in a **Reviews** section, and an unfinished one is flagged as interrupted.

The pane docks beside the chat in a wide fullscreen terminal, and sits above the prompt otherwise. The dashboard only
reads `.tasks/`, so `claude -p`, cloud sessions, and the VS Code chat panel work as before, without it.

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
- **The checks can't be weakened mid-task.** While a task builds or is in review, a hook blocks edits to the task's
  own `rd.md` and `eval.md` (once its build has started), `verify-completion.sh`, CI workflows, and the usual test, lint, type-check, and format
  configs. It also blocks
  `git commit --no-verify` and commits with `core.hooksPath` set. It applies to the builder and the main session
  alike. A change the task really needs goes in `plan.md`'s **Checks changes**, which you approve with the plan.
  Otherwise only you can unlock a file, with `! quorum-state push unlocked <path>`. Add your own with the
  `protected_paths` option or `.claude/quorum.json`.
- **Secrets stay out.** In every session, a hook blocks reading `.env` and other credential files, and blocks a
  commit whose new lines look like a key or token. It names the file, line, and kind, never the value. A fake value
  in a test passes with `quorum: allow-secret` on its line. The `secret_guard` option turns it off.
- **No silent reviewers.** A reviewer that returns nothing, or a reply without a summary, is rerun once. If it fails
  again, the round stops instead of converging without it.
- **Findings stay on the change.** Before the voter, `quorum-findings scope` drops findings on lines the diff
  doesn't change, or on a line with a lint-ignore comment. It keeps `[PRE-EXISTING]` ones, and says why for each
  drop.
- **Quiet outside a task.** Apart from the secret guard, the hooks do nothing unless a task is building, in review,
  or escalated, or a blind test is running.
- **Hard caps.** At most 3 review rounds, then `HALTED` with a post-mortem and two redesign options.
- **Asks before writing** to `CLAUDE.md`, `REVIEW.md`, or your global `~/.claude/CLAUDE.md`, with a diff first.
- **Local data only.** Blind tests and `eval.md` checks use local, temporary, or synthetic data, never production.

## Models

Models change often, so Quorum doesn't name any. When a task starts, `/quorum:spec-and-eval` asks two questions,
with the models Claude Code offers at that moment as the choices:

- **Reviewers:** the spec, plan, code, accessibility, and security reviewers and the voter. The recommended answer is
  your session's model, since these decide what gets fixed.
- **Helpers:** the PR writer and the friction triager, which summarize and sort. The fastest model is recommended.

The answers go in the task's `state.md`, and every later command uses them. Run any command that starts reviewers
or helpers with `--models` to choose again, or set the `reviewer_model` and `helper_model` plugin options to
`inherit` or a model name to skip the question. If a recorded model is retired, Quorum asks again.

## What it sets up in your repo

The plugin never hardcodes a test command; it reads them from these files.

```
your-repo/
├── CLAUDE.md                      # + "## Verification Commands" and a link to REVIEW.md
├── REVIEW.md                      # review rules, failure modes for your stack, paths to skip, learned rules
├── .claude/hooks/
│   └── verify-completion.sh       # your fast checks: typecheck, lint, unit tests
└── .tasks/                        # always gitignored
    └── <slug>/
        ├── rd.md                  # requirements, non-goals, risk tier, rollback plan
        ├── eval.md                # runnable pass/fail checks
        ├── plan.md                # files, reuse, tests, docs, a11y, security; approved before building
        ├── mockup.html            # UI tasks only
        └── state.md               # status, round, SHAs, pending findings, models, the PR once opened
```

## Reference

<details>
<summary><b>Agents</b>: what each of the 14 sees and does</summary>

| Agent | Sees | Job |
|---|---|---|
| `researcher` | the request, the repo, official docs online | Repo precedent and two or three approaches with sources; recommends one |
| `spec-reviewer` | `rd.md`, `eval.md`, research, the code | Feasibility Critic (does the spec match the code?) or Spec Improver (clear, testable, covered?) |
| `planner` | `rd.md`, `eval.md`, research, mockup, the code, plan-review findings | Writes `plan.md` (files, reuse, tests, docs, a11y, security) and revises it |
| `builder` | spec, plan, checks, `CLAUDE.md`, surviving findings | Builds from `plan.md` and fixes code; one commit per round; notes deviations from the plan |
| `prover` | `eval.md`, `CLAUDE.md` | Runs every check, fail-before-fix rows in a temporary worktree; reports PASS/FAIL with output |
| `code-reviewer` | its diff range or the plan, spec, `CLAUDE.md`, `REVIEW.md` | Logic & edge cases; architecture, security & drift; or test adequacy. Flags code that drifts from the plan |
| `pattern-auditor` | its diff range or the plan, `CLAUDE.md`, `REVIEW.md`, repo rules, the rest of the repo | Reinvented helpers, broken conventions and repo rules; every finding cites the precedent |
| `docs-auditor` | its diff range or the plan, the repo's docs, `CLAUDE.md`, `REVIEW.md` | Docs the change made wrong or left missing; lists linked docs outside the repo |
| `a11y-auditor` | the plan (plan mode), its diff range (diff mode), or the running app (live mode) | WCAG 2.2 A and AA, with a list of what needs a human |
| `verifier-voter` | candidate findings on the plan or the code, spec, `REVIEW.md` | Opens each cited `file:line`; keeps or drops it |
| `security-reviewer` | the plan or the branch diff, spec, `CLAUDE.md`, `REVIEW.md` | Exploitable vulnerabilities only; every finding blocks |
| `blind-user` | the user goal and the app's entry point | Uses the running app; blocked from reading source |
| `friction-triager` | blind report, spec, branch diff | Sorts friction into caused, related, data gap, or unrelated; drafts follow-ups |
| `pr-writer` | spec, state log, proof, diff, the repo's PR template | Drafts the PR description and lists commits that must not ship |

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
| `skills/` | `init-pipeline`, `spec-and-eval`, `plan`, `build`, `simplify-diff`, `review-loop`, `blind-test`, `pr-draft`, `codify-lesson`, `review`, `run`, and the model-invocable `pipeline-laws`. Each stage `run` chains keeps its instructions in `steps.md`, which its `SKILL.md` and `run` both follow |
| `agents/` | `researcher`, `spec-reviewer`, `planner`, `builder`, `prover`, `code-reviewer`, `pattern-auditor`, `docs-auditor`, `a11y-auditor`, `verifier-voter`, `security-reviewer`, `blind-user`, `friction-triager`, `pr-writer` |
| `hooks/` | `hooks.json` plus `session-laws.sh`, `block-source-read.sh`, `protect-checks.sh`, `secret-guard.sh` (both read commands with `shell-words.sh`), `stop-verify.sh`, `record-pr.sh`, and `dashboard/`, the dashboard's hooks module |
| `types/` | The type contract for the values the dashboard keeps in the session |
| `bin/` | `quorum-branch`, `quorum-detect-stack`, `quorum-findings`, `quorum-learned-rule`, `quorum-render-review`, `quorum-render-verify`, `quorum-active-task`, `quorum-state`, `quorum-reviews`, `quorum-lessons`, `quorum-secrets`, `quorum-git` (on the Bash PATH while the plugin is enabled) |
| `libexec/` | `git`, which `quorum-git` puts first on PATH when it runs a real git by full path, so git's own child processes (`git worktree add` starts some) reach it too |
| `tests/` | bats tests for every hook and helper, `claude plugin test` tests for the dashboard, fixture repos per stack, and `e2e/sales-app`, a small runnable app for live end-to-end runs |
| `evals/` | `claude plugin eval` suite: risk tiering, one case per agent, voter false-alarm drops, blind-mode source reads, a near-miss |
| `assets/` | The README's animations and diagrams, in light and dark versions; `assets/src/diagrams.py` draws the diagrams, and `assets/src/dashboard-demo.sh` builds a demo task for the dashboard |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`CHANGELOG.md`](CHANGELOG.md) · [`TODO.md`](TODO.md) · [`LICENSE`](LICENSE) | Development guide · release notes · planned features · MIT license |

</details>

## Contributing

Tests, evals, trying a local build, redrawing the diagrams, and releasing are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Known limits

- **Claude Code asks before writing `.claude/hooks/`**, so `init-pipeline` brings one approval prompt.
- **The check and secret guards read commands, they don't sandbox them.** They catch the plain forms an agent uses
  (`cat .env`, `sed -i` on a config, `--no-verify`), not a script written to hide what it does. They also don't
  cover a test script inside `package.json` or `pyproject.toml`, which hold dependencies too. `Grep` over a whole
  folder can still show lines from a `.env` in it.
- **The blind guard is a safeguard, not a sandbox.** It blocks reading source, but running a script that reads
  source gets through, because running code is how a user runs the app.
- **Agents add up.** A MEDIUM or HIGH round runs 4–6 reviewers, a voter, and a builder, for up to 3 rounds, after
  research, two spec reviewers, and up to 2 plan-review rounds. Each task asks which model its reviewers and its
  helpers use (see [Models](#models)); the researcher, planner, builder, prover, and blind user use your session's.
- **Accessibility checks are partial.** Automated scans find only part of WCAG 2.2; the a11y auditor lists the
  rest under "Needs a human". A clean report isn't a conformance claim.
- **`verify-completion.sh` should stay fast.** The Stop hook runs it on every finish; put slow suites in `eval.md`.

## License

[MIT](LICENSE).
