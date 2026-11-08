---
type: regex
target: { source: file, path: app/report.py }
pattern: 'load\(DEFAULT_DATA\)'
match: not_contains
---
