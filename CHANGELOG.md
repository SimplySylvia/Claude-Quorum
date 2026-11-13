# Changelog

All notable changes to this plugin. Versions match `version` in `.claude-plugin/plugin.json`; update an installed
copy with `/plugin marketplace update`.

## Unreleased

### Added

- **A baseline: what Quorum changes, measured without it.** `baseline-done-with-failing-check` asks a session for
  a help-text change on a half-built CSV export whose committed quoting test fails; the prompt never mentions tests
  or Quorum. Run with `--ablation with-without`, 10 runs each on Sonnet 5.5: with Quorum, the Stop hook blocked
  "done" and the session fixed the quoting in 10 of 10 runs; without it, the session fixed it in 0 of 10 and called
  the work done with the test still failing in 4 of 10 (score 1.00 vs 0.70, at $0.13 vs $0.07 a run).
  CONTRIBUTING's new **Baselines** section says how to run one, and why the agent cases can't be baselines.

### Changed

- **A new headline.** The README and the plugin's descriptions now lead with what Quorum does (checks Claude
  Code's work at every stage, with separate agents that have to agree) instead of calling it a pipeline, and name all
  three ways in: a task, any diff, or a map.
- **A shorter README, with guides for the details.** The README is down to what Quorum is, a quick start, the agent
  map, the commands, and the main guardrails. Everything else moved, unchanged, to `guides/`: how it works (both
  workflows, the stages, the review loop, risk tiers, models), running a task, research and maps, reviewing any
  diff, learning from mistakes, the dashboard, guardrails and known limits, and the reference.

### Fixed

- **`/quorum:run` no longer fixes things itself before the build.** Reading the code for the spec, the model would
  see an obvious fix and make it, skipping the plan, the builder, the review, and the proof: in a 10-task SWE-bench
  pilot it did so in half the full runs and most `--fast` ones. A new hook, `run-guard.sh`, now blocks a
  `/quorum:run` session's main conversation from editing files outside `.tasks/` or committing until the task's
  build starts (`quorum-run enter` and `leave` mark the session; Quorum's agents aren't
  affected). The run skill and the spec steps say to write a found fix into the spec, and the new
  `run-stays-in-stages` eval tempts the shortcut. The SessionEnd hook, now `session-end.sh`, ends run sessions too.
- **The guards read Bash commands better.** The map guard and the checks lock no longer take a heredoc's text for
  commands, a `$variable` or an option for a path, or a `sed -i` script's words for files; they resolve a write
  against the command's `cd`, and let through a bare file name they can't place.

## 0.11.1 (2026-11-12)

### Added

- **Two workflows, start to finish, in the README.** Two new animations show what you type and what runs: a feature
  charted as a map, researched, decided, handed off, and built through every stage, and a bug fix with
  `/quorum:run --bug --fast`, from the reproduction to `Bug: VERIFIED`. Each marks where Quorum stops for you and
  where a check sends work back.

### Fixed

- **A map session ends with its session.** A session closed or cleared partway through `/quorum:map` left its
  `.tasks/.map-sessions/` marker behind, and the map guard kept blocking that session if it was resumed. A new
  SessionEnd hook, `map-session-end.sh`, removes it. A crashed session can't run the hook, so `quorum-map sessions`
  lists what's left, and `/quorum:map` with no arguments shows it and offers to end it.
- **A map stops at 99 tickets.** Tickets are numbered `01` to `99`, and a 100th wasn't listed, so the next one took
  its number too. `quorum-map new` now refuses past 99.
- **A map's code questions always get their facts.** Working a grilling ticket about the code, `/quorum:map` read
  the code itself when the facts looked small and skipped the facts-only researcher, so the answer had no facts file
  to cite. It now starts the researcher every time.

## 0.11.0 (2026-11-11)

### Added

