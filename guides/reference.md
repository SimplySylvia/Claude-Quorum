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
| `/quorum:blind-test` | Stage 6, MEDIUM/HIGH: the security pass, the blind user, live accessibility checks. It also runs before review round 1, as the early blind test: the blind user and the friction triage only. After a clean early run, with nothing but test files changed since and no UI change, the later blind user is skipped | `--models` |
| `/quorum:pr-draft` | Stage 8: the PR description from the spec and the proof | `--models` |
| `/quorum:review [<PR> \| <range>]` | Reviews any diff, with no task | `--comment`, `--fix`, `--tier LOW\|MEDIUM\|HIGH`, `--yes`, `--models` |
| `/quorum:research <question>` | Researches whether and how, creating no task | `--effort quick\|standard\|deep`, `--yes` |
| `/quorum:map <problem> \| <map> [<ticket>]` | Charts an effort as decisions, works one ticket, or hands off its tasks | `--revise "<what changed>"`, `--yes` |
| `/quorum:codify-lesson [<what went wrong>]` | Turns one lesson into a check or a rule | `--audit [--days N]` |
| `/quorum:retro [<task> \| <map>]` | Finds what the next build should do differently | `--session [<id>]`, `--since YYYY-MM-DD` |
| `/quorum-dashboard` | Shows or hides the dashboard pane | |

<details>
<summary><b>Agents</b>: what each of the 15 sees and does</summary>

