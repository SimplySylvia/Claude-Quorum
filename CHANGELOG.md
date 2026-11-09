# Changelog

All notable changes to this plugin. Versions match `version` in `.claude-plugin/plugin.json`; update an installed
copy with `/plugin marketplace update`.

## 0.4.0 (2026-11-09)

### Added

- **A dashboard for the active task**, drawn in the Claude Code screen by a hooks module (`hooks/dashboard/`). It
  only reads `.tasks/`, and `claude -p`, cloud sessions, and the VS Code chat panel work as before without it.
  - A status line (`Quorum · csv-export · IN_REVIEW · MEDIUM · round 2/3`) and a stage rail above the prompt with
    `reviewers 3/4 · checks 6/7`, the next command, and a **Dashboard** button.
  - A pane that opens by itself when a session starts on a task or a `/quorum:*` command runs; `/quorum-dashboard`
    shows or hides it. It shows the task's title and goal from `rd.md`; **Now**, what the current stage is doing
    (each spec, plan, or code reviewer of the round as waiting, running with its time, or done with its findings,
    then the voter's result; the builder and prover; the blind test's reports); each requirement with whether its
    `eval.md` checks pass, and the non-goals; **Checks**, every `eval.md` row against the latest proof; the stages,
    the review rounds, and other Quorum agents.
  - Toasts when a task converges, halts, escalates, or is ready for you.
  - Once a task is `READY` or `AWAITING-HUMAN`, its PR from GitHub (`gh`), open, merged, or closed, with its link.
  - Honest gaps: a proof older than HEAD is flagged as possibly out of date; a missing proof is named; and when only
    the round log says the checks passed, they show a muted "reported passing" mark rather than a proven one.
- `assets/src/dashboard-demo.sh` builds a demo repo with one task at code review, blind test, or `AWAITING-HUMAN`,
  for seeing the dashboard without a real task. The README's dashboard screenshots come from it.
- CI runs the dashboard's tests (`claude plugin test .`).

### Changed

- `quorum-state` refuses `READY` and `AWAITING-HUMAN` unless `.tasks/<slug>/proof-final.md` exists, names the
  commit at HEAD, and has no failed check (`Result: ALL PASS` or only skipped checks). A task could reach the end
  with its checks summarized in the round log and no saved proof, which `/quorum:pr-draft` then needs. Tasks already
  at `READY` or `AWAITING-HUMAN` keep their status; one still in progress needs the prover's `proof-final.md`, at
  its final commit, before it finishes.
- `state.md` has a `pr` field: the task's pull request URL. A new PostToolUse hook, `record-pr.sh`, sets it when
  `gh pr create` runs in the session and prints the URL; `/quorum:pr-draft` records a PR the branch already has,
  and tells you how to record one opened another way.

## 0.3.0 (2026-11-09)

### Added

- A planning stage, `/quorum:plan`, between the spec and the build. The new `planner` agent writes `plan.md` from the
  spec: the files to change, the existing code to reuse, the tests and why each fails without the change, the docs,
  and for UI work the accessibility approach and for risky work the security checks. The review loop's reviewers
  (logic, architecture, patterns, docs, tests, a11y, and for HIGH the security reviewer) check the plan in plan
  mode, the voter drops false alarms, and the planner revises, for up to 2 rounds. You approve the plan before
  `/quorum:build` runs.
- The builder follows `plan.md` and notes any deviation under its `## Deviations`. In the review loop, code that
  skips or changes a planned step without a deviation note is an `[IMPORTANT]` "Plan drift" finding.
- `quorum-state`: a `PLANNING` status and `plan_rounds` and `plan_approved` fields.
- Eval cases for the planner, the pattern auditor in plan mode, and plan drift in code review; `make.sh --money`
  adds a helper to the fixture app for them.

### Changed

- `/quorum:spec-and-eval` ends in `PLANNING`, and mockup sign-off moved from `/quorum:build` to `/quorum:plan`.
  `/quorum:build` needs an approved plan.
- Stages are renumbered for the new stage 2: build is 3, the review loop 4–5, security and blind test 6, codify 7,
  and the human gate 8. The README's diagrams and animations show the plan stage.
- README tagline, the Why section, and the plugin and marketplace descriptions now describe the whole pipeline,
  from reviewed specs and plans to proof, not only the review loop.
- The tier tables in `spec-and-eval` and `pipeline-laws` gave MEDIUM and HIGH 2 reviewers; they now say 4–6
  (4–7 with security), with plan review.

### Fixed

- `evals/run.sh` ran the evals with the `bin/` helpers of an installed copy of Quorum when the calling session had
  one on PATH, so helper changes went untested. It now puts the working tree's `bin/` first.
