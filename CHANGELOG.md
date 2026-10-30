# Changelog

All notable changes to this plugin. Versions match `version` in `.claude-plugin/plugin.json`; update an installed
copy with `/plugin marketplace update`.

## Unreleased

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
- bats tests for the helpers and hooks, fixture repos for each stack, and CI that runs them with shellcheck and `claude plugin validate --strict`.
