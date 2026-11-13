# Reference

[← Back to the README](../README.md)

## Commands

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
| `worktrees` | `false` | Build each task in its own git worktree (see [More than one task at a time](running-a-task.md#more-than-one-task-at-a-time)) |
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
| `hooks/` | `hooks.json` plus `session-laws.sh`, `block-source-read.sh`, `protect-checks.sh`, `map-guard.sh`, `secret-guard.sh` (all three read commands with `shell-words.sh`), `stop-verify.sh`, `record-pr.sh`, `map-session-end.sh`, and `dashboard/`, the dashboard's hooks module |
| `types/` | The type contract for the values the dashboard keeps in the session |
| `bin/` | `quorum-branch`, `quorum-detect-stack`, `quorum-findings`, `quorum-learned-rule`, `quorum-render-review`, `quorum-render-verify`, `quorum-active-task`, `quorum-state`, `quorum-reviews`, `quorum-lessons`, `quorum-secrets`, `quorum-validate`, `quorum-config`, `quorum-plan`, `quorum-map`, `quorum-session`, `quorum-research-check`, `quorum-git` (on the Bash PATH while the plugin is enabled) |
| `libexec/` | `git`, which `quorum-git` puts first on PATH when it runs a real git by full path, so git's own child processes (`git worktree add` starts some) reach it too |
| `guides/` | The guides the README links to: how it works, running a task, research and maps, reviewing, learning, the dashboard, guardrails, and this reference |
| `tests/` | bats tests for every hook and helper, `claude plugin test` tests for the dashboard, fixture repos per stack, and `e2e/sales-app`, a small runnable app for live end-to-end runs |
| `evals/` | `claude plugin eval` suite: risk tiering, one case per agent, the spec, plan, build, and run paths, research, maps, the retro, voter false-alarm drops, blind-mode source reads, and a near-miss (listed in [CONTRIBUTING.md](../CONTRIBUTING.md#evals)) |
| `assets/` | The animations and diagrams in the README and the guides, in light and dark versions; `assets/src/diagrams.py` draws the diagrams, and `assets/src/dashboard-demo.sh` builds a demo task for the dashboard |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) · [`CHANGELOG.md`](../CHANGELOG.md) · [`TODO.md`](../TODO.md) · [`LICENSE`](../LICENSE) | Development guide · release notes · planned features · MIT license |

</details>
