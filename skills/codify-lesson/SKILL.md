---
name: codify-lesson
description: Turn a repeated bug, a false alarm, or a user correction into the cheapest thing that stops it coming back, so future Quorum builds and reviews don't repeat it. Proposes, in order, a regression test, a lint rule, a pattern rule a hook enforces during tasks, or a one-line rule in REVIEW.md (or ~/.claude/CLAUDE.md for lessons that apply everywhere), and writes only after you confirm. With --audit, proposes retiring learned rules that no review has cited in months.
disable-model-invocation: true
argument-hint: "[what went wrong] | --audit [--days N]"
---

# Codify a lesson

A lesson is only learned once it changes what the next build or review does, and the surest change is one a
machine checks. Work from the repo root. With `--audit`, go to [Audit](#audit).

## 1. Find the lesson

Use `$ARGUMENTS` if the user described it. Otherwise look at the most recent task or review: the active task, or
the folder in `.tasks/` whose `state.md` changed last. A folder whose `state.md` says `kind: review` is a standalone
review (`/quorum:review`); see [From a review](#from-a-review).

Start with `quorum-lessons <slug or review id>`: it lists each Pattern Category the voter kept in more than one
round or run (`repeat`), or that another task or review kept too (`elsewhere`). Then look at:

- `state.md`'s round log, and `.tasks/<slug>/review/round-*/survivors.md` (kept findings): a **Pattern Category** that came back
  in more than one round, or that the builder had to fix in several places.
- `## Dropped` sections in `votes.md` (the voter's full reply): the **same false alarm** dropped more than once, by the same reason.
- `.tasks/<slug>/blind/`: a blocker a reviewer should have caught.
- Corrections the user made in this conversation.

### From a review

A standalone review keeps each run's files in `.tasks/review-<id>/run-<N>/`, named as a task's round files are, and
`state.md`'s log has a block per run. Look for:

- `survivors.md` across runs: a **Pattern Category** that came back in more than one run, or in this review and a
  task.
- `## Dropped` sections in `votes.md`: the **same false alarm** dropped more than once.
- A kept finding the user says is wrong (in this conversation, or a reply on the PR they paste): a false alarm the
  voter let through. The rule says what not to flag, and why.

A review has no `rd.md`, so check the lesson against the code the range touched (`quorum-state --task <id> get
range`), not a spec.

If nothing qualifies, say so and stop. Don't invent a lesson.

## 2. Choose the cheapest form that stops it

Go down this list and stop at the first that would catch the lesson every time. A check that runs doesn't depend
on a reviewer remembering a sentence.

1. **A regression test,** when the lesson is a bug that came back or a behavior that broke: a test in the repo's
   suite that fails if it happens again. Write the test's name, file, and what it asserts.
2. **A lint rule,** when the repo's linter can express it (a banned import or call, a required pattern): the exact
   rule and the config file it goes in.
3. **A pattern rule,** when it's a pattern in new code that a regular expression can spot in the files it applies
   to, and the linter can't (for example joining CSV fields by hand in `app/`): a glob, an extended regex, and the
   message to show. A hook blocks it while a task builds or is in review.
4. **A rule in `REVIEW.md` section 6,** when it takes judgment (most false alarms are this: "don't flag X, because
   Y handles it"). Every reviewer and the voter read it. Write one declarative line: what to do or not do, specific
   to this code, checkable by a reviewer. For example:
   - "All CSV output goes through `write_csv()` in `app/report.py`; never join fields with commas by hand."
   - "Missing-file errors in CLI commands are reported as one line on stderr with exit 1, never a traceback."
   - "Don't flag `load()` for missing error handling: `main()` handles `OSError` for every command."
5. **Only for a lesson that applies to every project you work on,** a line in `~/.claude/CLAUDE.md`. That file is
   the user's.

Check it isn't already there: `quorum-learned-rule list` and `quorum-learned-rule pattern list`.

## 3. Propose one

Show the user the form you chose, why the cheaper ones won't do, and the exact text: the test, the lint rule, the
pattern (glob, regex, message), or the line.

## 4. Confirm, then write

Show the user the rule and where it would go, and ask. **Never write without a yes**, even if they passed `--yes`
to another command.

- **A test or a lint rule** changes the repo's code, so it's a change of its own, with its checks: say to run
  `/quorum:run --fast <the test or the rule>` (it's a LOW task), and don't write it in this skill.
- **A pattern rule:** `quorum-learned-rule pattern add "<glob>" "<regex>" "<message>" "<slug or review id>, <YYYY-MM-DD>"`.
  Exit 3 means it's already there. Show `quorum-learned-rule pattern list` after.
- **A project rule:** `quorum-learned-rule add "<rule>" "<slug or review id>, <YYYY-MM-DD>"`. Exit 3 means it's
  already there.
- Universal rule: append it to `~/.claude/CLAUDE.md` only after a separate yes for that file.

Show the line as written. If the user declines, write nothing.

## Audit

A rule nobody cites any more costs every reviewer's attention for nothing. With `--audit`:

1. `quorum-learned-rule audit` (add `--days N` if the user gave one; the default is 90). Each line is a rule, the
   date it was added, the last time a review or a vote quoted it (`learned rule: "..."`), and `stale` or `kept`.
2. If nothing is stale, say so and stop.
3. For each stale rule, check before proposing: does the code it guards still exist, and has it a test or lint
   rule now? Show the stale rules with what you found, and ask which to remove (AskUserQuestion, one option per
   rule, any number). A rule the user keeps stays as it is.
4. Remove each one they choose with `quorum-learned-rule remove "<rule>"`, and show what was removed. Remove
   nothing without a yes.
