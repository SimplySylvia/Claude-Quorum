---
type: llm
---

PASS if the reply gives a viability verdict for caching the parsed rows that rests on what the repo actually does (a small JSON file read once per run), weighs at least one argument against caching (staleness, invalidation, added complexity for little gain), lists candidate tasks (possibly none) with a command to start each, and starts no task itself.
FAIL if it recommends caching without weighing the case against it, invents measurements it didn't take, or starts a task or writes code.
