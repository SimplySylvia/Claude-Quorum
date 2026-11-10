---
name: review
description: Review any diff with Quorum's reviewers and verifier-voter, with no task, spec, or plan needed. Reviews the current branch, a GitHub pull request, or a git range; picks reviewers by risk tier; and reports the findings the voter kept, with confidence. --comment posts them on the PR after you approve; --fix has the builder fix them, with the Stop hook checking its work. Use on a PR you already have; Quorum tasks use /quorum:review-loop.
disable-model-invocation: true
argument-hint: "[PR number or URL | git range] [--comment] [--fix] [--tier LOW|MEDIUM|HIGH] [--models] [--yes]"
---

# Review a diff

You are the orchestrator. You don't review or fix code yourself: reviewers review, the voter votes, and with `--fix`
the builder fixes. Give each of them exactly the right inputs, keep the record, and report.

Work from the repo root (`quorum-active-task --root`). Use `quorum-state`, `quorum-findings`, and `quorum-branch`
(on your PATH). Always call `quorum-state` with `--task <id>`: a review is never the active task. Don't run git
commands that change the working tree, index, or history, except the PR checkout in step 2 after the user agrees.

`$ARGUMENTS` holds an optional target (nothing, a PR number or URL, or a git range such as `main..HEAD`) and these
flags: `--comment`, `--fix`, `--tier <LOW|MEDIUM|HIGH>`, `--models`, and `--yes` (only when the user typed it: accept
your proposed tier without asking, and say what you chose).

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

## 1. Preconditions

- On a Quorum task's own branch (`quorum-active-task` prints a slug and `git branch --show-current` is
  `feat/<slug>` or `fix/<slug>`), stop: say that task's reviews belong to `/quorum:review-loop`, which checks the
  code against its spec and plan.
- `--comment` needs a PR target. `--fix` needs `.claude/hooks/verify-completion.sh` (otherwise suggest
  `/quorum:init-pipeline` and stop), a clean working tree (`git status --porcelain --untracked-files=no` empty),
  and a branch other than `quorum-branch default`.

## 2. Resolve the target

Pick the range to review, the review's id, and its intent:

| Target | Range | Id | Intent |
|---|---|---|---|
| nothing | `$(git merge-base HEAD <default>)..HEAD`, where `<default>` is `quorum-branch default`. On the default branch itself there's nothing to compare: ask for a PR or range and stop | `review-<branch>` | the commit messages: `git log --format='%s%n%n%b' <range>` |
| a PR number or URL | read it with `gh pr view <pr> --json number,title,body,url,headRefOid,baseRefName`. If `headRefOid` isn't `git rev-parse HEAD`, ask the user whether to check it out with `gh pr checkout <number>` (it needs a clean working tree); if they say no, stop. Then `$(git merge-base HEAD origin/<baseRefName>)..HEAD`, fetching the base branch first if `origin/<baseRefName>` is missing | `review-pr-<number>` | the PR's title and description |
| a range | as given, after `git rev-parse --verify` passes for both ends | `review-<short sha of the end>` | the commit messages in the range |

In an id, replace every character other than letters, digits, `.`, `_`, and `-` with `-` (so `feat/csv-export`
becomes `review-feat-csv-export`). Resolve both ends of the range to full SHAs, so the record stays true after new
commits. If `git diff --quiet <range>` succeeds, there's nothing to review: say so and stop.

## 3. Pick the tier

With `--tier`, use it. Otherwise propose one from what the range changes (`git diff --stat <range>`, and the code
where it isn't clear), with a one-line reason, using `/quorum:spec-and-eval`'s rule: anything a user can see or run
(a command, flag, endpoint, page, or output format) is at least **MEDIUM**; auth, money, data deletion or
migration, security boundaries, and build pipelines are **HIGH**; **LOW** is only what a user can't reach (docs,
tests, internal refactors covered by tests). Ask the user to confirm or change it (skip with `--yes`).

## 4. The review's folder

1. Make sure `.tasks/` is ignored (`git check-ignore -q .tasks/`). If it isn't, add `.tasks/` to
   `.git/info/exclude`, which stays local, and say so.
2. `.tasks/<id>/` keeps every run of this review. If `.tasks/<id>/state.md` doesn't exist, create it with
   `quorum-state --task <id> init <TIER> REVIEWING` and `quorum-state --task <id> set kind review`. Either way,
   then `set risk <TIER>`, `set range <range>`, and `set status REVIEWING`.
3. Let N be the number of `run-*` folders plus 1; this run's files go in `.tasks/<id>/run-<N>/`.
4. Write the intent from step 2 to `.tasks/<id>/intent.md`, under a first line saying where it came from.

## 5. Models

Resolve the reviewer model as in `${CLAUDE_PLUGIN_ROOT}/skills/pipeline-laws/models.md` (configured default:
`reviewer_model` = ${user_config.reviewer_model}), with `--task <id>`. Only the reviewer choice applies here; the
builder runs on the session's model.

## 6. Review

**The rules the reviewers follow:** `REVIEW.md` if the repo has one. Otherwise
`${CLAUDE_PLUGIN_ROOT}/skills/init-pipeline/templates/REVIEW.md`, sections 1, 2, and 5 (its sections 3 and 4 are
placeholders for `/quorum:init-pipeline` to fill in). Call this `<RULES>` below.

