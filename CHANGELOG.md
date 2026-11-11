# Changelog

All notable changes to this plugin. Versions match `version` in `.claude-plugin/plugin.json`; update an installed
copy with `/plugin marketplace update`.

## Unreleased

### Added

- **The checks can't be weakened during a task.** A new hook, `protect-checks.sh`, applies while a task is
  `BUILDING` or `IN_REVIEW`, to the builder and the main session alike. It blocks:
  - edits to the task's own `rd.md` and `eval.md` (what the prover holds it to), `verify-completion.sh`,
    `.claude/settings*.json`, CI configs, commit hooks, and the usual test, lint,
    type-check, and format configs, whether by `Edit` or `Write` or by a Bash redirect, `tee`, `cp`, `mv`, `rm`, or
    `sed -i`;
  - `git commit --no-verify`, `-n`, and commits with `core.hooksPath` set.

  A change the task needs goes in `plan.md`'s new **Checks changes** section. Approving the plan unlocks those files
  (`unlocked` in `state.md`), and `--yes` never approves a plan that has any. Otherwise only the user can unlock a
  file, by running `! quorum-state push unlocked <path>`; the hook blocks Claude from running it. The new
  `protected_paths` option, or `protected_paths` in `.claude/quorum.json`, adds the repo's own.
- **A secret guard, in every session.** `secret-guard.sh` blocks reading `.env` and other credential files, with
  `Read`, `Grep`, or a reading command. It also blocks a `git commit` whose new lines hold an AWS, GitHub, Slack,
  Stripe, Google, Anthropic, or OpenAI key, a private key, or a quoted password or token. It names the file, line,
  and kind, never the value. `quorum: allow-secret` on a line passes a fake value; the `secret_guard` option turns
  the guard off. The new `quorum-secrets` helper does the matching.
- **Review rounds fail closed.** A reviewer whose reply is empty, has no `Summary:` line, or fails
  `quorum-findings check` is started once more. If it fails again, the round stops without converging, and the next
  run reviews that round again. `/quorum:review` marks the run `INTERRUPTED`.
- **Findings outside the diff are dropped before the voter.** `quorum-findings scope RANGE` keeps a finding only if
  its file changed and its line is within 3 lines of a changed one, and not on a lint-ignore comment. It always keeps
  `[PRE-EXISTING]` findings and ones citing `.tasks/`. The voter reads `in-scope.md`; `out-of-scope.md` lists each
  drop with its reason, and the report shows them.

### Fixed

- **A LOW task without `--fast` gets its spec reviewers again.** The spec steps' fast-path rule didn't name its
  condition, and a `/quorum:run --yes` on a LOW task read it as its own and skipped both spec reviewers. The steps
  now say a task is on the fast path only with `--fast`. `run-low-to-ready` checks that the reviewers ran, and
  `run-fast-low` that none did.
- **`quorum-state log` no longer hangs** when given its text as arguments. It read only stdin, which an agent's
  shell keeps open. Arguments now take precedence, with `\n` read as a newline.
- **When a round has nothing in scope to vote on**, the steps now say so: `survivors.md` gets the empty summary, and
  the voter isn't started.

## 0.9.0 (2026-11-10)

### Added