- **Maps, for an effort too big for one task.** `/quorum:map <idea>` names the destination, grills breadth-first for
  the open decisions, and charts them in `.tasks/map-<slug>/` as at most 8 tickets, each a question with a type
  (`grilling`, `research`, `prototype`, or `task`) and the tickets it waits on. What it can't phrase yet goes under
  **Not yet specified**, and work beyond the destination under **Out of scope**. Research tickets start at once, a
  `researcher` each, in parallel. Each later `/quorum:map <slug>` claims the first ticket on the frontier, resolves
  it with you, adds a line to **Decisions so far**, and stops; `--revise` reopens a decision and lists what rested on
  it. Once nothing is left to decide, it writes `tasks.md`: the destination as Quorum tasks, vertical slices with
  their tiers, their order, and the decisions they rest on. If an idea fits one task, it says so and writes nothing.
  The idea comes from Matt Pocock's [wayfinder](https://github.com/mattpocock/skills) skill.
- **Quorum's agents work the map.** A grilling ticket about the code or a dependency first gets a `researcher` in
  a new facts-only mode (what the code does, what the docs say, the constraints; no recommendation). A weighty
  research ticket gets a deep research, with its claims checked against their sources. Before a grilling or
  prototype decision is recorded, the `spec-reviewer` checks it against the code and the map's earlier decisions, in
  a new decision mode. The task breakdown is reviewed in a new map mode by the `code-reviewer` (Architecture, Security
  & Drift Hunter), the `pattern-auditor`, and for HIGH tasks the `security-reviewer`, then voted on by the
  `verifier-voter`, before you approve it.
- **`/quorum:spec-and-eval --from-map <map> <n>`** starts a map's task once the tasks it waits on have merged. It
  saves the decisions the task rests on to `decisions.md`, writes them into the requirements and non-goals, and
  doesn't ask again what the map decided; the spec reviewers and the planner read them too. `state.md` records `map`
  and `map_task`. **`/quorum:run --map <map>`** starts the next ready task and takes it through every stage.
- **A map guard.** `hooks/map-guard.sh` keeps a map session from building: it blocks edits to the repo outside
  `.tasks/`, Bash writes into it, commits and pushes, and `quorum-branch start`. It applies only to the session
  that's working on a map.
- **`bin/quorum-map`** keeps a map without a model: tickets, blocking edges (refusing cycles), the frontier,
  claims, resolutions and the map's index, out-of-scope rulings, reopening, the task graph, and `check`, which
  reports a broken map. Only the user can answer a `grilling` or `prototype` ticket: `resolve` refuses one the agent
  answered.
- **Grilling, wherever a decision is yours.** A new model-invocable `grilling` skill asks in rounds: every question
  that can be asked now, each with a recommended answer, nothing the code or an earlier answer settles. The spec
  asks follow-up rounds when the answers open new questions, asks the approach and the research's assumptions to
  confirm as a round, and sends a spec-review finding only you can settle to you before changing the spec. Plan
  approval asks the plan's open questions instead of leaving them to the builder. A redesign grills what the chosen
  option leaves open, and `/quorum:research` offers a round on its assumptions.
- **`/quorum:retro`**, after Matt Pocock's `retro` skill. It looks back over a task, a map, a session, or every task
  since a date (`--since`), and finds what the next build should do differently: checks to wire in or add, review
  rules, `CLAUDE.md` pointers, broken commands, steering lines that do nothing, what agents couldn't see, and Quorum
  settings worth changing. It reads Quorum's records and the session logs, ranks what it finds most severe first,
  applies only what you pick (in `codify-lesson`'s cheapest-form order), and saves the retro to
  `.tasks/retro-<date>/` so the next one doesn't propose a declined idea again. A new `bin/quorum-session` finds a
  session's log and summarizes it as data (calls per tool, subagents, failed calls, hook blocks, files reread, long
  searches), never its content.
- **Merge danger in the PR draft.** The PR writer ends the description with a one-way or two-way door call and the
  blast radius.
- **Wide refactors expand, then contract.** The planner plans a rename or retype that would break every caller at
  once as expand–contract steps, each leaving the checks passing.
- **`/quorum:codify-lesson` looks at the environment too.** It first offers to wire in a check the repo already has
  but `verify-completion.sh` doesn't run, and offers a one-line pointer in `CLAUDE.md` when an agent couldn't find
  something. `--audit` also lists steering lines that do nothing: rules a check now enforces, lines that restate any
  agent's defaults, and pointers to files that are gone.
