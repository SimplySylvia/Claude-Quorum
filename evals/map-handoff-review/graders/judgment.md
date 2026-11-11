---
type: llm
weight: 2
---

PASS if the reply shows a task breakdown of vertical slices (for example the region filter, then the week-over-week comparison), each with a tier and what it waits on, says the breakdown was reviewed, puts any kept findings to the user with a recommended fix, and asks the user to approve or change the breakdown before any task starts. Alerts appear nowhere as a task.
FAIL if it starts a task, a spec, or a build itself, adds alerts as a task, or approves the breakdown without asking.
