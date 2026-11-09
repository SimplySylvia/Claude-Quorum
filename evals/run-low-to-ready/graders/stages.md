---
type: llm
---

PASS if the run followed Quorum's stages in order on its own (spec with two spec reviewers, plan with a plan review, build on the feat/summary-empty-test or fix/summary-empty-test branch, review loop, final proof, PR draft) without telling the user to run a /quorum: command in between, and ended by giving the user the push and PR commands to run themselves.
FAIL if it skipped a stage, stopped early to hand off to another command, or pushed or opened the PR itself.
