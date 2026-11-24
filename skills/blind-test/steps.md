<!-- The steps of /quorum:blind-test, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Security pass and blind test

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

Work on the active task (`quorum-active-task`) from the repo root. You orchestrate: you don't test the app or
review the code yourself, and you never give the blind user anything from the source.

**Worktree.** If `quorum-state get worktree` prints a path and `quorum-active-task --code` prints another, the
task's code is in its own git worktree: call `EnterWorktree` with that `path` first, so you and the agents you start
work there. In a worktree, run one simple command per Bash call, with no `&&`, pipes into `bash` or `python`, or
variables in a git command: Claude Code refuses a command it can't show stays inside the worktree.

Don't run git commands that change the working tree, index, or history here (`stash`, `reset`, `checkout`, `commit`,
`rebase`); agents make the commits. Read-only git (`diff`, `log`, `status`, `show`) is fine.

**Models.** Before the first agent, resolve both of the task's model choices as in
`<plugin root>/skills/pipeline-laws/models.md` (configured defaults: `reviewer_model` = <reviewer_model>, `helper_model` = <helper_model>) (`--models` in `<arguments>`
asks again). Start the security reviewer and the a11y auditor with `reviewer_model` and the friction triager with
`helper_model`; the blind user and the prover run on the session's model.

**Reports.** Where a step says `Report file: <path>`, a hook saves that agent's report there, so you don't retype
it. Before you start the agent, `rm -f <path>`. Make `Report file: <path>` the last line of its prompt, on a line of
its own with nothing before it and the path bare (no backticks or quotes, and no `//`); the path is the relative one
you would save to yourself, under `.tasks/` of the folder you work in (the main working tree, or the task's own
worktree). Just before it, on a line of its own, put these words as they are: "A hook saves your final reply to the
file named on the next line. Don't write that file and don't mention it: reply with the report alone, with no note
about saving it and no code fence around the whole report." The two lines go together: a step that names a prompt's
`Report file:` line means both. The hook runs a second or two after the report reaches you, so when the agent has
handed back, wait for the file to be there and not empty: check `test -s <path>` about once a second, for up to 10
seconds. If it still isn't (an older Claude Code, or the hook is off), save the reply verbatim to that path
yourself. An agent you ask again without starting it anew saves over the same file: remove the file before you ask,
and wait the same way.

## 0. Preconditions

A MEDIUM or HIGH task comes here twice: for the **early run**, after the build and before review round 1, and for
the **later run**, after the review converges. The status (`quorum-state get status`) says which:

- `CONVERGED`: the later run, below.
- `BUILDING`: the early run. It needs all of: `base_sha` set (`quorum-state get base_sha`); a MEDIUM or HIGH risk
  (`quorum-state get risk`); `quorum-state get fast` not `true`; and the build finished: `quorum-plan sliced` fails
  (one builder built the whole plan), or `quorum-plan next` prints nothing (every step of a sliced plan is built).
  When all of them hold, follow "Early run (from `BUILDING`)" below, and nothing else in this section.
- Anything else, or a `BUILDING` task without one of those: say which command comes next and stop.

The later run:

