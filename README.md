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
  one-line rule in the repo's `REVIEW.md`, which every future review reads.

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

Every command is user-only: Claude never starts a review loop on its own.

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
    <img src="assets/agent-map-light.svg" alt="Agent map. Bootstrap writes CLAUDE.md's Verification Commands, REVIEW.md, and the check script. Spec and eval: researcher (MEDIUM/HIGH), then the spec, then two spec reviewers in parallel. Plan: the planner writes plan.md, the same reviewers as the review loop check it in plan mode, the voter drops false alarms, the planner revises up to twice, and you approve it. Build: builder, following the plan, then prover. Review loop: up to six reviewers in parallel by tier and by what changed, then the verifier-voter; surviving IMPORTANT findings go to the builder and back into review, and after round 3 the task halts for a redesign. Security and blind test (MEDIUM/HIGH): security reviewer, blind user, live accessibility check, friction triager, prover; blockers go back to the review loop. Human gate: pr-writer, then you review and merge." width="880">
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

## The dashboard

While a task is active, Quorum shows where it is without you asking:

- **Status line:** `Quorum · export-csv · IN_REVIEW · MEDIUM · round 2/3 · 1 pending`.
- **Above the prompt:** the stage rail, `✓ Spec › ✓ Plan › ✓ Build › ● Review r2/3 › ○ Blind test › ○ PR`, how many
  of the round's reviewers have replied and how many checks pass (`reviewers 3/4 · checks 6/7`), the next command,
  and a **Dashboard** button.
- **A dashboard pane**, which opens by itself when a session starts on a task and when a `/quorum:*` command runs;
  `/quorum-dashboard` shows or hides it:
  - **The task:** its title and goal from `rd.md`, so it's clear what the work is for.
  - **Now:** what the current stage is doing. In spec, plan, and code review, each reviewer the round runs for the
    task's tier, as waiting, running (with its time), or done with its findings, then the voter's result and what it
    means for the round. In the build, the builder and the prover. In the blind test, whether the blind user reached
    the goal, its blockers and friction, and the accessibility, security, and triage reports.
  - **Requirements:** each numbered requirement in `rd.md`, met when every `eval.md` row for it passes in the
    latest proof, failing when one fails, and flagged when no row checks it; then what's out of scope (the
    non-goals).
  - **Checks:** every `eval.md` row and the fast checks, each passing, failing, or not run in the latest proof
    (`proof-final.md`, else `proof-build.md`), with the commit it ran at; Stop-hook blocks; pending findings.
  - **Stages**, each with its outcome; each **review round**'s findings and how many the voter kept; and any other
    Quorum agents running or finished.
- **Toasts** when a task converges, halts, escalates, or is ready for you.

The pane sits beside the chat in a wide fullscreen terminal and above the prompt otherwise. Opened by itself, it
waits for a terminal at least 144 columns wide; opened with the button or `/quorum-dashboard`, it shows at any
width. The dashboard only reads `.tasks/`, so `claude -p`, cloud sessions, and the VS Code chat panel work as before,
without it.

## Risk tiers

`/quorum:spec-and-eval` asks "what happens to the user or system if this breaks?" and picks a tier, which you
confirm. The tier decides how many layers the task gets:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/risk-tiers-dark.svg">
    <img src="assets/risk-tiers-light.svg" alt="Risk tiers. LOW, for changes a user can't reach: research only with --research, two spec reviewers, one plan reviewer and one code reviewer plus one for each of tests, UI, or docs it touches, no security pass, no blind test, no human review if green. MEDIUM, for anything a user can see or run: research, two spec reviewers, four to six plan reviewers and four to six code reviewers with the voter, a security pass only with security_on_medium, a blind test with live accessibility checks and friction triage, and a focused human review. HIGH, for data, money, or security: everything MEDIUM gets, the security reviewer on the plan, a blocking security pass, and an architectural sign-off." width="880">
  </picture>
</p>

## Guardrails

- **Proof before done.** The Stop hook blocks finishing during a task until the repo's fast checks pass; after 3
  failures in a row it lets you go and marks the task `ESCALATED`.
- **Quiet outside a task.** The hooks do nothing unless a task is building, in review, or escalated, or a blind
  test is running.
- **Hard caps.** At most 3 review rounds, then `HALTED` with a post-mortem and two redesign options.
- **Asks before writing** to `CLAUDE.md`, `REVIEW.md`, or your global `~/.claude/CLAUDE.md`, with a diff first.
- **Local data only.** Blind tests and `eval.md` checks use local, temporary, or synthetic data, never production.

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
        └── state.md               # status, round, SHAs, pending findings
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
| `blind_block_dirs` | `src,app,lib,packages,Source,Content` | Folders the blind user can't read |
| `blind_block_exts` | `ts,tsx,js,jsx,py,rs,go,cpp,h,java,kt,rb` | File types the blind user can't read |

</details>

<details>
<summary><b>Repository layout</b>: where the plugin's parts live</summary>

| Path | What |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest, including the `userConfig` options |
| `.claude-plugin/marketplace.json` | Marketplace manifest (lists this repo as its only plugin) |
| `skills/` | `init-pipeline`, `spec-and-eval`, `plan`, `build`, `simplify-diff`, `review-loop`, `blind-test`, `pr-draft`, `codify-lesson`, and the model-invocable `pipeline-laws` |
| `agents/` | `researcher`, `spec-reviewer`, `planner`, `builder`, `prover`, `code-reviewer`, `pattern-auditor`, `docs-auditor`, `a11y-auditor`, `verifier-voter`, `security-reviewer`, `blind-user`, `friction-triager`, `pr-writer` |
| `hooks/` | `hooks.json` plus `session-laws.sh`, `block-source-read.sh`, `stop-verify.sh`, and `dashboard/`, the dashboard's hooks module |
| `types/` | The type contract for the values the dashboard keeps in the session |
| `bin/` | `quorum-branch`, `quorum-detect-stack`, `quorum-findings`, `quorum-learned-rule`, `quorum-render-review`, `quorum-render-verify`, `quorum-active-task`, `quorum-state` (on the Bash PATH while the plugin is enabled) |
| `tests/` | bats tests for every hook and helper, `claude plugin test` tests for the dashboard, fixture repos per stack, and `e2e/sales-app`, a small runnable app for live end-to-end runs |
| `evals/` | `claude plugin eval` suite: risk tiering, one case per agent, voter false-alarm drops, blind-mode source reads, a near-miss |
| `assets/` | The README's animations and diagrams, in light and dark versions; `assets/src/diagrams.py` draws the diagrams |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`CHANGELOG.md`](CHANGELOG.md) · [`LICENSE`](LICENSE) | Development guide · release notes · MIT license |

</details>

## Contributing

Tests, evals, trying a local build, redrawing the diagrams, and releasing are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Known limits

- **Claude Code asks before writing `.claude/hooks/`**, so `init-pipeline` brings one approval prompt.
- **The blind guard is a safeguard, not a sandbox.** It blocks reading source, but running a script that reads
  source gets through, because running code is how a user runs the app.
- **Agents use your session's model, and it adds up.** A MEDIUM or HIGH round runs 4–6 reviewers, a voter, and a
  builder, for up to 3 rounds, after research, two spec reviewers, and up to 2 plan-review rounds.
- **Accessibility checks are partial.** Automated scans find only part of WCAG 2.2; the a11y auditor lists the
  rest under "Needs a human". A clean report isn't a conformance claim.
- **`verify-completion.sh` should stay fast.** The Stop hook runs it on every finish; put slow suites in `eval.md`.

## License

[MIT](LICENSE).
