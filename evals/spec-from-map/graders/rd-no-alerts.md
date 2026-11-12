---
type: regex
target: { source: file, path: .tasks/region-filter/rd.md }
pattern: '^## (Non-goals|Out of scope)\n(?:(?!## )[^\n]*\n)*[^\n]*alert'
flags: im
---