- Plan-mode reviewers must cite `plan.md` by line, as `quorum-findings check` requires.

## 0.2.0 (2026-11-09)

### Added

- `researcher` agent: before the spec, finds repo precedent and compares two or three approaches using the
  official docs for the versions the repo pins, with sources. Runs for MEDIUM and HIGH tasks in
  `/quorum:spec-and-eval` (`--research` for LOW, `--no-research` to skip).
- `spec-reviewer` agent, with Feasibility Critic and Spec Improver personas, reviews `rd.md` and `eval.md` against
  the code before any build. `[IMPORTANT]` spec findings are fixed before `/quorum:build`.
- `prover` agent: runs `verify-completion.sh` and every `eval.md` row (fail-before-fix rows in a temporary
  worktree) and reports each with its output. `/quorum:build` and both Stage 7 summaries use it, saving
  `proof-build.md` and `proof-final.md`.
- `pattern-auditor` agent: a review-loop reviewer for MEDIUM and HIGH tasks that flags reinvented helpers, broken
  conventions, and broken repo rules, citing the precedent each one breaks.
- `docs-auditor` agent: a review-loop reviewer for MEDIUM and HIGH tasks (and any task that changes docs) that
  finds internal docs the change made wrong or left missing, and lists linked docs outside the repo for a human.
  The Spec Improver also checks that the spec names docs to update.
- `/quorum:spec-and-eval` asks, for a new feature, whether the task should create or update docs, offering the
  places the repo documents similar features. Chosen docs become `**Docs:**` requirements with eval rows; a no
  becomes a non-goal the docs auditor respects.
- `a11y-auditor` agent: WCAG 2.2 A and AA. Diff mode runs in the review loop when UI files change; live mode runs
  in `/quorum:blind-test` with axe and a keyboard pass. Lists what needs a human.
- Test Adequacy Hunter persona for `code-reviewer`, used when the diff changes tests.
- `friction-triager` agent: sorts blind-test friction into caused, related, data gap, and unrelated. Caused items
  block like blind-test blockers; the others come with follow-up drafts.
- `/quorum:pr-draft` and the `pr-writer` agent: a PR description from the spec, state log, and proof, plus the
  commits that must not ship.

- README: an agent map, a review-loop diagram, and risk-tier cards, as light and dark SVGs drawn by
  `assets/src/diagrams.py`, in place of the stage and tier tables and the review-loop animation (which showed only
  two reviewers).
- README: the Swiss cheese animation is now an animated SVG in the same style, at 19 KB instead of about 960 KB. It
  shows seven layers, including spec review and checks and proof, moves smoothly, and holds still for viewers who
  ask for reduced motion.
- README: the stages animation is also an animated SVG now, following one task through every stage, including the
  two times a stage sends work back. With that, every README visual comes from `assets/src/diagrams.py`. The tier cards correct the reviewer counts (MEDIUM and HIGH get 4 to 6, not 2).
- README reorganized: reference tables (agents, configuration, repository layout) are collapsible, guardrails and
  known limits are one line each, and development material moved to the new `CONTRIBUTING.md`.

### Tests

- An eval case for each new agent and persona, on the sales-app fixture (`make.sh --hollow-fix` adds a fix whose
  test passes on the old code). The risk-tier cases now allow the `Agent` tool and pass `--no-research`, and the
  MEDIUM case checks for a `**Docs:**` requirement. Their "has commands" grader accepts any table row with a code
  span, not only a cell that holds exactly one command.
- `evals/run.sh` runs the suite with one fixed set of options. CI now also shellchecks the eval scripts.

### Fixed

- In Claude Code's macOS sandbox, `git` resolves to Apple's launcher, which can't run there, and `git worktree add`
  fails even with Homebrew's git because it starts a second git process. The prover now creates worktrees with
  `--no-checkout` and checks out in a separate step, and every agent that uses git (builder, prover, reviewers,
  auditors, triager, PR writer) calls git by full path when the launcher fails.
- The researcher sometimes answered library questions from memory without opening the docs. It now checks every
  library or API claim against the official docs for the pinned version, or marks it unverified.
- The PR writer added a "Generated with Claude Code" line to descriptions. It now adds no attribution lines.
- The blind user sometimes listed the project's folders, which the source guard blocks, making
  `blind-user-no-source` flaky. Its prompt now says to work from the app's help, output, and README.

## 0.1.1 (2026-10-30)

### Added

- README animations of the Swiss cheese layers, a task moving through the stages, and the review loop, in
  light and dark versions (`assets/`).

### Fixed