- **`quorum-branch is-merged <slug>`** tells whether a task's work merged, with or without a worktree; `merged` uses
  it.

### Changed

- **The README is reorganized** around what you have in front of you: a short quick start with a "where to start"
  table, how a task moves through the stages, a new diagram of a map's flow from a problem to merged code, then
  running a task, what comes before a task (research and maps), reviewing any diff, where Quorum asks you, and
  learning from mistakes. A commands table lists every command and its options, and the `.tasks/` tree shows maps,
  research, reviews, and retros. The run diagram shows the spec's follow-up rounds and the plan's open questions.

## 0.10.0 (2026-11-11)

### Added

- **The checks can't be weakened during a task.** A new hook, `protect-checks.sh`, applies while a task is
  `BUILDING` or `IN_REVIEW`, to the builder and the main session alike. It blocks:
  - edits to the task's own `rd.md` and `eval.md` (what the prover holds it to) once its build has started,
    `verify-completion.sh`,
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

- **A verdict for every requirement.** The final proof gives each requirement in `rd.md` a verdict:
  - **MET** needs evidence: its checks pass, and the `file:line` that does the work is substantive and wired in,
    not a stub.
  - **PARTIAL**, **MISSING**, and **CONTRADICTS** count as failures.

  It also lists **Unrequested** code. `quorum-state` refuses `READY` and `AWAITING-HUMAN` until every requirement
  is MET. An unmet one goes back to the review loop as a pending `[IMPORTANT]` finding ("Unmet requirement"),
  under the round cap. The dashboard's Requirements section shows each verdict with its evidence, and the PR
  writer uses them.
- **Deep research, and research before a task.**
  - **`/quorum:research <question>`** researches without creating a task, in `.tasks/research-<slug>/`. Its
    report adds **Viability** and **Candidate tasks**, and `/quorum:spec-and-eval --from-research <slug> <n>`
    starts a task from one. For runtime questions, it first asks which connected tools to gather evidence from.
  - **Inside a task,** `--deep-research [quick|standard|deep]` on `spec-and-eval` and `run` does the same
    research in place of the single researcher.
  - **How it runs:** the main thread leads. You approve its sub-questions, each with a lens: repo precedent,
    official docs, alternatives, or counter-evidence. Researchers then work in parallel under tool-call budgets,
    each writing its own findings file; a hook keeps the researcher's new `Write` inside the research folders.
  - **Every claim carries its evidence:** `VERIFIED` with `path:line @ sha`, `CITED` with the quote, the URL, the
    date, and the version, or `ASSUMED`. The new `quorum-research-check` re-finds repo quotes. The new
    `source-verifier` agent reopens only the pages that matter and drops what they don't say. Assumptions go to
    you.
  - **The report:** at most one gap round, then a report in the usual format, plus **Assumptions to confirm** and
    **Remaining gaps**.
  - **Measured:** `state.md`'s new `research_decision` records whether research changed the spec.
  - **The secret guard checks web queries.** `secret-guard.sh` now blocks a WebSearch query or a WebFetch URL that
    holds a secret (`quorum-secrets text`). A probe confirmed plugin hooks see a subagent's WebSearch.
- **Large plans are built a step at a time.** A plan with 4 or more steps (not on the fast path) gets a fresh builder
  per step, each starting from the last step's commit and leaving the checks passing. `state.md`'s new
  `built_steps` records each step as it's built, so a cut-off build or a new session resumes at the next step (the
  new `quorum-plan` reads the plan's steps). The planner writes steps that stand alone, and marks mechanical ones,
  which the new `mechanical_model` option can send to a cheaper model. The dashboard shows "Build 2/5". The review
  loop still reviews the whole branch.
- **Plans learn from earlier tasks.** `quorum-lessons history` gathers what other tasks in the repo learned:
  - the learned rules;
  - halted tasks' `## Post-mortem` blocks;
  - blind-test blockers the triage marked `CAUSED`;
  - disputes the voter upheld;
  - Pattern Categories that kept coming back.

  The spec and plan stages save it as `history.md`. The researcher weighs it, and the plan's new `## Lessons`
  section names each lesson that applies and the step that answers it.
