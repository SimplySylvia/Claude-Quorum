---
name: review-loop
description: Run Quorum's review loop on the active task. Fresh-context reviewers audit only the new lines, a verifier-voter drops false alarms, and the builder fixes each surviving Pattern Category everywhere it appears, for up to max_rounds rounds. Ends CONVERGED (LOW tasks get their final summary) or HALTED with a post-mortem. Run after /quorum:build and /quorum:simplify-diff, and again after /quorum:blind-test finds problems.
disable-model-invocation: true
---

# Review loop

You are the orchestrator. You don't review or fix code yourself: reviewers review, the voter votes, the builder
fixes. Your job is to give each of them exactly the right inputs, keep the record, and stop when the rules say.

Work on the active task (`quorum-active-task`) from the repo root. Use `quorum-state`, `quorum-branch`, and
`quorum-findings` (on your PATH) for state, ranges, and counting; never hand-edit `state.md` frontmatter.
Settings: `max_rounds` = ${user_config.max_rounds}, `nit_cap` = ${user_config.nit_cap}. If either still reads as a
`${user_config…}` placeholder, the user hasn't set it: use the defaults, `max_rounds` 3 and `nit_cap` 2.

Keep each round's files in `.tasks/<slug>/review/round-<N>/`.

## 0. Preconditions

- Status (`quorum-state get status`) must be `BUILDING` or `IN_REVIEW`. Otherwise say which command comes next
  (`pipeline-laws` has the stage map) and stop.
- `base_sha` must be set and the working tree clean (`git status --porcelain --untracked-files=no` empty). If not,
  say so and stop.

## 1. Pending findings first

If `quorum-state get pending_findings` lists anything (from `/quorum:blind-test`), fix those before reviewing:

1. Write the items, one per block, to `.tasks/<slug>/review/pending-<n>.md`.
2. `quorum-branch record` (so the next review sees only the builder's changes).
3. Start the builder (step 4 below) with that file as its findings. Then `quorum-state clear pending_findings`.

## 2. Each round

Let N = `quorum-state get round` + 1. Stop the loop if N > max_rounds (see step 5).

1. `quorum-state set round N` and `quorum-state set status IN_REVIEW`.
2. `RANGE=$(quorum-branch range)`. If `git diff --quiet $RANGE` (nothing new to review) and N > 1, the previous
   round's findings were not fixed; treat that as a failed round.
3. **Start the reviewers in one message, in parallel** (they must not see each other or you). Risk tier from
   `quorum-state get risk`:
   - LOW: one `quorum:code-reviewer`, persona **Logic & Edge-Case Hunter**.
   - MEDIUM, HIGH: two `quorum:code-reviewer`s, **Logic & Edge-Case Hunter** and **Architecture, Security & Drift
     Hunter**.

   Each gets only this prompt (fill in the values), never your own notes or the builder's report:

   > Persona: <persona>. Task: `<slug>`. Review the diff range `<RANGE>` (`git diff <RANGE>`) in this repo.
   > Read `REVIEW.md`, `CLAUDE.md`, `.tasks/<slug>/rd.md`, and `.tasks/<slug>/eval.md`. This is round <N>
   > <for N > 1: "; earlier rounds already reviewed the rest of the branch, so review only these lines and their
   > immediate callers">.

4. Save each reviewer's reply **verbatim** to `round-<N>/<persona-slug>.md` (`logic.md`, `architecture.md`), and
   both together to `round-<N>/candidates.md`.
5. **Vote.** Start `quorum:verifier-voter` with:

   > Task: `<slug>`. Candidate findings: `.tasks/<slug>/review/round-<N>/candidates.md`. Read `REVIEW.md` and
   > `.tasks/<slug>/rd.md`, check each finding against the code, and vote.

   Save its reply verbatim to `round-<N>/survivors.md`, then `quorum-findings cap <nit_cap> survivors.md` back over it.
   Run `quorum-findings check survivors.md`; if it fails, ask the voter once to fix the format.
6. **Log the round:** pipe a short block to `quorum-state log`:
   `## Round <N> (<RANGE>)`, the `quorum-findings summary` line, the Pattern Categories, and the dropped count.
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

- **MEDIUM or HIGH:** say the review loop converged after N rounds, list the non-blocking findings, and that the
  next step is `/quorum:blind-test`.
- **LOW:** print the **Stage 7 summary** below, then `quorum-state set status READY` and
  `quorum-active-task --clear`.

### Stage 7 summary

1. **Verification proof:** run `bash .claude/hooks/verify-completion.sh` and the `eval.md` task checks now; show
   that they pass (if they don't, say so and don't mark the task READY).
2. **Risk tier**, and the rounds it took.
3. **Rollback plan:** the one step from `rd.md`.
4. **Changes:** `git diff --stat <base_sha>..HEAD` and `git log --oneline <base_sha>..HEAD`.
5. **Verdict:** LOW: "Ready to merge." MEDIUM/HIGH (from `/quorum:blind-test`): "Waiting for your review", with
   the files most worth reading.
6. Non-blocking findings (`[NIT]`, `[PRE-EXISTING]`) to consider separately.
