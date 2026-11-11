<!-- The steps of /quorum:plan, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Plan the task

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

You are the orchestrator. You don't write or review the plan yourself: the planner writes it, reviewers review it,
the voter votes. Use the slug in `<arguments>`, or `quorum-active-task`. Work from the repo root, and use
`quorum-state` and `quorum-findings` (on your PATH) for state and counting.

`<arguments>` may contain `--yes` (only when the user typed it): then approve a plan with no `[IMPORTANT]` findings
left without asking, and say so. Don't run git commands that change the working tree, index, or history here.

The plan template is `<plugin root>/skills/plan/templates/plan.md`. Keep each round's files in
`.tasks/<slug>/plan-review/round-<N>/`.

## 1. Check the status

`quorum-state get status` must be `PLANNING` or `DRAFT-AWAITING-VISUAL-SIGNOFF`. For any other status, say what it
is and which command comes next (see the `pipeline-laws` skill's stage map), then stop.

## 2. Mockup sign-off (UI tasks)

If the status is `DRAFT-AWAITING-VISUAL-SIGNOFF`, ask the user whether they've reviewed
`.tasks/<slug>/mockup.html` and approve it. Never assume approval.

- If they approve: `quorum-state set signoff <today, YYYY-MM-DD>`, then `quorum-state set status PLANNING`.
- If they want changes: update `mockup.html` with them and ask again. Don't plan yet.

## 3. Write the plan

Start `quorum:planner` with:

> Task `<slug>`. Write the implementation plan in the template below. Read `CLAUDE.md`, `REVIEW.md`,
> `.tasks/<slug>/rd.md`, `.tasks/<slug>/eval.md`, `.tasks/<slug>/research.md` if it exists, and
> `.tasks/<slug>/mockup.html` if it exists. <the template, with TITLE, SLUG, and RISK filled in>

Save its reply verbatim to `.tasks/<slug>/plan.md`.

## 4. Review the plan

Let N = `quorum-state incr plan_rounds`.

**Models.** In round 1, first resolve the task's reviewer model as in
`<plugin root>/skills/pipeline-laws/models.md` (configured defaults: `reviewer_model` = <reviewer_model>, `helper_model` = <helper_model>). Start every plan reviewer and
the voter with `reviewer_model`; the planner runs on the session's model.

1. **Start the plan reviewers in one message, in parallel** (they must not see each other or you). Risk tier from
   `quorum-state get risk`; read `plan.md` to see what it touches:

   | Reviewer | Persona or mode | When | Saved as |
   |---|---|---|---|
   | `quorum:code-reviewer` | **Logic & Edge-Case Hunter**, plan mode | always | `logic.md` |
   | `quorum:code-reviewer` | **Architecture, Security & Drift Hunter**, plan mode | MEDIUM, HIGH | `architecture.md` |
   | `quorum:pattern-auditor` | plan mode | MEDIUM, HIGH | `patterns.md` |
   | `quorum:docs-auditor` | plan mode | MEDIUM, HIGH, or the plan or spec names docs | `docs.md` |
   | `quorum:code-reviewer` | **Test Adequacy Hunter**, plan mode | the plan adds or changes tests | `tests.md` |
   | `quorum:a11y-auditor` | plan mode | UI work | `a11y.md` |
   | `quorum:security-reviewer` | plan mode | HIGH, or MEDIUM with `<security_on_medium>` `true` | `security.md` |

   Each gets only this prompt (leave out the persona for the auditors and the security reviewer):

   > Mode: plan. Persona: <persona>. Task: `<slug>`. Review the implementation plan `.tasks/<slug>/plan.md` before
   > any code is written: does it meet `.tasks/<slug>/rd.md` and `.tasks/<slug>/eval.md`, and is it right for this
   > repo? Read `REVIEW.md` and `CLAUDE.md` first, and the code the plan names. This is plan round <N>.

2. Save each reply **verbatim** to `plan-review/round-<N>/<file>` from the table, and all of them together to
   `plan-review/round-<N>/candidates.md`.
3. **Vote.** Start `quorum:verifier-voter` with:

   > Task: `<slug>`. Candidate findings on the plan: `.tasks/<slug>/plan-review/round-<N>/candidates.md`. Read
   > `REVIEW.md`, `.tasks/<slug>/rd.md`, and `.tasks/<slug>/plan.md`, check each finding against the plan and the
   > code it names, and vote.

   Save its reply verbatim to `round-<N>/votes.md`, then `quorum-findings cap <nit_cap> votes.md > survivors.md`
   (`nit_cap` is `<nit_cap>`, or 2 if that reads as a placeholder).
4. `quorum-state log` a block: `## Plan round <N>`, the `quorum-findings summary` line, and the Pattern Categories.

## 5. Revise or approve

- **`[IMPORTANT]` findings survive and N is 1:** start `quorum:planner` again with the task slug and
  `survivors.md` as the findings to answer, save its reply over `plan.md`, and go back to step 4.
- **`[IMPORTANT]` findings survive after round 2:** stop revising. Show the user the surviving findings and the
  planner's open questions, and ask them to decide each one: change the spec (`/quorum:spec-and-eval --redesign`),
  accept the plan as is, or tell you what to change. Revise once more only if they ask.
- **Nothing `[IMPORTANT]` left:** go to step 6.

## 6. Approval

Show the user `plan.md` and the non-blocking findings, and ask them to approve it (skip with `--yes`). If its
`## Checks changes` names any file, show that list on its own and say that approving unlocks those files for the
build, which otherwise can't touch the checks; `--yes` never approves a plan with Checks changes. On approval:
`quorum-state push unlocked <path>` for each file there, `quorum-state set plan_approved <today, YYYY-MM-DD>`, then
`quorum-state set status BUILDING`. If they want changes,
pass them to the planner as findings and review once more.

The next step is `/quorum:build`, which builds from this plan. The review loop later checks the code against it.
