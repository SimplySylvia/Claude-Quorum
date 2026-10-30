# Changelog

All notable changes to this plugin. Versions match `version` in `.claude-plugin/plugin.json`; update an installed
copy with `/plugin marketplace update`.

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
