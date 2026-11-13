<!-- The steps of /quorum:spec-and-eval, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Spec a task

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

Turn the request in `<arguments>` into a task folder, `.tasks/<slug>/`, before any code is written. Work from the
repo root (`quorum-active-task --root`). Don't change application code in this skill, even when the fix is
obvious. You read the code to understand the request and reproduce the problem; the fix you find goes into the spec
(`rd.md`'s requirements, `eval.md`'s checks) for the builder, which writes it after the plan. A one-line fix still
goes through the stages: they're what proves it. In a `/quorum:run` session, a hook blocks source edits until the
build starts.

`<arguments>` may also contain `--yes` (only when the user typed it): then accept your proposed slug, tier, and
spec without asking, and say what you chose.

`<arguments>` may also contain `--bug`: the request is a bug to fix. See [A bug fix](#a-bug-fix); without the flag,
when the request clearly describes a bug (something that used to work, or works wrongly), propose the bug path in
step 3 instead.

`<arguments>` may also contain `--from-map <map> <n>`: start task `<n>` of a cleared map's `tasks.md`. See
[From a map](#from-a-map).

`<arguments>` may also contain `--fast` (from `/quorum:run --fast`): the **fast path** for a LOW task. It writes a
short spec, skips the spec reviewers and the mockup, and goes straight to the build, with no plan round. The checks
stay: `eval.md`, the Stop hook, the review, and the proof. Each step below says what changes on the fast path. It
applies only to LOW: if the tier you settle in step 3 is MEDIUM or HIGH, say that the fast path is for LOW tasks
only and that this one takes the full pipeline, and drop `--fast`. **Without `--fast` there is no fast path:** a LOW
task gets every step below, including the two spec reviewers, whatever else `<arguments>` holds (`--yes` included).

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

## 2. Understand the request

Read the request, then the code it touches. Questions follow Quorum's grilling habit
(`<plugin root>/skills/grilling/SKILL.md`): look facts up instead of asking them, give each question your
recommended answer, and never ask what the request, a map's decisions, or the code already settles. Ask only what
would change what gets built:

- **Why, first.** If the request doesn't say what problem it solves or who it's for, ask that, in one question,
  before anything else, and wait. The answer shapes the requirements more than any process choice. With `--yes`,
  infer it from the request and say what you assumed.
- **What it should do**, where the request leaves a real choice open (for example an output format, or how to
  treat untrusted input). Ask these in the same message as step 3's proposal, each with the option you recommend.

## 3. Propose, then ask once

Work out everything else yourself, and state it as a proposal the user can correct, in one message:

- **Slug:** short kebab-case (for example `csv-export-button`), matching `[a-z0-9][a-z0-9.-]*`, not already under
  `.tasks/`.
- **Risk tier,** with a one-line reason. Ask yourself: **"What happens to the user or system if this change
  breaks?"** (the rules are below).
- **Research:** yes for MEDIUM and HIGH, no for LOW, unless `<arguments>` says `--research` or `--no-research`.
- **Docs,** for a task that adds something people can use (step 5.2 says how to choose the places).
- **A bug fix,** when the request describes one and `--bug` wasn't given: propose treating it as one (see
  [A bug fix](#a-bug-fix)).
- **The fast path,** for a LOW task without `--fast`: offer it as an option ("or take the fast path: a short spec,
  no plan round, one reviewer"). Choosing it means the same as `--fast`.
- **Models:** resolve both as in `<plugin root>/skills/pipeline-laws/models.md` (configured defaults:
  `reviewer_model` = <reviewer_model>, `helper_model` = <helper_model>). Only a choice nothing resolved needs a
  question; a repo remembers its last answers.

Then ask **once**, with AskUserQuestion where it's offered (otherwise in the same message): one question to
confirm or change the proposal, plus each open question from step 2 and each unresolved model choice, four at
most in one call. Never ask the slug, tier, research, or docs one at a time.

With `--yes`, accept the proposal without asking and say what you chose, except a **HIGH** tier, which always needs
the user's yes: the confirm question names HIGH and its reason.

**Follow-up rounds.** That question is the first grilling round. If the answers open questions that couldn't be
asked before them (a choice that raises another, or an answer too vague to write a requirement from), grill on, one
round at a time, as the grilling skill says, until nothing that changes the requirements is open. Most specs need no
second round. Never ask the proposal again. With `--yes`, take your recommended answers and list them.

**The tiers:**

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

Do this when step 3's proposal, as the user confirmed it, includes research: by default for MEDIUM and HIGH, and for
LOW only with `--research`. `--no-research` skips it, and so does the fast path unless `--research` is given.

1. `quorum-state --task <slug> init <RISK> <STATUS>`, where STATUS is `DRAFT-AWAITING-VISUAL-SIGNOFF` for a UI
   change and `PLANNING` otherwise. Then `quorum-active-task --set <slug>`, and
   `quorum-lessons history <slug> > .tasks/<slug>/history.md`: what earlier tasks in this repo learned (empty in a
   new repo). On the fast path, STATUS is `BUILDING`,
   and then `quorum-state --task <slug> set fast true`.

   **From an earlier research** (`--from-research <research slug> [<candidate>]` in `<arguments>`): don't research
   again. Copy `.tasks/research-<research slug>/research.md` to `.tasks/<slug>/research.md`, with a first line
   "From `.tasks/research-<research slug>/` (<its date>), candidate <n>: <the candidate's line>", and use the option
   that candidate follows as the approach. Skip the rest of this step unless the user asks to research again.

   **From a map** (`--from-map`): see [From a map](#from-a-map) for what this step adds.

   **Deep research** (`--deep-research [quick|standard|deep]` in `<arguments>`): instead of sub-steps 2 and 3, read
   `<plugin root>/skills/research/steps.md` and follow it with `<research dir>` = `.tasks/<slug>/`, the request as
   the question, and the effort given (default `standard`). Then ask which approach the spec should take, as in
   sub-step 3. Deep mode is for a new dependency, a choice between architectures, a security-sensitive integration,
   or a field the repo has no precedent in; for anything less, one researcher is enough, and you may say so.
2. Start `quorum:researcher` with the request in your own words, without internal names you don't need, and
   nothing from production data:

   > Task `<slug>`. Question: what's the best way to <the request> in this repo? <Any focus the user gave.> Read
   > `CLAUDE.md` and `REVIEW.md` first, and `.tasks/<slug>/history.md` if it has anything: what went wrong in this
   > repo before.

3. Save its reply verbatim to `.tasks/<slug>/research.md`. Show the user the options and the recommendation, and
   ask which approach the spec should take, as a grilling round: the approach (the recommendation first), plus each
   item under the research's **Assumptions to confirm**, each with what you'd assume. A confirmed assumption can
   become a requirement or an edge case; one the user rejects or leaves open never goes into the spec as fact.

## 5. Write the spec

1. If you skipped step 4, run step 4.1 now.
2. **Docs for a new feature.** If the task adds something people can use that didn't exist before (a command,
   page, endpoint, config option, env var, integration, or workflow), the task creates or updates docs, as the
   step 3 proposal said. Bug fixes, refactors, and test-only changes have none.
   - First look where the repo documents similar features (`README*`, `docs/`, runbooks, `.env.example`, API
     docs, `CHANGELOG*`, `CLAUDE.md`) and offer those places as the choices, each with what it would say in one
     line. Always include "No docs for this task".
   - These are part of step 3's single question, not a separate one. With `--yes`, choose the places where the
     repo documents similar features (none if it doesn't), and say what you chose.
   - Each doc chosen becomes a numbered requirement starting with **Docs:**, naming the file and what it covers,
     for example "**Docs:** add the `--since` flag to the Options table in `docs/cli.md`".
   - If the user says no docs, add a non-goal: "No new docs for this feature (declined at spec time)".
   **Did the research change anything?** If research ran (any kind, or `--from-research`), record whether it changed
   a decision, so a later look at `state.md` can tell whether research pays for itself:
   `quorum-state set research_decision changed` when the spec follows an option the request didn't already imply, or
   the research added a requirement, non-goal, or edge case; `confirmed` when it only backed what the request asked
   for, as asked.
   On the fast path, keep `rd.md` and `eval.md` short: the goal, the few requirements the change needs, the
   rollback, and only the edge cases that apply. Every requirement still gets an `eval.md` row.
3. **`rd.md`** from the template: goal, numbered testable requirements, non-goals, a **one-step** rollback plan,
   and (MEDIUM/HIGH) the blind-test user goal with its starting URL or command from `CLAUDE.md`. Follow the
   approach chosen in step 4, and add the research's "For the spec" items that apply. A task from a map also
   follows `decisions.md` (see [From a map](#from-a-map)).
4. **`eval.md`** from the template: one row per requirement with an **exact command** and what passing looks like,
   plus edge cases (empty, very large, unicode, concurrent, permission denied: whichever apply). Every command
   must run locally, with tools every machine that runs the repo has: `grep`, not `rg`, unless the repo already
   uses ripgrep. A check that needs a missing tool is skipped, not passed. Use synthetic data only; never
   production data, shared databases, or real credentials.
   - A bug fix gets a row that shows the new test fails on the old code. Write it so it can run in a separate
     worktree; `quorum:prover` runs it there. A `--bug` task's reproduction is its first row (see
     [A bug fix](#a-bug-fix)).
   - A UI change gets accessibility rows: reaching the change by keyboard alone, and an axe scan of the changed
     screens for WCAG 2.2 A and AA.
   - Each **Docs:** requirement gets a row that checks the doc names the new thing (for example
     `grep -n -- '--since' docs/cli.md`), and whose "Passes when" says what the section must explain.
5. **Try each check once.** Run every Task checks command now, on the code as it is (read `\|` in a cell as `|`).
   Most should fail, since nothing is built yet, but each must *run*: "command not found", "invalid option", a
   syntax error, or a sandbox refusal means the row itself is broken. Fix it now: once the build starts, `rd.md`
   and `eval.md` are locked. Keep temporary files under `.tasks/<slug>/tmp/`, not `mktemp`'s system folder, which a
   sandbox can block.
6. **Lint it.** `quorum-validate --task <slug> spec` checks that every requirement has a Task checks row and every
   row names a requirement and says how it passes, and rejects commands that break on a common machine (`grep -P`). Fix every `ERROR` now, so the reviewers spend their time on
   judgment. Reword a requirement a `WARN` flags as vague, or keep it if the word is precise in context.

## 6. Review the spec

1. **Models.** Step 3 resolved both; every later command reuses them. (A redesign that reaches this step without
   them resolves them now, as step 3 says.)
2. Start two `quorum:spec-reviewer`s **in one message, in parallel**, with `reviewer_model`, personas
   **Feasibility Critic** and **Spec Improver**. Each gets only:

   > Persona: <persona>. Task: `<slug>`. Review `.tasks/<slug>/rd.md` and `.tasks/<slug>/eval.md` before any
   > code is written. Read `CLAUDE.md`, `REVIEW.md`, and `.tasks/<slug>/research.md` and
   > `.tasks/<slug>/decisions.md` if they exist.

3. Save the replies verbatim to `.tasks/<slug>/spec-review/feasibility.md` and `improver.md`.
4. Fix every `[IMPORTANT]` in `rd.md` or `eval.md`, or ask the user about any you think is wrong. Apply the
   `[NIT]` suggestions you agree with. A finding only the user can settle (what a requirement should mean, whether
   something is in scope, a trade-off between two requirements) goes to them as one grilling round, with each
   finding and the fix you recommend, before you change the spec. Run the reviewers once more only if you changed a
   requirement's meaning.
5. Show the user both files, what the reviewers found and what you changed, and ask for corrections before going
   on. `quorum-state log` a short block: the two summary lines and what changed.

Only on the fast path (`--fast` in `<arguments>`, and a LOW tier), do step 1 only: no spec reviewers. Show the user
both files and ask for corrections (with `--yes`, go on and say so), then `quorum-state log` a block:
`## Spec (fast path)` and the number of requirements.

## 7. UI work: mockup gate

The fast path skips this step (a LOW change is copy or style at most; `eval.md`'s accessibility rows still run).
The next step is `/quorum:build`.

If the change alters UI, write a self-contained `mockup.html` from the template: no external fonts, scripts, or
images. Show the default, loading, empty, and error states the requirements mention. Then **stop**: tell the user
to open `.tasks/<slug>/mockup.html`, and that `/quorum:plan` will ask them to confirm sign-off before planning.

Otherwise, the next step is `/quorum:plan`.

## A bug fix

With `--bug`, or when the user accepts step 3's proposal to treat the request as a bug, these change:

1. **Reproduce it first,** before step 3's proposal: find the smallest command that shows the bug on the current
   code (a test, a CLI call, a request), run it, and quote what it prints next to what it should print. Use the
   `quorum:debugging` skill's first two steps. If you can't make it happen, say what you tried and ask for what's
   missing (the input, the steps, the environment), and stop: a fix for a bug nobody reproduced can't be proven.
   Reproducing it isn't fixing it: when you find the cause, write it into `## The bug` (step 3), not into the code.
2. In step 4.1, also `quorum-state --task <slug> set bug true`. The build then uses `fix/<slug>`.
3. **`rd.md`** gets a `## The bug` section after the goal: what happens, what should happen, and the reproduction
   command with its output today. Requirement 1 is the fix, stated as what the reproduction shows afterwards, for
   example "**Fixed:** `report.py export data/empty.json` prints the header row and exits 0". Add a requirement
   for each other place the same mistake could hide, if the code has them.
4. **`eval.md`** row `1` runs the reproduction and passes when it shows the expected output; row `1b` shows it fails
   without the fix (it runs in a worktree at the old code). The final proof's `Bug:` verdict rests on these two.
5. Research is off by default for LOW and MEDIUM bugs (the cause is in this code, not in a choice of approach),
   and a LOW bug may take the fast path.

## From a map

`--from-map <map> <n>` starts task `<n>` of `.tasks/map-<map>/tasks.md`, the tasks a cleared map (`/quorum:map`)
handed off. The map already made the decisions this task rests on, so these change:

1. **Before step 2,** check `quorum-map --map <map> tasks`. Task `<n>`'s state must be `ready`. If it's `blocked`,
   say which tasks it waits on and that they must merge first (a branch made now wouldn't have their code), and
   stop. If a task already started from it, say which (its slug and status), and stop.
2. **The request** is task `<n>`'s line, and the map's destination says why: don't ask it again. Propose its tier
   as the map gave it (the usual tier rules still apply, and HIGH still needs the user's yes), and research as
   **no** unless `--research` or `--deep-research` is given: the map's research tickets already answered what it
   needed.
3. **Don't ask what the map decided.** Run `quorum-map --map <map> decisions <n>`: the destination, what's out of
   scope, and each decision the task cites. Read it before step 2, and cite it instead of asking again.
4. **In step 4.1,** save that output to `.tasks/<slug>/decisions.md`, then `quorum-state --task <slug> set map
   <map>` and `quorum-state --task <slug> set map_task <n>`.
5. **In step 5,** each decision that constrains this task becomes a requirement or a non-goal, in its own words,
   and the map's out-of-scope items that touch this task become non-goals. If the code shows a decision can't be
   met as the map made it, say so and ask; don't plan around it. `/quorum:map <map> --revise` reopens it.

## Redesign

`--redesign <slug>` restarts a task whose status is `HALTED`.

1. Check `quorum-state --task <slug> get status` is `HALTED`. Read the post-mortem and the two redesign options at the
   end of `state.md`, and ask the user which option to take (or their own), with the one you recommend and why. Then
   grill on what the chosen design leaves open, as in step 3's follow-up rounds, before rewriting the spec.
2. Keep the history: move `state.md` to the first free `state.halted-<n>.md`.
3. Rewrite `rd.md` (and `eval.md` if the checks change) for the chosen design. Keep the same risk tier unless the
   user changes it. Then review the new spec as in step 6; write its `quorum-state log` block after the init in step 4.
4. `quorum-state --task <slug> init <RISK> PLANNING` (this starts with a fresh round count, round SHAs, plan
   rounds, and findings), then `quorum-active-task --set <slug>`. `base_sha` is set again by `/quorum:build`.
   Carry over the model choices: `quorum-state set` each of `reviewer_model` and `helper_model` that the halted
   state file recorded.
5. The next step is `/quorum:plan`: the old `plan.md` was for the design that halted, so it's planned again.
