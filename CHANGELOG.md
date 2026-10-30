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
- bats tests for the helpers and the hook, and CI that runs them with shellcheck and `claude plugin validate --strict`.
