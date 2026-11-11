#!/usr/bin/env bash
# An approved LOW task whose plan has four steps, ready for /quorum:build.
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export LOW BUILDING
bin="$(cd "$(dirname "$0")/../.." && pwd)/bin"
"$bin/quorum-state" --task csv-export set plan_approved 2026-11-11
"$bin/quorum-state" --task csv-export set reviewer_model inherit
"$bin/quorum-state" --task csv-export set helper_model inherit
cat > .tasks/csv-export/plan.md <<'MD'
# Plan: CSV export

- **Slug:** `csv-export`
- **Risk tier:** LOW
- **Approach:** A write_csv() helper on the stdlib csv module, an export command that uses it, its tests, and the
  usage line.

## Steps
1. **Add `write_csv(rows, out)`** — `app/report.py` · requirements: 1
   - Writes a `region,customer,amount` header, then one row per input row, with `csv.writer(out, lineterminator="\r\n")`.
   - Reuses: `app/report.py:8` load() for reading; new: nothing in the app writes CSV yet.
2. **Add the `export` command** — `app/report.py` · requirements: 1
   - In `main()`, `export [DATA_FILE]` calls `write_csv(load(path), sys.stdout)` and returns 0, after the `summary` branch.
3. **Test the export** — `tests/test_report.py` · requirements: 1
   - `ExportTest.test_rows_round_trip`: `write_csv` on two rows, one with a comma in the customer, read back with `csv.reader`, gives the header and both rows.
4. **Update the usage line** — `app/report.py` · requirements: 1 · mechanical
   - The usage string becomes `usage: report.py {summary,export} [DATA_FILE]`.

## Tests
| Requirement | Test (file and name) | What it asserts | Why it fails without the change |
|---|---|---|---|
| 1 | `tests/test_report.py` `ExportTest.test_rows_round_trip` | the header and rows read back intact | there's no `write_csv` |

## Docs
- None: the usage line is the command's only docs.

## Accessibility
Not applicable (no UI change).

## Lessons
- None apply

## Checks changes
- None

## Security
Not applicable.

## Requirement coverage
| Requirement | Steps | Tests or eval.md rows |
|---|---|---|
| 1 | 1, 2, 3, 4 | `ExportTest.test_rows_round_trip`; eval row 1 |

## Risks and open questions
- None

## Deviations
MD
