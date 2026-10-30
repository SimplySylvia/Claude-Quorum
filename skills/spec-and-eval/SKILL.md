---
name: spec-and-eval
description: Start a Quorum task. Classifies the risk tier, writes the requirements (rd.md) and runnable checks (eval.md), creates the task's state.md, and for UI work writes a mockup and stops for sign-off. With --redesign <slug>, restarts a HALTED task from a redesign option. Run before writing any code.
disable-model-invocation: true
argument-hint: "<what to build> | --redesign <slug>"
---

# Spec a task

Turn the request in `$ARGUMENTS` into a task folder, `.tasks/<slug>/`, before any code is written. Work from the
repo root (`quorum-active-task --root`). Don't write application code in this skill.

`$ARGUMENTS` may also contain `--yes` (only when the user typed it): then accept your proposed slug, tier, and
spec without asking, and say what you chose.

Templates live in `${CLAUDE_PLUGIN_ROOT}/skills/spec-and-eval/templates/`. Use `quorum-state` and
`quorum-active-task` (on your PATH) for all state; never hand-edit `state.md` frontmatter.

## 1. Check the repo is bootstrapped

If `REVIEW.md` or `.claude/hooks/verify-completion.sh` is missing, stop and suggest `/quorum:init-pipeline`. Read
`CLAUDE.md` and `REVIEW.md` before writing the spec.

If `$ARGUMENTS` starts with `--redesign`, go to [Redesign](#redesign).

## 2. Name the task

Propose a short kebab-case slug (for example `csv-export-button`). It must match `[a-z0-9][a-z0-9.-]*` and not
already exist under `.tasks/`. If the request is unclear, ask one round of clarifying questions now, not later.

## 3. Classify the risk

Ask yourself: **"What happens to the user or system if this change breaks?"** Propose a tier with a one-line reason
and let the user confirm or change it.

| Tier | Typical changes | Gets |
|---|---|---|
| LOW | Copy or style tweak, docs, an isolated test, new code behind an off-by-default flag | 1 reviewer; no human line review if green |
| MEDIUM | A user-facing workflow, an API endpoint, state logic | 2 reviewers, blind test, focused human review |
| HIGH | Auth, money, destructive migrations, security boundaries, core state machines, build pipelines | 2 reviewers, security pass, blind test, human architectural sign-off |

Anything a user can see or run is at least **MEDIUM**: a new or changed command, flag, endpoint, page, or output
format, even when it's additive and read-only. **LOW** is only for changes a user can't reach: docs and copy, tests,
internal refactors covered by existing tests, and code behind an off-by-default flag. Deleting, overwriting, or
migrating data is **HIGH**. When in doubt between two tiers, pick the higher one.

## 4. Write the spec

1. `quorum-state --task <slug> init <RISK> <STATUS>`, where STATUS is `DRAFT-AWAITING-VISUAL-SIGNOFF` for a UI
   change and `BUILDING` otherwise. Then `quorum-active-task --set <slug>`.
2. **`rd.md`** from the template: goal, numbered testable requirements, non-goals, a **one-step** rollback plan,
   and (MEDIUM/HIGH) the blind-test user goal with its starting URL or command from `CLAUDE.md`.
3. **`eval.md`** from the template: one row per requirement with an **exact command** and what passing looks like,
   plus edge cases (empty, very large, unicode, concurrent, permission denied: whichever apply). Every command
   must run locally. Use synthetic data only; never production data, shared databases, or real credentials.
4. Show the user both files and ask for corrections before going on.

## 5. UI work: mockup gate

If the change alters UI, write a self-contained `mockup.html` from the template: no external fonts, scripts, or
images. Show the default, loading, empty, and error states the requirements mention. Then **stop**: tell the user
to open `.tasks/<slug>/mockup.html`, and that `/quorum:build` will ask them to confirm sign-off.

Otherwise, the next step is `/quorum:build`.

## Redesign

`--redesign <slug>` restarts a task whose status is `HALTED`.

1. Check `quorum-state --task <slug> get status` is `HALTED`. Read the post-mortem and the two redesign options at the
   end of `state.md`, and ask the user which option to take (or their own).
2. Keep the history: move `state.md` to the first free `state.halted-<n>.md`.
3. Rewrite `rd.md` (and `eval.md` if the checks change) for the chosen design. Keep the same risk tier unless the
   user changes it.
4. `quorum-state --task <slug> init <RISK> BUILDING` (this starts with a fresh round count, round SHAs, and
   findings), then `quorum-active-task --set <slug>`. `base_sha` is set again by `/quorum:build`.
5. The next step is `/quorum:build`.
