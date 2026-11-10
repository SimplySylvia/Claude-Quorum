<!-- The steps of /quorum:blind-test, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Security pass and blind test

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

Work on the active task (`quorum-active-task`) from the repo root. You orchestrate: you don't test the app or
review the code yourself, and you never give the blind user anything from the source.

Don't run git commands that change the working tree, index, or history here (`stash`, `reset`, `checkout`, `commit`,
`rebase`); agents make the commits. Read-only git (`diff`, `log`, `status`, `show`) is fine.

**Models.** Before the first agent, resolve both of the task's model choices as in
`<plugin root>/skills/pipeline-laws/models.md` (configured defaults: `reviewer_model` = <reviewer_model>, `helper_model` = <helper_model>) (`--models` in `<arguments>`
asks again). Start the security reviewer and the a11y auditor with `reviewer_model` and the friction triager with
`helper_model`; the blind user and the prover run on the session's model.

## 0. Preconditions

- Status must be `CONVERGED`. Otherwise say which command comes next and stop.
- Risk (`quorum-state get risk`): LOW tasks don't get a blind test; their summary came from `/quorum:review-loop`.
- `quorum-state set status BLIND-TEST`. Keep this run's files in `.tasks/<slug>/blind/`, numbered by run
  (`run=$(quorum-state incr blind_runs)`).

## 1. Security pass

Run it when the risk is HIGH, or MEDIUM and `<security_on_medium>` is `true` (if that reads as a
placeholder, it's off). Start `quorum:security-reviewer` with:

> Task `<slug>`. Review the diff range `<base_sha>..HEAD` for exploitable vulnerabilities. Read `REVIEW.md`,
> `CLAUDE.md`, and `.tasks/<slug>/rd.md` first.

Save its reply verbatim to `blind/security-<run>.md`. Every finding in it blocks.

## 2. Blind test

1. Read the **user goal for the blind test** from `rd.md` and the dev/start command and entry point from
   `CLAUDE.md`. If `rd.md` has no goal, write one from the requirements: one sentence, what a user would try.
2. Turn on blind mode: `touch .tasks/.blind-mode-active`. Whatever happens next, remove it at the end (sub-step 5 below).
3. If the app is a server, start it in the background with its dev command, logging to `blind/server-<run>.log`,
   and wait until it answers. Use local, temporary, or synthetic data only; never production or shared databases.
   A CLI needs no start.
4. Start `quorum:blind-user` with only this (no file names from the source, no hints about the implementation):

   > Goal: <goal>. Start here: <URL or command>. You're a first-time user; reach the goal through the app.

   Save its report verbatim to `blind/blind-<run>.md`.
5. Turn off blind mode: `rm -f .tasks/.blind-mode-active`. Do this even if the blind user failed or errored.
6. **Accessibility, for UI changes** (`rd.md` says "UI change: yes", or `git diff --name-only <base_sha>..HEAD`
   changes markup, components, or styles). With the app still running, start `quorum:a11y-auditor`:

   > Mode: live. Task `<slug>`. Start here: <URL>. Check the screens in this goal: <goal>. Read `CLAUDE.md`,
   > `REVIEW.md`, and `.tasks/<slug>/rd.md` first.

   Save its reply verbatim to `blind/a11y-<run>.md`. A CLI-only change skips this step.
7. **Tear down, always:** stop the server if you started one, and check `.tasks/.blind-mode-active` is gone.

## 3. Triage friction

If the blind report has any `FRICTION:` lines, start `quorum:friction-triager`:

> Task `<slug>`. Diff range `<base_sha>..HEAD`. Blind report: `.tasks/<slug>/blind/blind-<run>.md`. Sort every
> friction item and draft follow-ups.

Save its reply verbatim to `blind/triage-<run>.md`.

## 4. Route

Collect the blocking problems: every `[IMPORTANT]` from the security pass and the accessibility pass, every
`BLOCKER:` line from the blind test, and every `CAUSED` item from the triage. Other friction doesn't block.

- **None:** go to the summary (step 5).
- **Some, and `blind_runs` is 1:** push each one to `pending_findings` as one line, for example
  `quorum-state push pending_findings "[IMPORTANT] blind test: export data/empty.json — Pattern Category: User-facing failure — printed a traceback; expected a header row"`.
  Then `quorum-state set status IN_REVIEW` and tell the user to run `/quorum:review-loop`, which fixes them
  first, reviews the fix, and returns here.
- **Some, and `blind_runs` is 2 or more:** the fixes aren't converging. `quorum-state set status HALTED`,
  `quorum-active-task --clear`, and `quorum-state log` a post-mortem with two redesign options, as
  `/quorum:review-loop` does. Tell the user to run `/quorum:spec-and-eval --redesign <slug>`.

`quorum-state log` a short block for this run either way: the security and accessibility summary lines, the blind
test result, the blockers, and the triage counts.

## 5. Stage 8 summary

1. **Verification proof:** start `quorum:prover` on all of `eval.md` (as in `/quorum:build` step 4), save its reply
   verbatim to `.tasks/<slug>/proof-final.md`, and show it. `quorum-state` refuses `READY` and `AWAITING-HUMAN`
   without this file, at HEAD, with no failed check, so save it before setting the status. If anything fails, say so
   and stop without changing the status.
2. **Risk tier**, the review rounds, and the blind-test runs.
3. **Rollback plan:** the one step from `rd.md`.
4. **Changes:** `git diff --stat <base_sha>..HEAD` and `git log --oneline <base_sha>..HEAD`.
5. **Verdict:** "Waiting for your review." Name the files most worth a human's time and why. For HIGH, say an
   architectural sign-off is required.
6. To consider separately: the triage's RELATED and DATA-GAP items with its follow-up drafts (offer to file
   them where the user tracks work, and file nothing without a yes), the accessibility pass's "Needs a human"
   list, and non-blocking review findings.

Then `quorum-state set status AWAITING-HUMAN` and `quorum-active-task --clear`. Suggest lessons, then
`/quorum:pr-draft`.

**Lessons.** Only suggest them: `/quorum:codify-lesson` asks the user before it writes a rule.

- If an earlier blind run found blockers (its `blind-<n>.md`, `security-<n>.md`, `a11y-<n>.md`, and `triage-<n>.md`),
  every reviewer missed them. For each one a reviewer could have caught from the diff, suggest a lesson.
- Run `quorum-lessons <slug>` again: the fixes may have kept a Pattern Category the review loop kept before.
- Leave out any that `quorum-learned-rule list` already covers, or that the review loop already suggested.

Give each one a line: what was missed, and `/quorum:codify-lesson <what went wrong, in a few words>`.
