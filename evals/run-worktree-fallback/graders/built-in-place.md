---
type: regex
target: { source: file, path: .git/HEAD }
pattern: '^ref: refs/heads/(feat|fix)/load-test$'
flags: m
---
