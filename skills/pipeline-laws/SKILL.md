---
name: pipeline-laws
description: Quorum's universal engineering laws and stage map. Use when deciding whether work is really done, which Quorum command comes next for a task, or how a repo bootstrapped with Quorum expects code to be built and reviewed.
---

# Quorum laws and stage map

## The three laws

1. **Proof before "done".** Never say a task, bugfix, or feature is complete without running verification proof
   (tests, typecheck, build, or a live CLI or UI check) and showing the passing output.
2. **Branch hygiene and fast rollback.** Work on a dedicated `feat/<slug>` or `fix/<slug>` branch with clean,
   small commits, so any change can be bisected or reverted in one step.
3. **Read the repo first.** Before building or reviewing, read `./CLAUDE.md` and `./REVIEW.md` and follow them.
   If the repo has no `REVIEW.md` or no `.claude/hooks/verify-completion.sh`, suggest `/quorum:init-pipeline`.

## Where a task is, and what comes next

Find the active task with `quorum-active-task` and its status with `quorum-state get status`. Then suggest the
next command. Never start one yourself: every Quorum command is run by the user.

| Status | Next command |
|---|---|
| (no task) | `/quorum:spec-and-eval`; or, to review a branch, PR, or range without a task, `/quorum:review` |
| `DRAFT-AWAITING-VISUAL-SIGNOFF` | The user reviews `mockup.html`, then `/quorum:plan`, which records the sign-off |
| `PLANNING` | `/quorum:plan`: write and review `plan.md`, then approve it |
| `BUILDING` | `/quorum:build` if no code exists yet; otherwise `/quorum:simplify-diff`, then `/quorum:review-loop` |
| `IN_REVIEW` | `/quorum:review-loop` |
| `CONVERGED` | `/quorum:blind-test` for MEDIUM or HIGH; LOW tasks already have their summary |
| `BLIND-TEST` | Wait for `/quorum:blind-test` to finish |
| `READY` | `/quorum:pr-draft`, then merge (once `quorum-state get pr` names the PR, get it reviewed and merged). Optionally `/quorum:codify-lesson` |
| `AWAITING-HUMAN` | The user reviews the files named in the summary; `/quorum:pr-draft` for the PR, or, once `quorum-state get pr` names it, its review and merge. Optionally `/quorum:codify-lesson` |
| `HALTED` | The user picks a redesign from the post-mortem, then `/quorum:spec-and-eval --redesign <slug>` |
| `ESCALATED` | The Stop-hook checks failed 3 times in a row. Fix the environment or the failing checks; the next pass restores the previous status |

## Risk tiers

| Tier | Typical changes | Gets |
|---|---|---|
| LOW | Copy or style, docs, an isolated test, code behind an off-by-default flag | Plan and code review by 1 reviewer, plus 1 per tests, UI, or docs touched; no human line review if green |
| MEDIUM | A user-facing workflow, an API endpoint, state logic | Research; plan and code review by 4–6 reviewers; blind test; focused human review |
| HIGH | Auth, money, destructive migrations, security boundaries, core state machines, build pipelines | Research; plan and code review by 4–7 reviewers, including security; blocking security pass; blind test; human architectural sign-off |

## Models

Each task records which model its reviewers and its helpers run on; the skills ask once, at the task's start.
`${CLAUDE_PLUGIN_ROOT}/skills/pipeline-laws/models.md` has the rules. A command that starts reviewers or helpers,
run with `--models`, asks again.
