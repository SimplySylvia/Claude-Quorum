---
type: llm
---

PASS if the run took the fast path on its own: a short spec with no spec reviewers, no plan and no plan review, a build on the feat/load-test or fix/load-test branch, a review round with the Logic & Edge-Case Hunter as the only reviewer (plus the verifier-voter), the final proof, and the PR draft, without telling the user to run a /quorum: command in between, and ended by giving the user the push and PR commands to run themselves.
FAIL if it started spec reviewers, the planner, or plan reviewers, started any reviewer besides the Logic & Edge-Case Hunter, skipped the proof, stopped early to hand off to another command, or pushed or opened the PR itself.
