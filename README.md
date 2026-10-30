<div align="center">

<img src=".claude-plugin/icon.png" alt="Quorum icon" width="96">

# Quorum

**A multi-agent verification pipeline for Claude Code: fresh-context reviewers, a verifier vote, a blind user
test, and hooks that won't let "done" mean anything less than passing checks.**

<p>
  <a href="https://code.claude.com/docs/en/plugins-reference"><img src="https://img.shields.io/badge/Claude_Code-plugin-D97757?logo=claude&logoColor=white" alt="Claude Code plugin"></a>
  <a href=".claude-plugin/plugin.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FSimplySylvia%2FClaude-Quorum%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=6b4fd8" alt="Version"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/hooks-bash-4EAA25?logo=gnubash&logoColor=white" alt="Hooks: bash"></a>
  <a href="https://github.com/SimplySylvia/Claude-Quorum/actions/workflows/ci.yml"><img src="https://github.com/SimplySylvia/Claude-Quorum/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="#development"><img src="https://img.shields.io/badge/evals-claude_plugin_eval-6E56CF" alt="Evals"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
</p>

[Quick start](#quick-start) · [How it works](#how-it-works) · [What it sets up](#what-it-sets-up-in-your-repo) ·
[Configuration](#configuration) · [Development](#development) · [Known limits](#known-limits)

</div>

## Why

When an agent writes most of the code, asking it to review its own work fails in three predictable ways. Quorum
has one mechanism for each:

- **It grades its own homework.** The agent that wrote the code shares every assumption behind it. Quorum's
  reviewers are separate subagents with a fresh context: they see the diff and the spec, never the builder's
  reasoning.
- **Reviews never end.** Builder and reviewer argue for dozens of rounds over the same nits. Quorum caps the loop
  at 3 rounds, reviews only new lines after round 1, limits nits to 2, and runs a voter that drops weak findings.
- **Lessons don't stick.** A bug fixed today comes back next week. `/quorum:codify-lesson` turns it into a
  one-line rule in the repo's `REVIEW.md`, which every future review reads.

The idea underneath is the [Swiss cheese model](https://pmc.ncbi.nlm.nih.gov/articles/PMC1117770/): no single check
is perfect, so stack several different ones whose holes sit in different places.

## Quick start

This repo is both the plugin and a single-plugin marketplace. In Claude Code:

```
/plugin marketplace add SimplySylvia/Claude-Quorum
/plugin install quorum@quorum
```

Then, in the repo you want to protect:

```
/quorum:init-pipeline          # once per repo: CLAUDE.md, REVIEW.md, verify-completion.sh, .tasks/
/quorum:spec-and-eval          # per task: risk tier, rd.md, eval.md (and a mockup for UI work)
/quorum:build                  # first build on feat/<slug>; records mockup sign-off
/quorum:simplify-diff          # strip debug code and needless abstractions, re-run checks
/quorum:review-loop            # fresh reviewers → voter → builder, up to 3 rounds
/quorum:blind-test             # MEDIUM/HIGH: security pass, then a user test with no source access
/quorum:codify-lesson          # optional: save a repeated bug or false alarm as a rule
```

Every command is user-only: Claude never starts a review loop on its own.

## How it works

A task moves through stages 0 to 7. Each layer catches defects the others miss, and the risk tier decides how
many layers a task gets.

| Stage | Command | What happens |
|---|---|---|
| 0 · Bootstrap | `init-pipeline` | Detects the stack, writes the repo's verification commands and review rules, dry-runs the check script |
| 1 · Spec & eval | `spec-and-eval` | Asks "what happens to the user or system if this breaks?", picks LOW, MEDIUM, or HIGH, writes the spec and runnable checks |
| 2 · Build | `build`, `simplify-diff` | Builder works on a feature branch; the Stop hook blocks "done" until checks pass |
| 3–4 · Review loop | `review-loop` | Fresh reviewers in parallel, a verifier-voter, and a builder that fixes each bug class everywhere it appears |
| 5 · Security & blind test | `blind-test` | Security-only review (HIGH), then an agent uses the running app like a first-time user |
| 6 · Codify | `codify-lesson` | One-line learned rules in `REVIEW.md` |
| 7 · Human gate | (summary) | Proof, risk tier, and a one-step rollback plan. LOW is ready to merge; MEDIUM and HIGH wait for you |

| Tier | Typical changes | Reviewers | Security pass | Blind test | Human review |
|---|---|---|---|---|---|
| **LOW** | Copy, docs, isolated tests, code behind an off flag | 1 | — | — | Not needed if green |
| **MEDIUM** | User-facing workflows, API endpoints, state logic | 2 | Optional | Yes | Focused |
| **HIGH** | Auth, money, destructive migrations, security boundaries | 2 | Yes, blocking | Yes | Required sign-off |

### Agents

| Agent | Sees | Job |
|---|---|---|
| `builder` | spec, checks, `CLAUDE.md`, surviving findings | Writes and fixes code; one commit per round |
| `code-reviewer` | its diff range, spec, `CLAUDE.md`, `REVIEW.md` | Logic & edge cases, or architecture, security & drift |
| `verifier-voter` | candidate findings, spec, `REVIEW.md` | Opens each cited `file:line`; keeps or drops it |
| `security-reviewer` | branch diff, spec, `CLAUDE.md`, `REVIEW.md` | Exploitable vulnerabilities only; every finding blocks |
| `blind-user` | the user goal and the app's entry point | Uses the running app; blocked from reading source |

No agent sees the conversation that produced the code.

## Guardrails

- **Proof before done.** The Stop hook runs the repo's fast checks whenever Claude or the builder tries to finish
  during a task, and blocks until they pass. After 3 failures in a row it lets you go and marks the task
  `ESCALATED`, so a broken environment can't trap a session.
- **Quiet outside a task.** Hooks exit immediately in repos that aren't bootstrapped, and the Stop hook only runs
  while a task is building or in review.
- **Hard caps.** At most 3 review rounds; a task still failing ends `HALTED` with a post-mortem and 2 redesign
  options instead of another round.
- **The blind guard is best effort, not a sandbox.** The blind user has no file tools, and a hook blocks shell
  reads of source paths, but a determined command could get through.
- **Asks before writing** to `CLAUDE.md`, `REVIEW.md`, or your global `~/.claude/CLAUDE.md`, and shows a diff first.
- **Local data only.** Blind tests and `eval.md` use local, temporary, or synthetic data, never production.

## What it sets up in your repo

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
        ├── mockup.html            # UI tasks only
        └── state.md               # status, round, SHAs, pending findings
```

The plugin never hardcodes a test command; it reads them from your repo.

## Configuration

Set through Claude Code's plugin options. Defaults are declared in `.claude-plugin/plugin.json`.

| Option | Default | What it does |
|---|---|---|
| `max_rounds` | `3` | Hard cap on review-loop rounds |
| `nit_cap` | `2` | Most `[NIT]` findings per review pass |
| `stop_hook_enabled` | `true` | Turn the Stop-hook check off for a while |
| `verify_timeout_s` | `300` | Timeout for `verify-completion.sh` |
| `security_on_medium` | `false` | Also run the security pass for MEDIUM tasks |
| `blind_block_dirs` | `src,app,lib,packages,Source,Content` | Folders the blind user can't read |
| `blind_block_exts` | `ts,tsx,js,jsx,py,rs,go,cpp,h,java,kt,rb` | File types the blind user can't read |

A repo can override the block lists in `.claude/quorum.json`, which helps in monorepos.

## Requirements

- [Claude Code](https://code.claude.com/docs) with plugin support
- `bash`, `git`, and `jq` (hooks and `bin/` helpers)
- For development: [`bats-core`](https://github.com/bats-core/bats-core) and `shellcheck`

## Repository layout

| Path | What |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest, including the `userConfig` options |
| `.claude-plugin/marketplace.json` | Marketplace manifest (lists this repo as its only plugin) |
| `skills/` | `init-pipeline`, `spec-and-eval`, `build`, `simplify-diff`, `review-loop`, `blind-test`, `codify-lesson`, and the model-invocable `pipeline-laws` |
| `agents/` | `builder`, `code-reviewer`, `verifier-voter`, `security-reviewer`, `blind-user` |
| `hooks/` | `hooks.json` plus `session-laws.sh`, `block-source-read.sh`, `stop-verify.sh` |
| `bin/` | `quorum-branch`, `quorum-detect-stack`, `quorum-findings`, `quorum-learned-rule`, `quorum-render-review`, `quorum-render-verify`, `quorum-active-task`, `quorum-state` (on the Bash PATH while the plugin is enabled) |
| `tests/` | bats tests for every hook and helper, fixture repos per stack, and `e2e/sales-app`, a small runnable app for live end-to-end runs |
| `evals/` | `claude plugin eval` suite: risk tiering, finding format, nit cap, blind-mode source reads |
| [`CHANGELOG.md`](CHANGELOG.md) · [`LICENSE`](LICENSE) | Release notes · MIT license |

## Development

### Tests

Hooks read JSON on stdin, so tests feed fixture hook input and check the exit code:

```bash
bats -r tests/                                # every hook and bin/ helper
shellcheck hooks/*.sh bin/*                   # lint the shell
claude plugin validate --strict .             # manifest, paths, marketplace; warnings fail
```

CI runs all three on every push and pull request, on Linux and on macOS (system bash 3.2).

### Evals

The suite in `evals/` runs against the `tests/e2e/sales-app` fixture, which `evals/_fixture/make.sh` copies into
each run's workspace and bootstraps for Quorum.

| Case | Checks |
|---|---|
| `risk-tier-low`, `-medium`, `-high` | `spec-and-eval` picks the right tier and writes runnable checks |
| `reviewer-finds-bug` | `code-reviewer` finds a planted requirement violation, with `file:line` and a Pattern Category |
| `voter-drops-false-alarm` | `verifier-voter` keeps the real bug and drops a factually wrong finding |
| `blind-user-no-source` | `blind-user` reaches its goal through the CLI without ever hitting the source guard |
| `nearmiss-no-auto-review-loop` | An ordinary "look at my commit" request never starts a Quorum command |

```bash
# Real model calls; Bash runs inside Claude Code's sandbox. --ablation none skips the no-plugin baseline.
claude plugin eval . --scaffold --trust-plugin --ablation none --model sonnet -j 4 --allow-tools Bash Write Edit
```

Run them after any change to a skill's instructions or an agent's prompt.

### Trying a local build

```bash
claude plugin marketplace add ./
claude plugin install quorum@quorum
```

### Releasing

Bump `version` in `.claude-plugin/plugin.json` when you change a skill, agent, or hook, and move the `Unreleased`
notes in [`CHANGELOG.md`](CHANGELOG.md) under the new version. Users pick it up with `/plugin marketplace update`.

## Known limits

- **Claude Code asks before writing `.claude/hooks/`.** `init-pipeline` writes the check script there, and
  Claude Code treats `.claude/` as protected, so expect one approval prompt.
- **The blind guard is a safeguard, not a sandbox.** It blocks reading commands on source paths, but running a
  script that reads source (`python3 peek.py`) gets through, because running code is how a user runs the app.
- **Every agent uses your session's model.** Two reviewers, a voter, and a builder for up to 3 rounds adds up on
  MEDIUM and HIGH tasks; LOW tasks run one reviewer.
- **`verify-completion.sh` should stay fast.** The Stop hook runs it whenever Claude or the builder finishes
  during a task. Put slow suites in a task's `eval.md`.

## License

[MIT](LICENSE).
