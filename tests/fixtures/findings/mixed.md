Summary: 2 IMPORTANT, 3 NIT, 1 PRE-EXISTING

[IMPORTANT] app/report.py:42 — Pattern Category: Unescaped CSV fields
Mechanism: a customer with a comma splits into two columns.
Fix: quote fields.

[NIT] app/report.py:10 — rename x
[NIT] app/report.py:11 — docstring
[NIT] app/report.py:12 — spacing

[IMPORTANT] app/report.py:60 — Pattern Category: Unescaped CSV fields
Mechanism: quotes inside a field aren't doubled.

[PRE-EXISTING] app/report.py:3 — load() never closes on error

## Dropped
DROP [IMPORTANT] app/report.py:5 — (b) handled by the caller
