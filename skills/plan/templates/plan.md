# Plan: {{TITLE}}

- **Slug:** `{{SLUG}}`
- **Risk tier:** {{RISK}}
- **Approach:** <!-- One or two sentences, and the research option it follows, if there was research. -->

## Steps
<!-- In the order the builder should do them. One step per change; each names its files and requirements. A plan of
     4 or more steps is built a step at a time, so each step must leave the checks passing and stand on its own.
     End a step's line with "· mechanical" when it copies a named pattern or changes one fully specified file. -->
1. **<what changes>** — `path/to/file` · requirements: 1, 2
   - Reuses: `path:line` <!-- the existing helper, component, or pattern; or "new: <why nothing existing fits>" -->
   - Convention: <!-- the rule or precedent this follows, if a choice depends on one -->

## Tests
<!-- One row per requirement eval.md doesn't already check another way. -->
| Requirement | Test (file and name) | What it asserts | Why it fails without the change |
|---|---|---|---|
| 1 | | | |

## Docs
<!-- Each **Docs:** requirement, and each doc this change will make wrong. "None" with the reason if there are none. -->
- `path/to/doc.md` (section): <!-- what it will say -->

## Accessibility
<!-- UI work only; otherwise "Not applicable (no UI change)". One line per new or changed element. -->
- <!-- element: native element or role · label · keyboard · focus · how changes are announced -->

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
- <!-- input or actor · what they may do · where the check happens -->

## Requirement coverage
| Requirement | Steps | Tests or eval.md rows |
|---|---|---|
| 1 | | |

## Risks and open questions
-

## Deviations
<!-- The builder adds a line here, with the reason, for anything it builds differently from this plan. -->
