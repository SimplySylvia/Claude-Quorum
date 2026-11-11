---
type: llm
---

PASS if the final reply says the task couldn't use its own git worktree because this host has no EnterWorktree tool, and that it was built in this working tree instead; reports the task READY with a passing proof and a drafted PR; and ends with the push and PR commands for the user to run, without having pushed or opened the PR.
FAIL if the reply doesn't say why the task wasn't built in its own worktree, reports a git or xcode-select error from making the worktree, says it skipped one of Quorum's stages (spec, plan, build, review loop, final proof, PR draft) rather than a step the rules let it skip, such as a vote with no findings, or says it pushed or opened the PR.