| Agent | Sees | Job |
|---|---|---|
| `researcher` | the request, the repo, official docs online | Repo precedent and two or three approaches with sources; recommends one. In deep research, one sub-question through one lens, with every claim's evidence in its findings file (it can write only there). For a map's decision, only the facts it rests on, with no recommendation |
| `source-verifier` | the claims a script couldn't settle, and the pinned versions | Reopens each cited page: supported, unsupported (dropped), wrong version, or unreachable |
| `spec-reviewer` | `rd.md`, `eval.md`, research, a map's decisions, the code | Feasibility Critic (does the spec match the code?) or Spec Improver (clear, testable, covered?). In decision mode, checks a map's decision against the code and the map |
| `planner` | `rd.md`, `eval.md`, research, a map's decisions, mockup, the code, plan-review findings | Writes `plan.md` (files, reuse, tests, docs, a11y, security; expand–contract for wide refactors) and revises it |
| `builder` | spec, plan, checks, `CLAUDE.md`, surviving findings | Builds from `plan.md` and fixes code; one commit per round; notes deviations from the plan |
| `prover` | `eval.md`, `CLAUDE.md` | Runs the eval.md checks its prompt names (the build proof leaves out `Final proof only.` rows; the final proof runs all), fail-before-fix rows in a temporary worktree; reports PASS/FAIL with output |
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
| `file_icons` | `off` | Icons in the dashboard's file tree: `off` or `nerd`; `nerd` needs a Nerd Font in the terminal |
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
| `agents/` | `researcher`, `spec-reviewer`, `planner`, `builder`, `prover`, `code-reviewer`, `pattern-auditor`, `docs-auditor`, `a11y-auditor`, `verifier-voter`, `security-reviewer`, `blind-user`, `friction-triager`, `pr-writer`, `source-verifier` |
| `hooks/` | `hooks.json` plus `session-laws.sh`, `block-source-read.sh`, `protect-checks.sh`, `map-guard.sh`, `run-guard.sh`, `secret-guard.sh` (all three read commands with `shell-words.sh`), `stop-verify.sh`, `save-report.sh` (when an agent stops, it writes the agent's report to the file the last `Report file:` line of its prompt names, under `.tasks/`), `record-pr.sh`, `session-end.sh`, `task-context.sh` (the guards and `stop-verify.sh` source it to resolve the task once per run), and `dashboard/`, the dashboard's hooks module |
| `types/` | The type contract for the values the dashboard keeps in the session |
| `bin/` | `quorum-branch`, `quorum-detect-stack`, `quorum-findings`, `quorum-learned-rule`, `quorum-render-review`, `quorum-render-verify`, `quorum-active-task`, `quorum-state`, `quorum-reviews`, `quorum-lessons`, `quorum-secrets`, `quorum-validate`, `quorum-config`, `quorum-plan`, `quorum-map`, `quorum-run`, `quorum-session`, `quorum-research-check`, `quorum-files`, `quorum-git` (on the Bash PATH while the plugin is enabled) |
| `libexec/` | `git`, which `quorum-git` puts first on PATH when it runs a real git by full path, so git's own child processes (`git worktree add` starts some) reach it too; `git-probe.sh`, which the helpers and hooks source to find a working git once and export the answer |
| `guides/` | The guides the README links to: how it works, running a task, research and maps, reviewing, learning, the dashboard, guardrails, and this reference |
| `tests/` | bats tests for every hook and helper, `claude plugin test` tests for the dashboard, fixture repos per stack, and `e2e/sales-app`, a small runnable app for live end-to-end runs |
| `evals/` | `claude plugin eval` suite: risk tiering, one case per agent, the spec, plan, build, and run paths, research, maps, the retro, voter false-alarm drops, blind-mode source reads, and a near-miss (listed in [CONTRIBUTING.md](../CONTRIBUTING.md#evals)) |
| `assets/` | The animations and diagrams in the README and the guides, in light and dark versions; `assets/src/diagrams.py` draws the diagrams, `assets/src/dashboard-demo.sh` builds a demo task for the dashboard, `assets/src/run-bats.sh` runs bats in parallel when it can, and `assets/src/bench-hooks.sh` counts the hooks' git processes |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) · [`CHANGELOG.md`](../CHANGELOG.md) · [`TODO.md`](../TODO.md) · [`LICENSE`](../LICENSE) | Development guide · release notes · planned features · MIT license |

`quorum-files record` writes the task's changed files to `.tasks/<slug>/files.tsv`, the list the dashboard's file
tree reads. Each row holds a file's git letter, the lines it adds and removes against the merge-base with the
default branch, the plan steps whose line names it (a file a step names but the change doesn't touch yet gets a
planned row), and whether it changed since the last review round. Before the build starts, the list holds only the
planned rows. The plan records it at the start of each review round, the build after each builder and each built
step, the review loop at each round's start and after each fix, and the blind test before the blind user and before
the final proof. A failed record prints one line and never stops the stage.

</details>

<details>
<summary><b>Speed: what the helpers share</b>: how the hooks and helpers avoid repeating work</summary>

- **One git probe per process tree.** `quorum-git`, the `bin/` helpers and the hooks source `libexec/git-probe.sh`,
  which finds a working git once (the one on PATH, else a candidate from `QUORUM_GIT_CANDIDATES`) and exports it as
  `QUORUM_GIT_USE`, with `QUORUM_GIT_PROBE` holding the key it was found under: `PATH` and the candidates. A child
  reuses the answer only when the key matches its own `PATH` and candidates and the value is `git` or an executable
  absolute path; anything else, such as a stale export from another shell, means a fresh probe.
- **One task lookup per hook.** `quorum-active-task --all` prints the slug, root, code and main trees on four lines,
  with an empty first line when there's no active task, from one `rev-parse` per directory. It exits 1 with no
  output when a path holds a newline, and `hooks/task-context.sh` then asks the four single modes instead.
  `quorum-state --root DIR`, given right after `--task SLUG`, takes DIR as the root that holds `.tasks/` instead of
  resolving it again.
- **The stop check skips an unchanged tree.** After a pass, `stop-verify.sh` writes a key for the tree to
  `.tasks/<task>/verify-pass`, and a later stop with the same key exits at once without running the checks. Any
  failure deletes the stamp. What the key covers, and what turns the skip off, is in
  [Guardrails](guardrails.md#known-limits).
- **`Final proof only.` rows.** An `eval.md` row whose Passes when starts with `Final proof only.` is left out of the
  build proof and reported `SKIPPED` with Evidence `final proof only`; the final proof runs it, and
  `quorum-validate proof` fails a `proof-final.md` that doesn't report it `PASS`. Use it for a full suite that takes
  minutes.
- **Parallel bats.** `assets/src/run-bats.sh -r tests/` runs `bats --jobs N`, N the CPU count, when GNU parallel is
  installed, and plain `bats` with the same arguments otherwise.
- **The benchmark.** `assets/src/bench-hooks.sh` counts the git processes and the median time of each PreToolUse
  hook for one Bash call, on a temporary repo with a building task. `--plugin DIR` measures another checkout, such
  as a worktree of an older commit.

**Upgrading from 0.11.** Nothing in an existing repo has to change: its `eval.md`, `verify-completion.sh` and tasks
keep working, and the stop skip and the shared probe need no setup. To opt in to the rest, mark slow `eval.md` rows
`Final proof only.` and run bats with `assets/src/run-bats.sh`.

</details>
