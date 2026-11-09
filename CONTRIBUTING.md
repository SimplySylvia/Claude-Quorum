# Contributing to Quorum

You need `bash`, `git`, `jq`, [`bats-core`](https://github.com/bats-core/bats-core), `shellcheck`, and Claude Code.

## Tests

Hooks read JSON on stdin, so tests feed fixture hook input and check the exit code:

```bash
bats -r tests/                                # every hook and bin/ helper
shellcheck hooks/*.sh bin/* evals/run.sh evals/_fixture/make.sh evals/*/scaffold.sh assets/src/*.sh
claude plugin validate --strict .             # manifest, paths, marketplace, the dashboard module; warnings fail
claude plugin test .                          # the dashboard's tests in tests/dashboard/, against the engine
```

CI runs all four on every push and pull request: bats and shellcheck on Linux and on macOS (system bash 3.2).

The dashboard (`hooks/dashboard/`) is a hooks module: TypeScript that runs inside Claude Code, with no Node or DOM.
`task.ts` holds the pure parsing and stage logic; `register.tsx` hooks the events and draws. The values it keeps in
the session are declared in `types/index.d.ts`. To try a change live, start `claude --plugin-dir .` from this repo;
it reloads the module when you save.

## Evals

The suite in `evals/` runs against the `tests/e2e/sales-app` fixture, which `evals/_fixture/make.sh` copies into
each run's workspace and bootstraps for Quorum.

| Case | Checks |
|---|---|
| `risk-tier-low`, `-medium`, `-high` | `spec-and-eval` picks the right tier and writes runnable checks; the MEDIUM case also gets a `**Docs:**` requirement for its new command |
| `researcher-finds-precedent` | `researcher` cites the repo's code, compares options, and cites the Python docs |
| `spec-reviewer-feasibility` | The Feasibility Critic catches a spec citing a helper and a make target that don't exist |
| `spec-improver-flags-vague` | The Spec Improver rewrites a vague requirement and asks for a docs decision |
| `prover-catches-hollow-test` | `prover` runs a fail-before-fix row in a worktree, reports it FAIL, and leaves the tree alone |
| `planner-plans-reuse` | `planner` reuses the existing `money()` helper and covers tests, docs, and every requirement |
| `pattern-auditor-plan-mode` | `pattern-auditor`, in plan mode, flags a planned helper that already exists |
| `reviewer-flags-plan-drift` | `code-reviewer` flags code that wrote its own helper where the plan said to reuse one |
| `test-adequacy-hollow-test` | The Test Adequacy Hunter reports a regression test that passes on the old code |
| `pattern-auditor-duplicate-helper` | `pattern-auditor` reports a new helper that duplicates an existing one |
| `docs-auditor-stale-readme` | `docs-auditor` reports docs that still name a renamed command |
| `a11y-auditor-diff` | `a11y-auditor` reports WCAG A/AA failures in a new page, by criterion |
| `friction-triager-sorts` | `friction-triager` sorts blind-test friction into caused, data gap, and unrelated |
| `pr-writer-drops-setup` | `pr-writer` lists the setup commit to drop and doesn't claim a skipped check |
| `reviewer-finds-bug` | `code-reviewer` finds a planted requirement violation, with `file:line` and a Pattern Category |
| `voter-drops-false-alarm` | `verifier-voter` keeps the real bug and drops a factually wrong finding |
| `blind-user-no-source` | `blind-user` reaches its goal through the CLI without ever hitting the source guard |
| `nearmiss-no-auto-review-loop` | An ordinary "look at my commit" request never starts a Quorum command |

```bash
evals/run.sh                                   # the whole suite
evals/run.sh --case prover-catches-hollow-test # one case; any other `claude plugin eval` option works too
```

Every run makes real model calls on your Claude account, so CI doesn't run them. Run them after any change to a
skill's instructions or an agent's prompt.

**macOS note.** Claude Code's sandbox can't stat Homebrew's files, so PATH lookups fall back to Apple's
`/usr/bin/git` launcher, which the sandbox can't run either. Every agent that uses git handles this: it calls git by
full path when the launcher fails. The prover also creates worktrees with `--no-checkout`, so git doesn't start a
second git process.

## Trying a local build

```bash
claude plugin marketplace add ./
claude plugin install quorum@quorum
```

## Diagrams

Every visual in the README is an SVG drawn by `assets/src/diagrams.py`, in a light and a dark version: the Swiss
cheese and stages animations, the agent map, the review loop, and the risk-tier cards. After changing the layers or
stages, which agents a command starts, how a review round works, or what a tier gets, update the lists in that script
and run it:

```bash
python3 assets/src/diagrams.py
```

The two animations are plain CSS keyframes, so they play in a README image and show their final frame, without
motion, to viewers who ask for reduced motion.

## The dashboard demo

`assets/src/dashboard-demo.sh` builds a repo whose `.tasks/` holds one MEDIUM task partway through Quorum, so you
can see the dashboard and status line without running a real task, and screenshot them for the README. It writes
every file as the skills would have saved it and calls no model:

```bash
assets/src/dashboard-demo.sh /tmp/quorum-demo                 # code review round 2, two reviewers in
assets/src/dashboard-demo.sh /tmp/quorum-demo --stage blind   # blind test run 1 saved
assets/src/dashboard-demo.sh /tmp/quorum-demo --stage done    # AWAITING-HUMAN, proof at HEAD, PR #42 recorded
cd /tmp/quorum-demo && claude --plugin-dir <this repo>
```

Open the pane with `/quorum-dashboard` or the band's **Dashboard** button. If Quorum is also installed, disable it
for that session so the two copies don't both draw. The demo's PR points at a repository that doesn't exist, so the
dashboard shows it as `PR #42` without an open or merged state.

The README's `assets/dashboard-review.png` and `assets/dashboard-done.png` are the `review` and `done` stages in a
fullscreen terminal wide enough for the pane to dock beside the chat. Retake them when the dashboard's look changes,
from a folder whose path you're happy to publish.

## Releasing

Bump `version` in `.claude-plugin/plugin.json` when you change a skill, agent, or hook, and move the `Unreleased`
notes in [`CHANGELOG.md`](CHANGELOG.md) under the new version. Users pick it up with `/plugin marketplace update`.