- **A worktree per task, and more than one task at a time.** `/quorum:build --worktree`, `/quorum:run --worktree`,
  or the new **A worktree per task** option (`worktrees`, off by default) checks the task's branch out in its own
  git worktree at `.claude/worktrees/<slug>`, runs the repo's setup command there, and moves the session in. The
  stages after the build work there, and the main working tree stays free for other tasks.
  - The task's folder moves into its worktree, because Claude Code lets a session it moved into a worktree write only
    inside it. The main working tree's `.tasks/<slug>` links to it, so everything else still finds the task there.
    Git sees neither.
  - `quorum-active-task` resolves the task from the worktree you're in. `--code` prints that working tree,
    `--main` prints the main one, and `--list` lists every task.
  - The Stop hook runs the task's worktree's checks.
  - The blind-test marker is now per task (`.tasks/<slug>/.blind-mode-active`), so one task's blind test doesn't
    blind another's sessions.
  - The PR hook records the PR on the worktree's task.
  - `quorum-state` records the task's `worktree`, and checks the proof against its HEAD.
  - `quorum-branch remove` (which moves the task's folder back first) and `quorum-branch merged` handle cleanup:
    once a task's work merges, the next task Quorum starts offers to remove its worktree.
  - The dashboard shows the task of the worktree you're in, and lists the repo's other unfinished tasks.
- **When the host has no `EnterWorktree`** (plugin evals don't offer it), the build removes the new worktree, says
  why, and builds in place.
- **A setup command.** `quorum-detect-stack` proposes one from the lockfile (for example `pnpm install
  --frozen-lockfile`, `npm ci`, `uv sync`), and `/quorum:init-pipeline` records it as **Setup** in `CLAUDE.md`'s
  Verification Commands. It also says that worktrees need the bootstrap files committed.

### Fixed

- **`git worktree add` in Claude Code's macOS sandbox.** git starts some subcommands as child processes found on
  PATH, and there they hit Apple's broken launcher even when `quorum-git` ran a real git. `quorum-git` now puts the
  plugin's `libexec/git`, which runs the same real git, first on PATH.

## 0.8.0 (2026-11-10)

### Added

- **`/quorum:run --fast`, a fast path for LOW tasks.** A short spec with no spec reviewers or mockup, no plan round
  (the task goes from spec straight to `BUILDING`), the build, a review by the Logic & Edge-Case Hunter alone, the
  proof, and the PR draft. The voter, the round cap, the Stop hook, and the proof before `READY` stay. The task
  records `fast: true` in `state.md`, so the stage commands and the dashboard (which shows the Plan stage as
  skipped) know. A task the spec puts at MEDIUM or HIGH takes the full pipeline. A new eval, `run-fast-low`, checks
  it.
- **Lessons suggest themselves.** When the review loop, the blind test, or `/quorum:review` ends, it suggests
  `/quorum:codify-lesson` for a Pattern Category the voter kept in more than one round or in another task too, the
  same false alarm dropped twice, or a blocker the blind test found that every reviewer missed. It only suggests:
  the rule is written after you say yes, as before. The new `quorum-lessons` helper finds the repeated categories.
  The planner now names the learned rules that apply to each step, so a lesson shapes the next plan too.
- **The dashboard shows the task's model choices.** The Spend section lists the reviewer and helper models the
  task chose next to the models its agents ran on, and warns when an agent ran on another one (a choice that didn't
  take); the section opens by itself while it does.
- **`/quorum:codify-lesson` learns from `/quorum:review`.** It reads a review's `run-<N>/` files and log as it reads
  a task's rounds, so a Pattern Category that keeps coming back, a false alarm the voter keeps dropping, or a kept
  finding you say is wrong can become a rule. The review's report suggests it when you say a finding was wrong.

## 0.7.0 (2026-11-10)

### Added

- **The dashboard shows `/quorum:review`.** The review this session is running gets a card in the pane: what it
  reviews, its tier and range, each reviewer's progress, the voter and the findings it kept, and the builder while
  `--fix` runs. Beside an active task the card goes under the Now card and the band adds one dim line for it, so the
  task stays in front; with no task, the band shows the review instead.
- **A Reviews section in the pane** keeps the last few reviews after they finish, newest first: each one's status,
  tier, runs, what its latest run kept, and when. A row opens to its range and kept findings, each with a copy
  button. It starts folded beside a task, and open when there's none.
- **Interrupted reviews are marked `INTERRUPTED`.** A review now records the session running it (`session` in its
  `state.md`). When `/quorum:review`, `/quorum:build`, or `/quorum:review-loop` starts, the new `quorum-reviews
  heal` marks any review that session left unfinished, and a review being run again, as `INTERRUPTED`, and logs
  which run stopped. The dashboard shows a review still running in another session as "running elsewhere or
  interrupted", since only that session can tell.

### Fixed

- **A `--fix` that was interrupted no longer takes over later builders.** It left `.tasks/.review-fix-active`
  behind, and the Stop hook checked the next `quorum:builder`, a task's included, against that review: its failures
  counted on the review, and the task never escalated. The marker now names the session that wrote it, and the hook
  ignores it in any other session or once its review isn't `FIXING`. `quorum-reviews heal` also removes one that's
  left over.

## 0.6.0 (2026-11-09)

### Changed

- **The dashboard pane is redesigned** as two cards and a list of sections that fold. A task card holds the title
  (with the ticket id to the right), goal, status, a stepper through the stages, and the PR as a link with a copy
  button; a Now card, its border amber when the task waits on you and red when it's stuck, holds what the stage is
  doing and each finding the voter kept, with a severity badge, its `file:line` and a copy button, and its confidence.
  Requirements, Checks (with PASS, FAIL, and SKIP badges), Review rounds, Spend, and Other agents fold to one row each
  and open on a click; a section opens by itself while it holds a problem, so a fold never hides one. Rows and cards
  highlight under the pointer where the surface has one. The separate Stages list is gone: the stepper and one line of
  stage details replace it.

- **The band above the prompt** is one row in order of importance: a status badge colored by whose move it is,
  the task and risk, a dot per stage with the current one named, the round's progress, anything wrong in red, and
  the Next and Dashboard buttons. A narrow terminal keeps the badge, dots, first problem, and buttons.
- **No status line under the prompt any more.** It repeated what the band above the prompt shows; Quorum clears one
  an earlier version left.
- There's a blank line between the pane's folding sections.

### Added

- **▶ Next** in the dashboard's band and pane: a button that puts the next Quorum command in the prompt, for you to send, change, or
  add to, keeping anything you'd typed after it. It never sends the command.

## 0.5.0 (2026-11-09)

### Added

- **`/quorum:run`: the whole pipeline in one command.** It starts a task from a request, or continues the active
  one from its status, and follows each stage's own steps in order: spec, plan, build, simplify, review loop, blind
  test, PR draft. It stops only where you must decide (the slug, tier, and research; the models; docs; mockup
  sign-off; plan approval; a halt; the human review), and `--yes` never skips a HIGH task's tier or plan approval.
  `--until <stage>` stops it early. It never pushes, opens, or merges a PR, and keeps the chat to one line per
  stage.

- **`/quorum:review`: Quorum's reviewers on any diff,** with no task, spec, plan, or bootstrap. It reviews the
  current branch, a GitHub PR, or a git range against the PR's description or the commit messages; proposes a risk
  tier you confirm, which picks the reviewers as the review loop does (plus the security reviewer for HIGH); runs the
  voter; and reports the kept findings by tag and confidence, with what the voter dropped. `--comment` posts the kept
  `[IMPORTANT]` findings as a GitHub review after you approve every comment. `--fix` has the builder fix them in one
  commit, with the SubagentStop hook checking its work through a new `.tasks/.review-fix-active` marker. Each review
  keeps its runs in `.tasks/review-<id>/`; without `REVIEW.md` it uses the template's general rules.
- `quorum-state`: `kind` and `range` keys and `REVIEWING`, `FIXING`, and `REVIEWED` statuses for a review's state.
- The reviewers, the voter, and the builder have a "Standalone review" mode for prompts with no task spec.
- Eval case `review-standalone-finds-bug`; the near-miss case now also fails if an ordinary request starts
  `/quorum:review`, `/quorum:plan`, or `/quorum:pr-draft`.

- **Choose the models for a task's agents at runtime.** `/quorum:spec-and-eval` asks which model the reviewers use
  (the spec, plan, code, accessibility, and security reviewers, and the voter) and which the helpers use (the PR
  writer and the friction triager). The choices come from the models Claude Code offers at the time, not a list in
  the plugin, so they keep up as models change. The answers are saved in `state.md` (`reviewer_model`,
  `helper_model`) and every later command passes them on. `--models` on `spec-and-eval`, `plan`, `review-loop`,
  `blind-test`, or `pr-draft` asks again. The `reviewer_model` and `helper_model` plugin options (default `ask`)
  set a default and skip the question. The rules are in `skills/pipeline-laws/models.md`.
- **Confidence on every finding.** Reviewers add `Confidence: <0-100>` under each finding. The voter checks the least
  confident findings hardest, never keeps or drops one on its score alone, and replaces the score with its own after
  checking. `quorum-findings cap` keeps the most confident nits instead of the first ones, and
  `quorum-findings check` refuses a score outside 0-100. Findings without a score still parse.
- **What the agents cost, on the dashboard.** A **Spend** section shows how many Quorum agents ran since the last
  `/quorum:*` command, their input (and cached) and output tokens, summed from each request they made, and how many
  ran on each model. Other agents show their own token counts.

### Changed

- Each stage command (`spec-and-eval`, `plan`, `build`, `simplify-diff`, `review-loop`, `blind-test`, `pr-draft`)
  keeps its instructions in `skills/<stage>/steps.md`, which `/quorum:run` follows too. Its `SKILL.md` gives the
  values the steps use. The commands behave as before.

### Fixed

- The status line and toasts said "Quorum" twice (`quorum: Quorum · csv-export · …`): Claude Code already draws
  them under the plugin's name. They now start with the task's slug.
- Quorum's helpers (`quorum-branch`, `quorum-state`, `quorum-active-task`, the session hook) failed where a sandbox
  hides the real git behind Apple's `/usr/bin/git` launcher, and `quorum-state` then skipped its check that the
  proof ran at HEAD. A new `quorum-git` runs git, falling back to a real git by full path; the helpers go through it,
  and the orchestrating skills use it when `git` fails.
- `/quorum:pr-draft` refused a proof with only skipped checks, which `quorum-state` accepts for `READY`, so a
  finished task couldn't get its PR drafted. It now accepts them and has the PR list them as not run.
- Specs wrote eval checks with `rg`, which many machines lack, so they were skipped. They now use `grep` unless the
  repo already uses ripgrep.
- The docs auditor's row in the review loop's reviewer table had lost its indent, which could break the table.

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
