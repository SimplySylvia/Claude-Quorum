---
type: regex
target: { source: file, path: .tasks/summary-empty-test/state.md }
pattern: '^risk: LOW\n(.*\n)*status: READY$'
flags: m
weight: 2
---
