---
name: retro
description: Look back over a Quorum task, a map, a session, or every task since a date, and pull out what the next build should do differently. Reads the session logs (tool calls, failures, hook blocks, long searches) and Quorum's records (review rounds, false alarms, blind-test blockers, halts, plan deviations, reopened map decisions, research that changed nothing), ranks the improvements most severe first, and applies the ones you pick in the cheapest form that sticks, as /quorum:codify-lesson does. Writes only after you say yes.
disable-model-invocation: true
argument-hint: "[<task slug> | <map slug>] [--session [<id>]] [--since YYYY-MM-DD]"
---

# Retro

A retro improves the **environment** the next build runs in, not the code that just shipped: the checks, the
review rules, the pointers in `CLAUDE.md`, the commands, what agents can see, and Quorum's own settings. A mistake a
machine can catch becomes a check; a judgment call becomes a review rule; a long hunt becomes a pointer.
`/quorum:codify-lesson` turns one lesson into a rule. A retro looks over everything that happened, finds every
lesson worth having, and codifies the ones you pick.

The request: `$ARGUMENTS`. Work from the main working tree (`quorum-active-task --main`). Read
`${CLAUDE_PLUGIN_ROOT}/skills/codify-lesson/SKILL.md` before proposing anything: its ladder of forms and its rules
for writing each one are this skill's too.

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error, run it as `quorum-git`, on your PATH.

## 1. The scope

- **A task or a map slug:** that task (`.tasks/<slug>/`) or map (`.tasks/map-<slug>/`), and the sessions that worked
  on it: this one, plus any `--session` names.
- **`--session [<id>]`:** that session (this one, `${CLAUDE_SESSION_ID}`, without an id), and any task or map it
  worked on.
- **`--since YYYY-MM-DD`:** every task, review, and map whose `state.md` or `map.md` changed since then, and this
  project's sessions since then (`quorum-session list --since <date>`). For pulling the learnings of a stretch of
  work.
- **Nothing:** this session, and the active task or, failing that, the task whose `state.md` changed last.

Say what's in scope in one line before reading it.

## 2. Gather the evidence

Read the primary sources, not your memory of them. Quote no data from them in anything you write: no code, no
customer, patient, or personal data, no secrets. Describe what happened, and cite where (a file and line, or a
session and the tool that failed).

- **Sessions.** `quorum-session summary <id>` for each: calls per tool, the subagents started, failed calls and
  their first lines, hook blocks, files read again and again, and runs of searching with no edit. To find the user's
  corrections ("no", "that's wrong", "don't"), read the user messages in the log (`quorum-session path <id>`) and
  note each one in your own words.
- **Tasks.** `state.md` and its round log (halts, escalations, Stop-hook blocks, rounds used); `quorum-lessons
  <slug>`; each round's `survivors.md` and the `## Dropped` part of `votes.md`; `blind/triage-*.md` (CAUSED items);
  `plan.md`'s `## Deviations`; `spec-review/` and what changed after it; `research_decision`; the proofs' FAIL and
  SKIPPED rows.
- **Maps.** Reopened tickets (`## Earlier answer`), `review/*-feasibility.md`, `tasks-review/round-*/survivors.md`,
  and tasks whose spec had to argue with a decision.
- **Across the repo.** `quorum-lessons history <slug>`, `quorum-learned-rule audit`, `CLAUDE.md` and `REVIEW.md`,
  `.claude/hooks/verify-completion.sh` next to the checks the repo has (its `package.json` or build-tool scripts,
  its CI workflows), and earlier retros in `.tasks/retro-*/retro.md`.

## 3. Find the candidates

Look in each area. A candidate names what happened, the evidence, and the fix.

| Area | Signs | The fix, usually |
|---|---|---|
| **Checks** | A mistake a check would have caught; a check the repo has that `verify-completion.sh` doesn't run; a failure only the prover or the blind test found that a fast check could | Wire in the existing check, or a test or lint rule |
| **Review rules** | A Pattern Category kept in more than one round or task; the voter dropping the same false alarm again; a blind-test blocker every reviewer missed | A pattern rule if a regex can spot it, else a `REVIEW.md` rule |
| **Navigation** | Long search runs (`hunt`), files reread, the same question about where something lives | A one-line pointer in `CLAUDE.md` |
| **Steering** | A `CLAUDE.md` or `REVIEW.md` line ignored again and again (make it a check), one that a check now covers, one that restates any agent's defaults, a pointer to a file that's gone | Turn it into a check, or remove it |
| **Commands** | The same command failing more than once (a wrong name, a missing tool, a flag this machine lacks); a command in `CLAUDE.md`'s Verification Commands that doesn't work | Fix the command where it's written |
| **Tool economy** | Many calls for what one would do; a whole large file read to find one line; a slow suite run on every step | A pointer, a narrower command, or the slow suite moved to `eval.md` |
| **Information access** | Something the agent needed but couldn't see: the app's logs, a running service, a dashboard | A read-only way to reach it (teeing dev-server logs to a file, a read-only connector), for the user to set up |
| **The pipeline** | The round cap hit; a reviewer that never finds anything at this tier; research recorded as `confirmed` task after task; a map decision reopened because its ticket had the wrong type; hook blocks that were right but cost a round | A Quorum setting or a habit (`--no-research` for a kind of task, `security_on_medium`, typing tickets differently), shown with the command |

Mechanical mistakes (a banned call, a file in the wrong place, an import shape) get a check, never a sentence. Drop
a candidate an earlier retro proposed and the user declined, unless it has happened again since; then say so.
If nothing qualifies, say so and stop. Don't invent a lesson.

## 4. Rank and propose

Order the candidates by how much they cost and how likely they are to come back: a cause of a bug that shipped or a
blind-test blocker first, then a halt or an escalation, then a repeated round, then wasted time. Show them as one
numbered list, most severe first, each in three lines: what happened (with its evidence), the fix in its exact
form (the check line, the rule, the pointer, the command), and why a cheaper form won't do.

Then ask which to apply: AskUserQuestion, any number, at most 4 options per question (ask again for the rest).

## 5. Apply what's chosen

One at a time, the way `codify-lesson` step 4 says for its form: wire a check in and run it, add a pattern rule or a
`REVIEW.md` rule with `quorum-learned-rule`, add a pointer to `CLAUDE.md`. A test or a lint rule changes the code:
give the `/quorum:run --fast <...>` line for it instead. A setting or a connector the user sets up: give the exact
command or step. Never write without a yes, even if the user passed `--yes` to another command.

## 6. Save it

Write `.tasks/retro-<YYYY-MM-DD>/retro.md` (`-2`, `-3`, ... if one exists): the scope, each candidate with its
evidence and fix, and what the user chose, applied, or declined. The next retro reads it, so a declined idea isn't
proposed again for nothing. Then show what changed, and anything left for the user to do.
