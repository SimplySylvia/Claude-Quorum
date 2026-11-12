---
type: regex
target: { source: file, path: tests/test_export.py }
pattern: 'self\.assertEqual\(rows\[1\], .east,"Acme, Inc\.",120.\)'
weight: 2
arm: both
---