- Risk (`quorum-state get risk`): LOW tasks don't get a blind test; their summary came from `/quorum:review-loop`.
- **Skipping the blind user.** Skip it only when all of these hold: `quorum-state get early_blind` is `clean`;
  `git diff --name-only <early_blind_sha>..HEAD` succeeds and every path it prints is a test path (it may print
  none); and the task is not a UI change (section 2, sub-step 6's test). A test path has a directory named `test`,
  `tests`, `__tests__`, `e2e`, `cypress` or `spec`, or a file whose name holds `.test.` or `.spec.` or ends in
  `.bats`; Markdown is never a test path. Otherwise set the status, count the run, and go on as below.
- **A skipped run is not counted.** Leave the status `CONVERGED` and `blind_runs` as they are: don't set
  `BLIND-TEST`, and skip sections 2 and 3. `quorum-state log` a block `## Blind test skipped` saying why (the sha
  and the number of paths). Run the security pass where section 1 asks for one, with this in place of section 1's
  line: Report file: `.tasks/<slug>/blind/security-skipped.md`. If it has an `[IMPORTANT]`, push each to
  `pending_findings` in section 4's line format, `quorum-state set status IN_REVIEW`, and say
  `/quorum:review-loop` is next; section 4's halt doesn't apply, since no run was counted. If it has none, go to
  the summary (section 5).
- `quorum-state set status BLIND-TEST`. Keep this run's files in `.tasks/<slug>/blind/`, numbered by run
  (`run=$(quorum-state incr blind_runs)`).

## Early run (from `BUILDING`)

The blind user tries the goal before any reviewer reads the code, so review round 1 reads a change that already
works. This run never halts the task and prints no summary.

1. Don't set `BLIND-TEST` and don't touch `blind_runs`: the status stays `BUILDING` until the last sub-step, and
   `blind_runs` counts only the later runs. `<n>` is one more than the number of `.tasks/<slug>/blind/early-[0-9]*.md`
   files (the triage files, `early-triage-<n>.md`, are not counted).
   **A left-over blind marker.** If `.tasks/<slug>/.blind-mode-active` is there, a blind test of this task was cut
   off: `rm -f .tasks/<slug>/.blind-mode-active`, stop any server it left running, and say so in one line. While it
   is there the source guard keeps this session and its agents from reading the code. If you know a blind test of
   this task is running in another session right now, leave the marker and stop instead: two stages can't work on
   one task at once.
2. Skip the security pass (section 1) and the live accessibility pass (section 2, sub-step 6): both read the
   reviewed code, so they wait for the later run.
3. Run section 2's sub-steps 1 to 5 and 7, with the server log in `blind/server-early-<n>.log` and, in place of
   sub-step 4's line, Report file: `.tasks/<slug>/blind/early-<n>.md`.
4. Run the triage (section 3) on that report: its prompt names `.tasks/<slug>/blind/early-<n>.md` as the blind
   report, and in place of section 3's line, Report file: `.tasks/<slug>/blind/early-triage-<n>.md`.
5. Push every `BLOCKER:` line of the report and every `CAUSED` item of the triage to `pending_findings`, one line
   each, in section 4's line format. Nothing else of section 4 applies: a blocked early run never counts toward its
   halt.
6. `quorum-state set early_blind_sha <git rev-parse HEAD>`. Then `quorum-state set early_blind clean` only when
   nothing was pushed and the blind user returned a report (`blind/early-<n>.md` is there, not empty, and has a
   `Result:` line); otherwise `quorum-state set early_blind blocked`. A blind user that crashed or returned nothing
   gives `blocked` with nothing pushed, so the later blind user runs.
7. `quorum-state log` a block `## Early blind test <n>` with the result, the blockers and the triage counts, and
   the line `quorum-files record` printed to stderr, if it printed one.
8. `quorum-state set status IN_REVIEW`, and say the next step is `/quorum:review-loop`: it fixes what was pushed
   first, and its round 1 reviews the build and that fix together.

## 1. Security pass

Run it when the risk is HIGH, or MEDIUM and `<security_on_medium>` is `true` (if that reads as a
placeholder, it's off). Start `quorum:security-reviewer` with:

> Task `<slug>`. Review the diff range `<base_sha>..HEAD` for exploitable vulnerabilities. Read `REVIEW.md`,
> `CLAUDE.md`, and `.tasks/<slug>/rd.md` first.

Report file: `.tasks/<slug>/blind/security-<run>.md`. Every finding in it blocks.

## 2. Blind test

1. Read the **user goal for the blind test** from `rd.md` and the dev/start command and entry point from
   `CLAUDE.md`. If `rd.md` has no goal, write one from the requirements: one sentence, what a user would try.
2. Run `quorum-files record`, then turn on blind mode: `touch .tasks/<slug>/.blind-mode-active`. It blinds this
   task's sessions only, so other tasks' work goes on. Whatever happens next, remove it at the end (sub-step 5 below).
3. If the app is a server, start it in the background with its dev command, logging to `blind/server-<run>.log`,
   and wait until it answers. Use local, temporary, or synthetic data only; never production or shared databases.
   A CLI needs no start.
4. Start `quorum:blind-user` with only this, and its `Report file:` line (no file names from the source, no hints about the implementation):

   > Goal: <goal>. Start here: <URL or command>. You're a first-time user; reach the goal through the app.

   Report file: `.tasks/<slug>/blind/blind-<run>.md`.
5. Turn off blind mode: `rm -f .tasks/<slug>/.blind-mode-active`. Do this even if the blind user failed or errored.
6. **Accessibility, for UI changes** (`rd.md` says "UI change: yes", or `git diff --name-only <base_sha>..HEAD`
   changes markup, components, or styles). With the app still running, start `quorum:a11y-auditor`:

   > Mode: live. Task `<slug>`. Start here: <URL>. Check the screens in this goal: <goal>. Read `CLAUDE.md`,
   > `REVIEW.md`, and `.tasks/<slug>/rd.md` first.

   Report file: `.tasks/<slug>/blind/a11y-<run>.md`. A CLI-only change skips this step.
7. **Tear down, always:** stop the server if you started one, and check `.tasks/<slug>/.blind-mode-active` is gone.

## 3. Triage friction

If the blind report has any `FRICTION:` lines, start `quorum:friction-triager`:

> Task `<slug>`. Diff range `<base_sha>..HEAD`. Blind report: `.tasks/<slug>/blind/blind-<run>.md`. Sort every
> friction item and draft follow-ups.

Report file: `.tasks/<slug>/blind/triage-<run>.md`.

## 4. Route

Collect the blocking problems: every `[IMPORTANT]` from the security pass and the accessibility pass, every
`BLOCKER:` line from the blind test, and every `CAUSED` item from the triage. Other friction doesn't block.

- **None:** go to the summary (step 5).
- **Some, and `blind_runs` is 1:** push each one to `pending_findings` as one line, for example
  `quorum-state push pending_findings "[IMPORTANT] blind test: export data/empty.json — Pattern Category: User-facing failure — printed a traceback; expected a header row"`.
  Then `quorum-state set status IN_REVIEW` and tell the user to run `/quorum:review-loop`, which fixes them
  first, reviews the fix, and returns here.
- **Some, and `blind_runs` is 2 or more:** the fixes aren't converging. `quorum-state set status HALTED`,
  `quorum-active-task --clear`, and `quorum-state log` a post-mortem, under the heading `## Post-mortem`, with two
  redesign options, as
  `/quorum:review-loop` does. Tell the user to run `/quorum:spec-and-eval --redesign <slug>`.

`quorum-state log` a short block for this run either way: the security and accessibility summary lines, the blind
test result, the blockers, the triage counts, and the line `quorum-files record` printed to stderr, if it printed one.

## 5. Stage 8 summary

1. **Verification proof:** first `quorum-files record` (show the line it printed to stderr, if it printed one), then
   start `quorum:prover` with:

   > Final proof. Task `<slug>`. Base commit `<quorum-state get base_sha>`. Run `bash .claude/hooks/verify-completion.sh`
   > and every row in `.tasks/<slug>/eval.md`, then give each requirement in `.tasks/<slug>/rd.md` a verdict. Read
   > `CLAUDE.md` first.

   Report file: `.tasks/<slug>/proof-final.md`, and show it. `quorum-state` refuses `READY` and `AWAITING-HUMAN`
   without this file, at HEAD, with no failed check and every requirement MET, so see that it is saved before setting the status. If a requirement's verdict is
   PARTIAL, MISSING, or CONTRADICTS, it goes back to the review loop: push each to `pending_findings` as one line,
   `[IMPORTANT] <its file:line, or .tasks/<slug>/rd.md> — Pattern Category: Unmet requirement — requirement <n>:
   <the evidence>`, then `quorum-state set status IN_REVIEW`. The loop fixes it first and reviews the fix, under its
   round cap. If
   anything else fails, say so and stop without changing the status.
2. **Risk tier**, the review rounds, and the blind-test runs.
3. **Rollback plan:** the one step from `rd.md`.
4. **Changes:** `git diff --stat <base_sha>..HEAD` and `git log --oneline <base_sha>..HEAD`.
5. **Verdict:** "Waiting for your review." Name the files most worth a human's time and why. For HIGH, say an
   architectural sign-off is required.
6. To consider separately: the proof's **Unrequested** code, the triage's RELATED and DATA-GAP items with its follow-up drafts (offer to file
   them where the user tracks work, and file nothing without a yes), the accessibility pass's "Needs a human"
   list, and non-blocking review findings.

After a skipped run the blind report is `blind/early-<n>.md` and the triage is `blind/early-triage-<n>.md`, `<n>` the
newest early run: item 2 says the later blind user was skipped and names that report, and item 6 takes the RELATED
and DATA-GAP items and the follow-up drafts from that triage (it exists only when the early report had `FRICTION:`
lines).

Then `quorum-state set status AWAITING-HUMAN` and `quorum-active-task --clear`. Suggest lessons, then
`/quorum:pr-draft`.

**Lessons.** Only suggest them: `/quorum:codify-lesson` asks the user before it writes a rule.

- If an earlier blind run found blockers (its `blind-<n>.md`, `security-<n>.md`, `a11y-<n>.md`, and `triage-<n>.md`),
  every reviewer missed them. For each one a reviewer could have caught from the diff, suggest a lesson.
  An early run's blockers (`early-<n>.md`, `early-triage-<n>.md`) were found before any review, so no reviewer
  missed them: suggest no lesson for those.
- Run `quorum-lessons <slug>` again: the fixes may have kept a Pattern Category the review loop kept before.
- Leave out any that `quorum-learned-rule list` already covers, or that the review loop already suggested.

Give each one a line: what was missed, and `/quorum:codify-lesson <what went wrong, in a few words>`.
