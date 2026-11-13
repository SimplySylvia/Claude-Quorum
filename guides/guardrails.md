# Guardrails and known limits

[← Back to the README](../README.md)

## Guardrails

- **Proof before done.** The Stop hook blocks finishing during a task until the repo's fast checks pass; after 3
  failures in a row it lets you go and marks the task `ESCALATED`. A task can't be marked `READY` or
  `AWAITING-HUMAN` without the prover's `proof-final.md`, run at the current commit, with no failed check.
- **Root cause before fixes.** The builder writes each new test first and shows it failing before the code that
  makes it pass. When a check fails, it follows the `debugging` skill: reproduce, read the whole error, check what
  changed, and name the cause with evidence before changing code. It also checks each review finding against the
  code, and disputes a wrong one with evidence; the voter rechecks disputes, and an upheld one becomes a lesson.
- **Bugs are proven fixed.** With `--bug`, the spec reproduces the bug before anything else, and the task isn't done
  until the final proof shows the reproduction passing and failing without the fix (`Bug: VERIFIED`).
- **Every requirement gets a verdict.** The final proof marks each requirement in `rd.md` as MET, PARTIAL,
  MISSING, or CONTRADICTS. MET needs evidence: the checks that pass, and the `file:line` that does the work, real
  and wired in rather than a stub. Anything but MET goes back to the review loop. The proof also lists code no
  requirement asked for. The dashboard's Requirements section shows each verdict, and the PR draft cites them.
- **The spec and plan are linted first.** `quorum-validate` checks, without a model, that every requirement has
  a check and every check a requirement, and that every plan step names the requirements it serves. It also
  flags vague words. The reviewers start only after that passes.
- **The checks can't be weakened mid-task.** While a task builds or is in review, a hook blocks edits to the
  task's own `rd.md` and `eval.md` (once its build has started), `verify-completion.sh`, CI workflows, and the
  usual test, lint, type-check, and format configs. It also blocks `git commit --no-verify` and commits with
  `core.hooksPath` set. It applies to the builder and the main session alike. A change the task really needs goes
  in `plan.md`'s **Checks changes**, which you approve with the plan. Otherwise only you can unlock a file, with
  `! quorum-state push unlocked <path>`. Add your own with the `protected_paths` option or `.claude/quorum.json`.
- **Maps don't build.** In a `/quorum:map` session, a hook blocks edits to the repo outside `.tasks/`, Bash commands
  that write into it, commits and pushes, and starting a task's branch. It applies only to that session, and ends
  when the session does.
- **Secrets stay out.** In every session, a hook blocks reading `.env` and other credential files, and blocks a
  commit whose new lines look like a key or token. It names the file, line, and kind, never the value. A fake value
  in a test passes with `quorum: allow-secret` on its line. The `secret_guard` option turns it off.
- **No silent reviewers.** A reviewer that returns nothing, or a reply without a summary, is rerun once. If it fails
  again, the round stops instead of converging without it.
- **Findings stay on the change.** Before the voter, `quorum-findings scope` drops findings on lines the diff
  doesn't change, or on a line with a lint-ignore comment. It keeps `[PRE-EXISTING]` ones, and says why for each
  drop.
- **Hard caps.** At most 3 review rounds, then `HALTED` with a post-mortem and two redesign options.
- **Quiet outside a task.** Apart from the secret guard, the hooks do nothing unless a task is building, in review,
  or escalated, a blind test is running, or the session is working on a map.
- **Asks before writing** to `CLAUDE.md`, `REVIEW.md`, or your global `~/.claude/CLAUDE.md`, with a diff first.
- **Local data only.** Blind tests and `eval.md` checks use local, temporary, or synthetic data, never production.

## Known limits

- **Claude Code asks before writing `.claude/hooks/`**, so `init-pipeline` brings one approval prompt.
- **The check, map, and secret guards read commands, they don't sandbox them.** They catch the plain forms an agent
  uses (`cat .env`, `sed -i` on a config, `--no-verify`), not a script written to hide what it does. They also don't
  cover a test script inside `package.json` or `pyproject.toml`, which hold dependencies too. `Grep` over a whole
  folder can still show lines from a `.env` in it.
- **The blind guard is a safeguard, not a sandbox.** It blocks reading source, but running a script that reads
  source gets through, because running code is how a user runs the app.
- **Agents add up.** A MEDIUM or HIGH round runs 4–6 reviewers, a voter, and a builder, for up to 3 rounds, after
  research, two spec reviewers, and up to 2 plan-review rounds. On a map, a code question adds a facts researcher
  and a decision check, and the hand-off adds 2 to 3 reviewers and the voter. See [Models](how-it-works.md#models) for choosing
  what they run on.
- **A crashed map session stays guarded.** A session that ends removes its map-session marker, but one that crashes
  can't, so the guard keeps blocking edits if it's resumed. `/quorum:map` with no arguments lists leftover sessions
  and offers to end them.
- **Accessibility checks are partial.** Automated scans find only part of WCAG 2.2; the a11y auditor lists the
  rest under "Needs a human". A clean report isn't a conformance claim.
- **`verify-completion.sh` should stay fast.** The Stop hook runs it on every finish; put slow suites in `eval.md`.
