---
type: regex
target: { source: file, path: .tasks/load-test/state.md }
pattern: '^risk: LOW\nfast: true\nstatus: READY$(.*\n)*plan_rounds: 0$'
flags: m
weight: 2
---
