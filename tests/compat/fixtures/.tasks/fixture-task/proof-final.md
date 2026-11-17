Proof: fixture-task at 1234567
Result: ALL PASS

| # | Check | Result | Evidence |
|---|---|---|---|
| fast | bash .claude/hooks/verify-completion.sh | PASS | "All checks passed." |
| 1 | python3 -c 'from app.report import total; print(total([1, 2, 3]), total([]))' | PASS | "6 0" |
| 2 | grep -n 'total' README.md | PASS | "3:Call total(rows) for a report's total." |

## Requirements
| Req | Verdict | Evidence |
|---|---|---|
| 1 | MET | row 1 passes; `app/report.py:1` total() returns sum(rows) |
| 2 | MET | row 2 passes; `README.md:3` says how to get a report's total |

Unrequested: none

Working tree unchanged: yes
