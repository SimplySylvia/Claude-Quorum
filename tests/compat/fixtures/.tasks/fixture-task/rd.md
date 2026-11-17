# Report totals

- **Slug:** `fixture-task`
- **Risk tier:** MEDIUM. It changes a report other code reads.
- **UI change:** no

## Goal
<!-- One or two sentences: what the user can do after this change that they couldn't before. -->
A user can get the total of a report's rows.

## Requirements
<!-- Numbered, testable statements. Each one should map to a check in eval.md. For a new feature, docs to create
     or update are requirements too, starting with **Docs:** and naming the file. -->
1. `app/report.py`'s `total(rows)` returns the sum of the rows, and 0 for no rows.
2. **Docs:** `README.md` says how to get a report's total.

## Non-goals
<!-- What this task deliberately does not do, so reviewers don't flag it as missing. -->
- Totals of non-numeric rows.

## Rollback plan (one step)
<!-- The single action that undoes this change, e.g. "Revert the merge commit", "Turn off flag X". -->
Revert the merge commit.

## User goal for the blind test
<!-- MEDIUM and HIGH only: one sentence a first-time user would try, and where they start (URL or command). -->
Print the total of three rows, starting from `python3 -c 'import app.report'`.
