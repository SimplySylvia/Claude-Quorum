---
name: codify-lesson
description: Turn a repeated bug, a false alarm, or a user correction into one permanent rule, so future Quorum reviews and builds don't repeat it. Proposes a single one-line rule for this repo's REVIEW.md (or, for lessons that apply everywhere, your ~/.claude/CLAUDE.md) and writes it only after you confirm.
disable-model-invocation: true
argument-hint: "[what went wrong]"
---

# Codify a lesson

A lesson is only learned once it changes what the next review checks. Work from the repo root.

## 1. Find the lesson

Use `$ARGUMENTS` if the user described it. Otherwise look at the most recent task or review: the active task, or
the folder in `.tasks/` whose `state.md` changed last. A folder whose `state.md` says `kind: review` is a standalone
review (`/quorum:review`); see [From a review](#from-a-review).

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

## 2. Choose where it belongs

- **Project rule (default):** something true of this repo. It goes in `REVIEW.md` section 6, where every
  reviewer and the voter read it.
- **A check instead of a rule:** if a linter rule, a test, or a `CLAUDE.md` fix would catch it mechanically, say
  so and propose that change instead; a machine check beats a sentence. Don't make the change in this skill.
- **Universal rule:** only if it applies to every project you work on, offer `~/.claude/CLAUDE.md`. Show the user
  the exact line and the file; it's theirs.

## 3. Propose one rule

Write **one** declarative line: what to do or not do, specific to this code, checkable by a reviewer. For example:

- "All CSV output goes through `write_csv()` in `app/report.py`; never join fields with commas by hand."
- "Missing-file errors in CLI commands are reported as one line on stderr with exit 1, never a traceback."
- "Don't flag `load()` for missing error handling: `main()` handles `OSError` for every command."

Check it isn't already there: `quorum-learned-rule list`.

## 4. Confirm, then write

Show the user the rule and where it would go, and ask. **Never write without a yes**, even if they passed `--yes`
to another command.

- Project rule: `quorum-learned-rule add "<rule>" "<slug or review id>, <YYYY-MM-DD>"`. Exit 3 means it's already
  there.
- Universal rule: append it to `~/.claude/CLAUDE.md` only after a separate yes for that file.

Show the line as written. If the user declines, write nothing.
