<!-- The steps of /quorum:review-loop, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Review loop

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

You are the orchestrator. You don't review or fix code yourself: reviewers review, the voter votes, the builder
fixes. Your job is to give each of them exactly the right inputs, keep the record, and stop when the rules say.

Work on the active task (`quorum-active-task`) from the repo root. Use `quorum-state`, `quorum-branch`, and
`quorum-findings` (on your PATH) for state, ranges, and counting; never hand-edit `state.md` frontmatter.

Don't run git commands that change the working tree, index, or history here (`stash`, `reset`, `checkout`, `commit`,
`rebase`); agents make the commits. Read-only git (`diff`, `log`, `status`, `show`) is fine.
Settings: `max_rounds` = <max_rounds>, `nit_cap` = <nit_cap>.

Keep each round's files in `.tasks/<slug>/review/round-<N>/`.

**Unfinished reviews.** First run `quorum-reviews heal <session>`. It marks any `/quorum:review` this session left
unfinished as `INTERRUPTED`, and removes a `--fix` marker it left, which would otherwise point this task's builder
at the review. If it prints ids, mention them in one line.

**Models.** Before the first reviewer, resolve the task's reviewer model as in
`<plugin root>/skills/pipeline-laws/models.md` (configured defaults: `reviewer_model` = <reviewer_model>, `helper_model` = <helper_model>) (`--models` in
`<arguments>` asks again). Start every reviewer and the voter with `reviewer_model`; the builder and the prover run on
the session's model.

## 0. Preconditions

- Status (`quorum-state get status`) must be `BUILDING` or `IN_REVIEW`. Otherwise say which command comes next
  (`pipeline-laws` has the stage map) and stop.
- `base_sha` must be set and the working tree clean (`git status --porcelain --untracked-files=no` empty). If not,
  say so and stop.

## 1. Pending findings first

If `quorum-state get pending_findings` lists anything (from `/quorum:blind-test`), fix those before reviewing:

1. Write the items, one per block, to `.tasks/<slug>/review/pending-<n>.md`. These come from the running app, so they
   have no `file:line`; don't run `quorum-findings check` on them. The builder finds the cause.
