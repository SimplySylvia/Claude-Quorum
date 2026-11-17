# Eval: Report totals

Every check here must be runnable and must pass before the task is done. Use local, temporary, or synthetic data
only; never production or shared databases, and never real credentials.

## Fast checks
Run by the Stop hook on every finish: `bash .claude/hooks/verify-completion.sh`.

## Task checks
<!-- One row per requirement in rd.md: the exact command, and what passing looks like. -->
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | 1. Sum of rows | `python3 -c 'from app.report import total; print(total([1, 2, 3]), total([]))'` | Prints `6 0` |
| 2 | 2. Docs | `grep -n 'total' README.md` | Prints a line that says how to get a report's total |

## Edge cases
<!-- Inputs that commonly break this kind of change: empty, very large, unicode, concurrent, permission denied. -->
- No rows: the total is 0.
