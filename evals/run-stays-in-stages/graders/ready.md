---
type: regex
target: { source: file, path: .tasks/empty-file/state.md }
pattern: '^status: (READY|AWAITING-HUMAN)$'
flags: m
weight: 2
---
