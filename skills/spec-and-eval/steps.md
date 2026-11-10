<!-- The steps of /quorum:spec-and-eval, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Spec a task

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

Turn the request in `<arguments>` into a task folder, `.tasks/<slug>/`, before any code is written. Work from the
repo root (`quorum-active-task --root`). Don't write application code in this skill.

`<arguments>` may also contain `--yes` (only when the user typed it): then accept your proposed slug, tier, and
spec without asking, and say what you chose.

`<arguments>` may also contain `--fast` (from `/quorum:run --fast`): the **fast path** for a LOW task. It writes a
short spec, skips the spec reviewers and the mockup, and goes straight to the build, with no plan round. The checks
stay: `eval.md`, the Stop hook, the review, and the proof. Each step below says what changes on the fast path. It
applies only to LOW: if the tier you settle in step 3 is MEDIUM or HIGH, say that the fast path is for LOW tasks
only and that this one takes the full pipeline, and drop `--fast`.

Templates live in `<plugin root>/skills/spec-and-eval/templates/`. Use `quorum-state` and
`quorum-active-task` (on your PATH) for all state; never hand-edit `state.md` frontmatter.

## 1. Check the repo is bootstrapped

If `REVIEW.md` or `.claude/hooks/verify-completion.sh` is missing, stop and suggest `/quorum:init-pipeline`. Read
`CLAUDE.md` and `REVIEW.md` before writing the spec.

