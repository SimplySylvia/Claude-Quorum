# Eval: {{TITLE}}

Every check here must be runnable and must pass before the task is done. Use local, temporary, or synthetic data
only; never production or shared databases, and never real credentials.

## Fast checks
Run by the Stop hook on each finish, unless nothing they depend on has changed since they last passed: `bash .claude/hooks/verify-completion.sh`.

## Task checks
<!-- One row per requirement in rd.md: the exact command, and what passing looks like. For a slow row (a full
suite), start its Passes when with `Final proof only.`: the build proof skips it, and the final proof runs it. -->
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | | | |

## Edge cases
<!-- Inputs that commonly break this kind of change: empty, very large, unicode, concurrent, permission denied. -->
-