1. **Start the reviewers in one message, in parallel**, each with `reviewer_model` (they must not see each other
   or you). Changed files from `git diff --name-only <range>`:

   | Reviewer | Persona or mode | When | Saved as |
   |---|---|---|---|
   | `quorum:code-reviewer` | **Logic & Edge-Case Hunter** | always | `logic.md` |
   | `quorum:code-reviewer` | **Architecture, Security & Drift Hunter** | MEDIUM, HIGH | `architecture.md` |
   | `quorum:pattern-auditor` | (none) | MEDIUM, HIGH | `patterns.md` |
   | `quorum:docs-auditor` | (none) | MEDIUM, HIGH, or any tier when the range changes docs | `docs.md` |
   | `quorum:code-reviewer` | **Test Adequacy Hunter** | the range changes tests (paths with `test`, `spec`, `__tests__`, `e2e`, `cypress`) | `tests.md` |
   | `quorum:a11y-auditor` | mode **diff** | the range changes UI (markup, components, styles: for example `.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`) | `a11y.md` |
   | `quorum:security-reviewer` | (none) | HIGH, or MEDIUM with `${user_config.security_on_medium}` `true` | `security.md` |

   Each gets only this prompt (fill in the values; leave out the persona line for the auditors and the security
   reviewer, and use "Mode: diff" for the a11y auditor):

   > Standalone review. Persona: <persona>. Review the diff range `<range>` (`git diff <range>`) in this repo.
   > There's no task spec or plan: the change's intent is in `.tasks/<id>/intent.md`. Read `<RULES>` and follow it,
   > and `CLAUDE.md` if it exists.

2. Save each reply **verbatim** to `run-<N>/<file>` from the table, and all of them together to
   `run-<N>/candidates.md`.
3. **Vote.** Start `quorum:verifier-voter`, with `reviewer_model`:

   > Standalone review. Candidate findings: `.tasks/<id>/run-<N>/candidates.md`. There's no `rd.md`: the change's
   > intent is in `.tasks/<id>/intent.md`. Read `<RULES>`, check each finding against the code, and vote.

   Save its reply verbatim to `run-<N>/votes.md`. Then, in `.tasks/<id>/run-<N>/`,
   `quorum-findings cap <nit_cap> votes.md > survivors.md` (`nit_cap` is ${user_config.nit_cap}, or 2 if that
   reads as a placeholder). Run `quorum-findings check survivors.md`; if it fails, ask the voter once to fix the
   format.
4. **Log the run:** pipe a short block to `quorum-state --task <id> log`: `## Run <N> (<range>, <TIER>)`, the
   `quorum-findings summary` line, the Pattern Categories, and the number of `DROP` lines in `votes.md`. Then
   `quorum-state --task <id> set status REVIEWED`.

## 7. Report

- The `quorum-findings summary` line, then the kept findings: `[IMPORTANT]` first, then `[PRE-EXISTING]`, then
  `[NIT]`, each group from most to least confident.
- Any `## Needs a human` items.
- What the voter dropped, one line each with its reason, so the user can say a drop was wrong.
- Where the files are (`.tasks/<id>/run-<N>/`), and the next steps that apply: `--comment` for a PR, `--fix` when
  `[IMPORTANT]` findings survive, and `/quorum:init-pipeline` when the repo has no `REVIEW.md` (the review used
  the generic rules).

## 8. `--comment`: post on the PR

Post only `[IMPORTANT]` findings, and `[PRE-EXISTING]` or `[NIT]` ones only if the user asks.

1. For each finding, check its `file:line` is inside a hunk of `git diff <range> -- <file>`; GitHub refuses inline
   comments elsewhere. Those that are become inline comments: `path`, `line`, `side: "RIGHT"`, and a body with the
   tag, the Pattern Category, the confidence, and the Mechanism. The rest go in the review's summary body, with
   their `file:line`.
2. Write the request to `run-<N>/comments.json`: `{"commit_id": "<end SHA>", "event": "COMMENT", "body": "<summary
   line, then the findings that couldn't go inline>", "comments": [...]}`.
3. **Show the user every comment and the summary body, and ask before posting.** Post nothing without a yes.
4. Post with `gh api --method POST repos/{owner}/{repo}/pulls/<number>/reviews --input run-<N>/comments.json`,
   then give the review's URL from the response.

## 9. `--fix`: have the builder fix the kept findings

Only when `[IMPORTANT]` findings survive.

1. `quorum-state --task <id> set status FIXING`, then `printf '%s\n' <id> > .tasks/.review-fix-active`. While this
   file exists, the builder's SubagentStop hook runs `verify-completion.sh` against this review, so the builder
   can't hand back with failing checks.
2. Start `quorum:builder` with:

   > Standalone review, `<id>`. Fix the `[IMPORTANT]` findings in `.tasks/<id>/run-<N>/survivors.md` (run
   > `quorum-findings important` on it). Each has a Pattern Category: fix the cited line and every other instance
   > of that pattern in the files the reviewed range touched (`git diff --name-only <range>`). Run the checks and
   > commit one fix commit. Categories: <`quorum-findings categories`>.

3. **Always** remove the marker afterwards, even if the builder failed: `rm -f .tasks/.review-fix-active`.
4. If the status is now `ESCALATED` (the checks failed 3 times in a row), say so, show the last failure, and stop.
   Otherwise `quorum-state --task <id> set status REVIEWED`, log the builder's commits with
   `quorum-state --task <id> log`, and show its report: the changes, the commit, and the passing checks.
5. Offer to review the fix with `/quorum:review <fix commit's parent>..HEAD`. Don't start it yourself.
