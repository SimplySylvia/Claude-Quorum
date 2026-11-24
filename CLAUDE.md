# Quorum

Quorum is a Claude Code plugin: a pipeline of slash commands (`/quorum:run` and the stage commands under
`skills/`), the agents they start (`agents/`), bash hooks and helpers (`hooks/`, `bin/`, `libexec/`), and a
TypeScript dashboard module (`hooks/dashboard/`). `CONTRIBUTING.md` says how the pieces fit and how to test them;
`REVIEW.md` says what a review looks for.

- Hooks and `bin/` scripts must run on bash 3.2 (macOS) and under Git Bash on Windows.
- Each stage's instructions live in `skills/<stage>/steps.md`; `/quorum:run` follows the same files.
- The dashboard only reads `.tasks/` and git's own files, and never writes.
- A changed skill, agent or hook needs a `CHANGELOG.md` note under `Unreleased`; the version in
  `.claude-plugin/plugin.json` is bumped at release.

## Verification Commands
<!-- Managed by /quorum:init-pipeline. Keep in sync with .claude/hooks/verify-completion.sh, which runs the fast checks. -->
- **Setup:** none
- **Build:** none
- **Typecheck:** `claude plugin validate --strict .`
- **Lint:** `shellcheck hooks/*.sh bin/* libexec/* evals/run.sh evals/_fixture/make.sh evals/*/scaffold.sh assets/src/*.sh`
- **Test:** `claude plugin test .`
- **Dev / start:** `claude --plugin-dir .`

The slow suites aren't in the fast checks: `bats -r tests/` (not run on Windows; CI runs it on Linux and macOS).

## Code Review & Verification Standards
All code reviews, subagent audits, and `/quorum:review-loop` passes MUST strictly follow the domain failure modes, severity tags, and learned rules defined in @REVIEW.md.
