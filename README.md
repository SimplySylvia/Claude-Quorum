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

[Why](#why) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Commands](#commands) ·
[Guardrails](#guardrails) · [Guides](#guides)

</div>

## Why

When an agent writes most of the code, it goes wrong in predictable ways, and asking it to check its own work
doesn't help. Quorum answers each one with a mechanism:

- **It builds before the details are settled.** The spec and the plan are reviewed against the code first.
- **It grades its own homework.** Reviewers are separate subagents with a fresh context, each with its own angle.
- **It calls the work done too early.** A Stop hook won't let a task finish until the repo's checks pass.
- **Reviews never end.** At most 3 rounds, a cap on nits, and a voter that drops weak findings.
- **Lessons don't stick.** A repeated mistake becomes a check or a rule the next task follows.

No single check is perfect, so Quorum stacks several whose holes sit in different places, the
[Swiss cheese model](https://pmc.ncbi.nlm.nih.gov/articles/PMC1117770/). Each dot is a kind of defect, stopped by the
first layer with no hole in its path. The orange one gets through where the holes line up, which is why every task
still carries a rollback plan.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/swiss-cheese-dark.svg">
    <img src="assets/swiss-cheese-light.svg" alt="Animation: eight layers (spec review, plan review, checks and proof, reviewers, voter, security pass, blind test, human gate), each stopping a different kind of defect: a spec that can't meet its goal, a plan that rebuilds a helper or skips docs, a failing test, a regression test that can't fail, an unhandled edge case, a missing auth check, a dead-end screen, and right code with the wrong design. The voter filters a reviewer's false alarm, and one defect escapes where the holes line up, which is what the rollback plan is for." width="880">
  </picture>
</p>

## Quick start

You need [Claude Code](https://code.claude.com/docs) with plugin support, plus `bash`, `git`, and `jq`. This repo is
both the plugin and its marketplace:

```
/plugin marketplace add SimplySylvia/Claude-Quorum
/plugin install quorum@quorum
```

Then, in the repo you want to protect:

```
/quorum:init-pipeline                            # once: CLAUDE.md, REVIEW.md, verify-completion.sh, .tasks/
/quorum:run Add a CSV export to the sales report # spec → plan → build → review → blind test → PR draft
```

`/quorum:run` stops only where you must decide, and running it again continues where the task stopped. It never
pushes or opens the PR.

| You have | Run |
|---|---|
| A change to make | `/quorum:run <what to build>` |
| A small change no user can reach: copy, docs, a test | `/quorum:run --fast <what to build>` |
| A bug | `/quorum:run --bug <what's broken>`: reproduced first, done when proven fixed |
| A branch or pull request to review, with no setup | `/quorum:review` or `/quorum:review 123` |
| A question: is it worth doing, and which way? | `/quorum:research <question>` |
| An effort too big for one task | `/quorum:map <the problem>` |
| A finished task to learn from | `/quorum:retro` |

## How it works

A task moves through stages, and each stage catches what the others miss: the spec is reviewed, then the plan, then
the build is proven and reviewed in rounds, a blind user tries it, and you review the PR. Each band below is a
command, and the chips are the agents it starts. No agent sees the conversation that produced the code.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/agent-map-dark.svg">
    <img src="assets/agent-map-light.svg" alt="Agent map. Bootstrap writes CLAUDE.md's Verification Commands, REVIEW.md, and the check script. Spec and eval: researcher (MEDIUM/HIGH), then the spec, linted and every check tried once, then two spec reviewers in parallel; --bug reproduces the bug first, and --deep-research uses lensed researchers instead. Plan: the planner writes plan.md, the same reviewers as the review loop check it in plan mode, the voter drops false alarms, the planner revises up to twice, and you approve it. Build: builder, test first and with the checks locked, then prover; with --worktree, in the task's own git worktree, and for a plan of 4 or more steps, a builder per step. Review loop: up to six reviewers in parallel by tier and by what changed, then the verifier-voter; surviving IMPORTANT findings go to the builder and back into review, and after round 3 the task halts for a redesign. Security and blind test (MEDIUM/HIGH): security reviewer, blind user, live accessibility check, friction triager, prover; blockers go back to the review loop. Human gate: pr-writer, citing each requirement's verdict, then you review and merge. Apart from the stages, review any diff with /quorum:review: the review loop's reviewers by tier, plus security for HIGH, then the verifier-voter, one round, with no task needed; --fix hands the kept findings to the builder, and --comment posts them as a GitHub review after you approve. Research a question, also apart from the stages, with /quorum:research: researchers through four lenses (repo, docs, alternatives, counter) in parallel, then quorum-research-check, the source-verifier, and research.md with viability and candidate tasks, creating no task. Map a large effort, also apart from the stages, with /quorum:map: grilling rounds for the destination and then breadth-first, a researcher per research ticket (deep research for weighty ones), quorum-map check, and tasks.md once the map is cleared; then one ticket per run, with a facts-only researcher before a code question and the spec-reviewer's decision check before it's recorded, where only you answer grilling and prototype tickets; then the map-mode reviewers (architecture, patterns, security for HIGH) and the verifier-voter on the breakdown, and spec-and-eval --from-map for each task once its blockers merge. The band notes that it plans only: a hook blocks building. A last line notes that /quorum:run follows stages 1 to 8 in order by itself, stopping only where you decide." width="880">
  </picture>
</p>

How many layers a task gets depends on its **risk tier**, which you confirm: LOW for changes no user can reach,
MEDIUM for anything a user can see or run, HIGH for data, money, or security. See
[How Quorum works](guides/how-it-works.md) for the stages in motion, two worked examples, and the tiers.

## Commands

Every command is user-only: Claude never starts one on its own.

| Command | What it does |
|---|---|
| `/quorum:init-pipeline` | Bootstraps a repo for Quorum |
| `/quorum:run [<request>]` | Takes a task through every stage, or continues the active one |
| `/quorum:spec-and-eval`, `plan`, `build`, `simplify-diff`, `review-loop`, `blind-test`, `pr-draft` | Each stage on its own |
| `/quorum:review [<PR> \| <range>]` | Reviews any diff, with no task |
| `/quorum:research <question>` | Researches whether and how, creating no task |
| `/quorum:map <problem> \| <map>` | Charts a large effort as decisions, then hands it off as tasks |
| `/quorum:codify-lesson`, `/quorum:retro` | Turns mistakes into checks and rules |
| `/quorum-dashboard` | Shows or hides the dashboard pane |

Every option, agent, and setting is in the [Reference](guides/reference.md).

## Guardrails

- **Proof before done.** A task can't finish until its checks pass at the current commit.
- **The checks can't be weakened mid-task.** A hook blocks edits to the spec, the checks, and CI while a task builds.
- **Every requirement gets a verdict,** with the `file:line` that does the work.
- **Secrets stay out.** Reading credential files and committing what looks like a key are blocked.
- **Maps don't build.** A map session can only write its own plans.
- **Quiet outside a task.** Apart from the secret guard, the hooks do nothing unless a task is running.

The full list, and what the guards don't catch, is in [Guardrails and known limits](guides/guardrails.md).

## Guides

| Guide | What's in it |
|---|---|
| [How Quorum works](guides/how-it-works.md) | Two workflows start to finish, the stages, the review loop, risk tiers, where Quorum asks you, models, and what it sets up in your repo |
| [Running a task](guides/running-a-task.md) | `/quorum:run`, where it stops, `--fast`, `--bug`, each stage on its own, and worktrees for tasks side by side |
| [Research and maps](guides/research-and-maps.md) | `/quorum:research`, and `/quorum:map` for efforts too big for one task |
| [Reviewing any diff](guides/reviewing-a-diff.md) | `/quorum:review` on a branch, a range, or a pull request |
| [Learning from mistakes](guides/learning-from-mistakes.md) | `/quorum:codify-lesson` and `/quorum:retro` |
| [The dashboard](guides/dashboard.md) | The band and the pane that show where a task is |
| [Guardrails and known limits](guides/guardrails.md) | Every guard, and its limits |
| [Reference](guides/reference.md) | Commands and options, agents, configuration, and the repo layout |

## Contributing

Tests, evals, a local build, the diagrams, and releasing are in [CONTRIBUTING.md](CONTRIBUTING.md).
[CHANGELOG.md](CHANGELOG.md) has the release notes and [TODO.md](TODO.md) the plans.

## License

[MIT](LICENSE).
