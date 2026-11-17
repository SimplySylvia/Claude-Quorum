# Plan: Report totals

- **Slug:** `fixture-task`
- **Risk tier:** MEDIUM
- **Approach:** Add `total(rows)` to `app/report.py` with Python's `sum`, and a README line.

## Steps
<!-- In the order the builder should do them. One step per change; each names its files and requirements. A plan of
     4 or more steps is built a step at a time, so each step must leave the checks passing and stand on its own.
     End a step's line with "· mechanical" when it copies a named pattern or changes one fully specified file. -->
1. **Add `total`** — `app/report.py` · requirements: 1
   - Reuses: new: the report has no totals yet
2. **Document it** — `README.md` · requirements: 2 · mechanical
   - Reuses: `README.md` (Usage)

## Tests
<!-- One row per requirement eval.md doesn't already check another way. -->
| Requirement | Test (file and name) | What it asserts | Why it fails without the change |
|---|---|---|---|
| 1 | eval.md row 1 | `6 0` | `total` doesn't exist |

## Docs
<!-- Each **Docs:** requirement, and each doc this change will make wrong. "None" with the reason if there are none. -->
- `README.md` (Usage): how to get a report's total.

## Accessibility
<!-- UI work only; otherwise "Not applicable (no UI change)". One line per new or changed element. -->
- Not applicable (no UI change)

## Lessons
<!-- From history.md and REVIEW.md section 6: each earlier failure or learned rule that this change could repeat,
     and the step that keeps it from happening. "None apply" if none do. -->
- None apply

## Checks changes
<!-- Files the Stop hook's checks depend on that this change must edit: .claude/hooks/verify-completion.sh, CI
     workflows, and test, lint, type-check, or format configs. While the task builds and is in review they're
     locked; approving this plan unlocks the ones listed here. "None" if there are none (the usual case). -->
- None

## Security
<!-- MEDIUM/HIGH work that takes input, crosses a trust boundary, or touches auth or data; otherwise "Not applicable". -->
- Not applicable

## Requirement coverage
| Requirement | Steps | Tests or eval.md rows |
|---|---|---|
| 1 | 1 | 1 |
| 2 | 2 | 2 |

## Risks and open questions
- None

## Deviations
<!-- The builder adds a line here, with the reason, for anything it builds differently from this plan. -->