- `/quorum:review-loop` kept only the capped findings in `survivors.md`, losing the voter's `DROP` lines that
  `/quorum:codify-lesson` reads. The voter's full reply is now saved as `votes.md`.
- The blind-user agent could read `.tasks/` (review findings cite `file:line`), `CLAUDE.md`, and `REVIEW.md`
  through the shell. The source guard now blocks them for that agent; lockfile-only blind mode still allows `.tasks/`.

## 0.1.0 (2026-10-30)

First release.

### Added

- Plugin and marketplace manifests, with `userConfig` options for rounds, nit cap, Stop-hook checks, timeouts, the
  MEDIUM security pass, and the blind-test block lists.
- `quorum-active-task`: finds the current task from a `feat/<slug>` or `fix/<slug>` branch or `.tasks/.active`,
  and sets or clears `.tasks/.active`.
- `quorum-state`: reads and updates the frontmatter of `.tasks/<slug>/state.md`, validating statuses, risk tiers,
  and counters.
- SessionStart hook that adds Quorum's three universal laws to every session and suggests `/quorum:init-pipeline`
  in repos without a `REVIEW.md`.
- `pipeline-laws` skill: the full laws and a map of which stage comes next.
- `/quorum:init-pipeline`: detects the stack, confirms the fast checks with you, adds a Verification Commands
  section to `CLAUDE.md`, writes `REVIEW.md` with failure modes for Node, Python, Go, Rust, JVM, or a general
  profile, generates `.claude/hooks/verify-completion.sh`, dry-runs it, and gitignores `.tasks/`. `--yes` accepts
  the detected commands.
- `quorum-detect-stack`, `quorum-render-review`, and `quorum-render-verify` helpers behind it.
- Stop and SubagentStop hook (builder only) that blocks "done" while a task is `BUILDING`, `IN_REVIEW`, or
  `ESCALATED` and its checks fail. After 3 failures in a row it lets the stop through, marks the task `ESCALATED`,
  and warns you; the next pass restores the previous status. Checks time out after `verify_timeout_s`.
- `/quorum:spec-and-eval`: names the task, classifies its risk tier, writes `rd.md` (with a one-step rollback plan)
  and `eval.md` (runnable checks and edge cases), creates `state.md`, and for UI work writes a self-contained
  `mockup.html` and stops for sign-off. `--redesign <slug>` restarts a `HALTED` task, keeping its history.
- `/quorum:build`: records mockup sign-off, creates `feat/<slug>` or `fix/<slug>`, records `base_sha`, and runs
  the new `builder` agent.
- `/quorum:simplify-diff`: removes debug output, dead code, and unrelated changes from the task's diff, re-runs
  the checks, and commits.
- `/quorum:review-loop`: starts fresh-context `code-reviewer` agents in parallel (one for LOW, two personas for
  MEDIUM and HIGH) on only the new lines, has the `verifier-voter` drop false alarms and enforce the nit cap, and
  sends surviving findings to the builder by Pattern Category, for up to `max_rounds`. Ends `CONVERGED`, or
  `HALTED` with a post-mortem and two redesign options. LOW tasks get the Stage 7 summary and end `READY`.
- `code-reviewer` and `verifier-voter` agents.
- `/quorum:blind-test`: for MEDIUM and HIGH tasks, runs the new `security-reviewer` (HIGH, or MEDIUM with
  `security_on_medium`), then the new `blind-user` agent, which tries the task's goal through the running app
  with no access to the source. Problems go to `pending_findings` for `/quorum:review-loop` to fix first; a
  second failing run ends `HALTED`. A clean run prints the Stage 7 summary and ends `AWAITING-HUMAN`.
- PreToolUse source guard: in blind mode (the `quorum:blind-user` agent, or while `.tasks/.blind-mode-active`
  exists) blocks reads of source files and folders through Read, Grep, Glob, and reading shell commands, while
  still allowing the app to run. Block lists are plugin options, overridable in `.claude/quorum.json`.
- `/quorum:codify-lesson`: proposes one rule from a task's repeated findings, false alarms, or blind-test
  blockers, and writes it to `REVIEW.md` section 6 only after you confirm. `quorum-learned-rule` adds and lists
  those rules.
- The Stop hook lets the main session stop while a task has pending findings (they're queued for the builder,
  whose own check still applies).
- `quorum-findings`: counts findings by tag, applies the nit cap, and extracts `[IMPORTANT]` findings and their
  Pattern Categories. `quorum-state log` appends to a task's round log.
- `quorum-branch`: default branch, task branch creation, the diff range to review, and round SHAs.
- bats tests for the helpers and hooks, fixture repos for each stack, and CI that runs them with shellcheck and `claude plugin validate --strict`.