- **`codify-lesson` picks the cheapest form that stops the repeat:** a regression test, a lint rule, a **pattern
  rule**, and only then a line in `REVIEW.md`. A test or lint rule becomes a `/quorum:run --fast` task. A pattern
  rule is a glob, a regex, and a message (`quorum-learned-rule pattern add`, in `.claude/quorum.json`); while a task
  builds or is in review, `protect-checks.sh` blocks an Edit or Write that adds matching code to a matching file.
- **Stale rules can be retired.** Reviewers and the voter quote the learned rules they apply
  (`learned rule: "..."`). `quorum-learned-rule audit` reports each rule's age and last citation, and
  `/quorum:codify-lesson --audit` offers to remove rules no review has cited in 90 days, with your yes
  (`quorum-learned-rule remove`).
- **A bugfix path, `--bug`,** on `/quorum:run` and `/quorum:spec-and-eval`:
  - The spec reproduces the bug on the current code before anything else, and asks for what's missing if it
    can't.
  - `rd.md` gets a `## The bug` section, and the reproduction becomes `eval.md` row 1, with row 1b showing it
    fails without the fix.
  - The task records `bug: true` and builds on `fix/<slug>`.
  - The final proof adds `Bug: VERIFIED`, `PARTIAL`, or `FAILED`, and `quorum-validate proof` accepts only
    VERIFIED.
  - A LOW bug can take the fast path. When a request reads like a bug, the proposal offers this path.
- **Habits inside a build.**
  - A new model-invocable `debugging` skill: reproduce, read the whole error, check what changed, and name the root
    cause with evidence before any fix. The builder uses it when a check fails, and the Stop hook's messages point
    to it.
  - The builder writes each new test first and shows it failing before the code.
  - The builder checks every finding against the code, and disputes a wrong one with evidence. The voter rechecks
    disputes (`disputes.md`), the builder fixes the ones the voter keeps, and an upheld dispute counts toward
    lessons.
  - A fourth law, **root cause before fixes**, joins the three in every session.
- **Fewer questions at the spec stage.** `spec-and-eval` asks why the change is wanted only when the request
  doesn't say. It then states the slug, tier, research choice, docs, and (for LOW) the fast path as one proposal,
  and asks once, together with any open design questions. It no longer asks about each one in turn. A HIGH tier
  now needs your yes even with `--yes` in `/quorum:spec-and-eval` too, as it already did in `/quorum:run`. In the
  `spec-asks-once` eval, the process questions went from three (slug and tier, docs, models) to one confirmation of
  the proposal, with the models asked only the first time in a repo. The design questions beside it stay, since
  their answers change what gets built.
- **Model choices are remembered per repo.** Once answered, they're saved in `.claude/quorum.json` with the new
  `quorum-config` helper, and later tasks don't ask. `--models` asks again, and a repo's remembered choice wins over
  the plugin options.
- **`quorum-validate`, a lint for the spec, the plan, and the proof.**
  - `spec`: every requirement has an `eval.md` row, and every row names a requirement, a command, and what passing
    looks like; vague words are warnings.
  - `plan`: every step names the requirements it serves, and every requirement has a step.
  - `proof`: every requirement is MET with evidence.

  `spec-and-eval` runs it before the spec reviewers, and `plan` before the plan reviewers.

### Fixed

- **A spec's checks are tried before they're locked.** The spec stage now runs every `eval.md` command once on the
  current code. A command may fail, since nothing is built yet, but it must run, so a broken row is fixed while
  `eval.md` can still change. `quorum-validate spec` rejects `grep -P`, which macOS grep lacks, and warns on
  `mktemp` and `timeout`. Temporary files go under `.tasks/<slug>/tmp/`.
- **`\|` in an `eval.md` table cell is a `|`.** The prover runs it that way, and `quorum-validate` and the
  dashboard no longer split the cell there.
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