2. `quorum-branch record` (so the next review sees only the builder's changes).
3. Start the builder (step 4 below) with that file as its findings. Then `quorum-state clear pending_findings`.

## 2. Each round

Let N = `quorum-state get round` + 1. Stop the loop if N > max_rounds (see step 5).

1. `quorum-state set round N` and `quorum-state set status IN_REVIEW`.
2. `RANGE=$(quorum-branch range)`. If `git diff --quiet $RANGE` (nothing new to review) and N > 1, the previous
   round's findings were not fixed; treat that as a failed round.
3. **Start the reviewers in one message, in parallel** (they must not see each other or you). Risk tier from
   `quorum-state get risk`, changed files from `git diff --name-only <RANGE>`:

   | Reviewer | Persona or mode | When | Saved as |
   |---|---|---|---|
   | `quorum:code-reviewer` | **Logic & Edge-Case Hunter** | always, and the only one on the fast path | `logic.md` |
   | `quorum:code-reviewer` | **Architecture, Security & Drift Hunter** | MEDIUM, HIGH | `architecture.md` |
   | `quorum:pattern-auditor` | (none) | MEDIUM, HIGH | `patterns.md` |
   | `quorum:docs-auditor` | (none) | MEDIUM, HIGH, or any tier when the range changes docs | `docs.md` |
   | `quorum:code-reviewer` | **Test Adequacy Hunter** | the range changes tests (paths with `test`, `spec`, `__tests__`, `e2e`, `cypress`) | `tests.md` |
   | `quorum:a11y-auditor` | mode **diff** | the range changes UI (markup, components, styles: for example `.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`) | `a11y.md` |

   Each gets only this prompt (fill in the values; leave out the persona line for the pattern and docs auditors), never your
   own notes or the builder's report:

   > Persona: <persona, or "Mode: diff" for the a11y auditor>. Task: `<slug>`. Review the diff range `<RANGE>`
   > (`git diff <RANGE>`) in this repo. Read `REVIEW.md`, `CLAUDE.md`, `.tasks/<slug>/rd.md`,
   > `.tasks/<slug>/eval.md`, and `.tasks/<slug>/plan.md`, and check the change against the plan. This is round
   > <N> <for N > 1: "; earlier rounds already reviewed the rest of the branch, so review only these lines and
   > their immediate callers">.

   A task on the fast path (`quorum-state get fast` is `true`) has no plan: start only the Logic & Edge-Case Hunter,
   and in its prompt replace the `plan.md` part with "There's no `plan.md` (fast path): check the change against
   `rd.md`".

4. Save each reviewer's reply **verbatim** to `round-<N>/<file>` from the table, and all of them together to
   `round-<N>/candidates.md`.
5. **Vote.** Start `quorum:verifier-voter` with:

   > Task: `<slug>`. Candidate findings: `.tasks/<slug>/review/round-<N>/candidates.md`. Read `REVIEW.md` and
   > `.tasks/<slug>/rd.md`, check each finding against the code, and vote.

   Save its reply verbatim to `round-<N>/votes.md` (it keeps the `## Dropped` lines, which `/quorum:codify-lesson`
   reads). Then `quorum-findings cap <nit_cap> votes.md > survivors.md`: the kept findings, with only the most confident nits. Run
   `quorum-findings check survivors.md`; if it fails, ask the voter once to fix the format.
6. **Log the round:** pipe a short block to `quorum-state log`:
   `## Round <N> (<RANGE>)`, the `quorum-findings summary` line, the Pattern Categories, and the number of `DROP`
   lines in `votes.md`.
7. **Route:**
   - `quorum-findings count IMPORTANT survivors.md` is 0 → `quorum-state set status CONVERGED`, go to step 6.
   - N = max_rounds → go to step 5 (HALTED).
   - Otherwise `quorum-branch record`, start the builder (step 4) with `survivors.md`, then start round N+1.

## 3. Hand-off rules

- Reviewers never see the builder's report; the builder never sees the reviewers' raw output, only the voter's
  survivors.
- Don't re-run reviewers on the same range in the same round to get a different answer.
- `[NIT]` and `[PRE-EXISTING]` findings never block. List them in the summary for the user.

## 4. Starting the builder

Start `quorum:builder` with:

> Task `<slug>`. Fix the `[IMPORTANT]` findings in `<findings file>` (run `quorum-findings important <file>`).
> Each has a Pattern Category: fix the cited line and every other instance of that pattern in the files this task
> touched (`git diff --name-only <base_sha>`). Run the checks and commit one fix commit. Categories:
> <`quorum-findings categories <file>`>.

The SubagentStop hook makes it pass `verify-completion.sh` before it hands back. Log its commit list with
`quorum-state log`.

## 5. HALTED

When IMPORTANT findings survive round max_rounds, line patching has failed. Set `quorum-state set status HALTED`,
then `quorum-active-task --clear`, and `quorum-state log` a post-mortem:

- **What kept failing:** the Pattern Categories that survived, and the rounds they appeared in.
- **Why patches didn't converge:** your reading of the root cause (for example a design that can't satisfy two
  requirements at once).
- **Two redesign options**, each with what changes, its risks, and what it costs.

Tell the user to pick one and run `/quorum:spec-and-eval --redesign <slug>`.

## 6. CONVERGED

- **MEDIUM or HIGH:** say the review loop converged after N rounds, list the non-blocking findings and any
  "Needs a human" items, and that the next step is `/quorum:blind-test`.
- **LOW:** print the **Stage 8 summary** below, then `quorum-state set status READY` and
  `quorum-active-task --clear`.

### Stage 8 summary

1. **Verification proof:** start `quorum:prover` on all of `eval.md` (as in `/quorum:build` step 4), save its reply
   verbatim to `.tasks/<slug>/proof-final.md`, and show it. `quorum-state` refuses `READY` and `AWAITING-HUMAN`
   without this file, at HEAD, with no failed check, so save it before setting the status. If anything fails, say so
   and don't mark the task READY.
2. **Risk tier**, the rounds it took, and whether it took the fast path (no plan round, one reviewer).
3. **Rollback plan:** the one step from `rd.md`.
4. **Changes:** `git diff --stat <base_sha>..HEAD` and `git log --oneline <base_sha>..HEAD`.
5. **Verdict:** LOW: "Ready to merge." MEDIUM/HIGH (from `/quorum:blind-test`): "Waiting for your review", with
   the files most worth reading.
6. Non-blocking findings (`[NIT]`, `[PRE-EXISTING]`) and any "Needs a human" items (accessibility, docs outside
   the repo), to consider separately.

After a LOW summary, suggest `/quorum:pr-draft`.