If `<arguments>` starts with `--redesign`, go to [Redesign](#redesign).

**Start in the main working tree.** A new task's spec and plan live there, not in another task's worktree: if
`quorum-active-task --code` and `quorum-active-task --main` differ, call `ExitWorktree` with action `keep`. If it says
this session didn't enter a worktree, ask the user to start the new task from the main working tree
(`quorum-active-task --main`), and stop.

**Merged worktrees.** `quorum-branch merged` lists tasks whose work merged while their git worktree is still there.
If it lists any, ask the user which to remove (AskUserQuestion, one option per task, any number). For each yes, run
`quorum-branch remove <slug>`; exit 3 means it has uncommitted changes: show them and leave it. Remove nothing
without a yes.

## 2. Name the task

Propose a short kebab-case slug (for example `csv-export-button`). It must match `[a-z0-9][a-z0-9.-]*` and not
already exist under `.tasks/`. If the request is unclear, ask one round of clarifying questions now, not later.

## 3. Classify the risk

Ask yourself: **"What happens to the user or system if this change breaks?"** Propose a tier with a one-line reason
and let the user confirm or change it.

| Tier | Typical changes | Gets |
|---|---|---|
| LOW | Copy or style tweak, docs, an isolated test, new code behind an off-by-default flag | Plan and code review by 1 reviewer, plus 1 per tests, UI, or docs touched; no human line review if green |
| MEDIUM | A user-facing workflow, an API endpoint, state logic | Research; plan and code review by 4–6 reviewers; blind test; focused human review |
| HIGH | Auth, money, destructive migrations, security boundaries, core state machines, build pipelines | Research; plan and code review by 4–7 reviewers, including security; blocking security pass; blind test; human architectural sign-off |

Anything a user can see or run is at least **MEDIUM**: a new or changed command, flag, endpoint, page, or output
format, even when it's additive and read-only. **LOW** is only for changes a user can't reach: docs and copy, tests,
internal refactors covered by existing tests, and code behind an off-by-default flag. Deleting, overwriting, or
migrating data is **HIGH**. When in doubt between two tiers, pick the higher one.

## 4. Research the approach

Do this for MEDIUM and HIGH tasks, and for LOW when `<arguments>` contains `--research`. Skip it when it contains
`--no-research`, and on the fast path unless it contains `--research`.

1. `quorum-state --task <slug> init <RISK> <STATUS>`, where STATUS is `DRAFT-AWAITING-VISUAL-SIGNOFF` for a UI
   change and `PLANNING` otherwise. Then `quorum-active-task --set <slug>`. On the fast path, STATUS is `BUILDING`,
   and then `quorum-state --task <slug> set fast true`.
2. Start `quorum:researcher` with the request in your own words, without internal names you don't need, and
   nothing from production data:

   > Task `<slug>`. Question: what's the best way to <the request> in this repo? <Any focus the user gave.> Read
   > `CLAUDE.md` and `REVIEW.md` first.

3. Save its reply verbatim to `.tasks/<slug>/research.md`. Show the user the options and the recommendation, and
   ask which approach the spec should take.

## 5. Write the spec

1. If you skipped step 4, run step 4.1 now.
2. **Docs for a new feature.** If the task adds something people can use that didn't exist before (a command,
   page, endpoint, config option, env var, integration, or workflow), ask the user whether this task should
   create or update docs. Bug fixes, refactors, and test-only changes skip this question.
   - First look where the repo documents similar features (`README*`, `docs/`, runbooks, `.env.example`, API
     docs, `CHANGELOG*`, `CLAUDE.md`) and offer those places as the choices, each with what it would say in one
     line. Always include "No docs for this task".
   - Ask once, together with any other open questions. With `--yes`, choose the places where the repo documents
     similar features (none if it doesn't), and say what you chose.
   - Each doc chosen becomes a numbered requirement starting with **Docs:**, naming the file and what it covers,
     for example "**Docs:** add the `--since` flag to the Options table in `docs/cli.md`".
   - If the user says no docs, add a non-goal: "No new docs for this feature (declined at spec time)".
   On the fast path, keep `rd.md` and `eval.md` short: the goal, the few requirements the change needs, the
   rollback, and only the edge cases that apply. Every requirement still gets an `eval.md` row.
3. **`rd.md`** from the template: goal, numbered testable requirements, non-goals, a **one-step** rollback plan,
   and (MEDIUM/HIGH) the blind-test user goal with its starting URL or command from `CLAUDE.md`. Follow the
   approach chosen in step 4, and add the research's "For the spec" items that apply.
4. **`eval.md`** from the template: one row per requirement with an **exact command** and what passing looks like,
   plus edge cases (empty, very large, unicode, concurrent, permission denied: whichever apply). Every command
   must run locally, with tools every machine that runs the repo has: `grep`, not `rg`, unless the repo already
   uses ripgrep. A check that needs a missing tool is skipped, not passed. Use synthetic data only; never
   production data, shared databases, or real credentials.
   - A bug fix gets a row that shows the new test fails on the old code. Write it so it can run in a separate
     worktree; `quorum:prover` runs it there.
   - A UI change gets accessibility rows: reaching the change by keyboard alone, and an axe scan of the changed
     screens for WCAG 2.2 A and AA.
   - Each **Docs:** requirement gets a row that checks the doc names the new thing (for example
     `grep -n -- '--since' docs/cli.md`), and whose "Passes when" says what the section must explain.

## 6. Review the spec

1. **Models.** Resolve both of the task's model choices, reviewers and helpers, as in
   `<plugin root>/skills/pipeline-laws/models.md` (configured defaults: `reviewer_model` = <reviewer_model>, `helper_model` = <helper_model>). Ask them together with
   the questions from step 5 when you can, so the user is asked once. Every later command reuses them.
2. Start two `quorum:spec-reviewer`s **in one message, in parallel**, with `reviewer_model`, personas
   **Feasibility Critic** and **Spec Improver**. Each gets only:

   > Persona: <persona>. Task: `<slug>`. Review `.tasks/<slug>/rd.md` and `.tasks/<slug>/eval.md` before any
   > code is written. Read `CLAUDE.md`, `REVIEW.md`, and `.tasks/<slug>/research.md` if it exists.

3. Save the replies verbatim to `.tasks/<slug>/spec-review/feasibility.md` and `improver.md`.
4. Fix every `[IMPORTANT]` in `rd.md` or `eval.md`, or ask the user about any you think is wrong. Apply the
   `[NIT]` suggestions you agree with. Run the reviewers once more only if you changed a requirement's meaning.
5. Show the user both files, what the reviewers found and what you changed, and ask for corrections before going
   on. `quorum-state log` a short block: the two summary lines and what changed.

On the fast path, do step 1 only: no spec reviewers. Show the user both files and ask for corrections (with
`--yes`, go on and say so), then `quorum-state log` a block: `## Spec (fast path)` and the number of requirements.

## 7. UI work: mockup gate

The fast path skips this step (a LOW change is copy or style at most; `eval.md`'s accessibility rows still run).
The next step is `/quorum:build`.

If the change alters UI, write a self-contained `mockup.html` from the template: no external fonts, scripts, or
images. Show the default, loading, empty, and error states the requirements mention. Then **stop**: tell the user
to open `.tasks/<slug>/mockup.html`, and that `/quorum:plan` will ask them to confirm sign-off before planning.

Otherwise, the next step is `/quorum:plan`.

## Redesign

`--redesign <slug>` restarts a task whose status is `HALTED`.

1. Check `quorum-state --task <slug> get status` is `HALTED`. Read the post-mortem and the two redesign options at the
   end of `state.md`, and ask the user which option to take (or their own).
2. Keep the history: move `state.md` to the first free `state.halted-<n>.md`.
3. Rewrite `rd.md` (and `eval.md` if the checks change) for the chosen design. Keep the same risk tier unless the
   user changes it. Then review the new spec as in step 6; write its `quorum-state log` block after the init in step 4.
4. `quorum-state --task <slug> init <RISK> PLANNING` (this starts with a fresh round count, round SHAs, plan
   rounds, and findings), then `quorum-active-task --set <slug>`. `base_sha` is set again by `/quorum:build`.
   Carry over the model choices: `quorum-state set` each of `reviewer_model` and `helper_model` that the halted
   state file recorded.
5. The next step is `/quorum:plan`: the old `plan.md` was for the design that halted, so it's planned again.
