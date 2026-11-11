<!-- The steps of /quorum:build, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Build the active task

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

Use the slug in `<arguments>`, or `quorum-active-task`. Work from the repo root.

**Picking up a sliced build.** If `base_sha` is set and `quorum-state get built_steps` lists any step, an earlier
build stopped partway: skip to step 3 and build from `quorum-plan next`.

**Worktree.** If `quorum-state get worktree` prints a path and `quorum-active-task --code` prints another, the
task's code is in its own git worktree: call `EnterWorktree` with that `path` first, so you and the agents you start
work there. In a worktree, run one simple command per Bash call, with no `&&`, pipes into `bash` or `python`, or
variables in a git command: Claude Code refuses a command it can't show stays inside the worktree.

**Unfinished reviews.** First run `quorum-reviews heal <session>`. It marks any `/quorum:review` this session left
unfinished as `INTERRUPTED`, and removes a `--fix` marker it left, which would otherwise point this task's builder
at the review. If it prints ids, mention them in one line.

## 1. Check the status

`quorum-state get status` must be `BUILDING`, and `quorum-state get plan_approved` must be set (`/quorum:plan`
records it when the user approves `plan.md`), unless `quorum-state get fast` is `true`: a fast-path task has no plan.
Otherwise say what the status is and which command comes next (see
the `pipeline-laws` skill's stage map), then stop.

## 2. Branch

**In its own worktree** when `<worktrees>` is `true` or `<arguments>` contains `--worktree` (a setting that reads as
a placeholder is off). The task's branch gets its own git worktree, so this working tree stays free: you can spec or
build another task here meanwhile.

1. `quorum-branch start <slug> --worktree` (add `--fix` when `quorum-state get bug` is `true`, or `rd.md` describes a
   bug fix). It prints the branch,
   then the worktree's path, and records both `base_sha` and `worktree`. Exit 3 means `CLAUDE.md`, `REVIEW.md`, or
   the check script isn't committed (a worktree gets committed files only): show what it printed, say the task
   builds in this working tree instead, and go on below.
2. **Set it up.** A new worktree has no installed dependencies. Run the **Setup** command from `CLAUDE.md`'s
   Verification Commands in the worktree: `cd <path> && <setup>`. If `CLAUDE.md` has no Setup line, ask the user
   once what a fresh checkout needs (offer `quorum-detect-stack`'s `setup`, and "nothing"), run it, and offer to add
   the answer as `- **Setup:** <command>` to `CLAUDE.md`'s Verification Commands in the main working tree. If it
   fails, show the output and stop: the checks can't pass without it.
3. **Move in.** Call `EnterWorktree` with `path` set to the worktree, so this session and every agent after it
   work there, and run one simple command per Bash call from then on (see **Worktree** above). Say where the task
   is, in one line. If you have no `EnterWorktree` tool (some hosts, such as plugin
   evals, don't offer it), the agents can't follow the task into the worktree: run `quorum-branch remove <slug>`
   (the branch stays), say why in one line, and go on below, which checks that branch out in this working tree.

**Otherwise,** run `quorum-branch start <slug>` (add `--fix` when `quorum-state get bug` is `true`, or `rd.md`
describes a bug fix). It creates or
switches to the branch and records `base_sha`. If it refuses because of uncommitted changes, show `git status` and
ask the user to commit or stash. Never discard their changes.

## 3. Run the builder

Start the `quorum:builder` agent with this prompt (fill in the slug):

> Build task `<slug>` from its approved plan. Read `CLAUDE.md`, `REVIEW.md`, `.tasks/<slug>/rd.md`,
> `.tasks/<slug>/eval.md`, and `.tasks/<slug>/plan.md`. Implement the plan's steps on the current branch, run the
> checks, and commit. Note any deviation from the plan under its `## Deviations`. This is the first build; there are
> no review findings yet.

On the fast path, use this prompt instead:

> Build task `<slug>` from its spec; it's on the fast path, so there's no `plan.md`. Read `CLAUDE.md`, `REVIEW.md`,
> `.tasks/<slug>/rd.md`, and `.tasks/<slug>/eval.md`. Make the smallest change that meets the requirements on the
> current branch, run the checks, and commit. This is the first build; there are no review findings yet.

The builder's SubagentStop hook keeps it working until `.claude/hooks/verify-completion.sh` passes.

**A large plan is built a step at a time.** If `quorum-plan sliced` exits 0 (`plan.md` has 4 or more steps, and
the task isn't on the fast path), don't start one builder for the whole plan. One agent's context would have to
hold all of it, and a cut-off build would start again from nothing. Instead, while `quorum-plan next` prints a
step K (N is the number of `quorum-plan steps`):

1. Start `quorum:builder`, with `<mechanical_model>` as its `model` when `quorum-plan mechanical K` exits 0 and
   that setting is set (empty, or reading as a placeholder, means the session's model), with:

   > Build step K of task `<slug>`'s approved plan, and only that step. Read `CLAUDE.md`, `REVIEW.md`,
   > `.tasks/<slug>/rd.md`, `.tasks/<slug>/eval.md`, and `.tasks/<slug>/plan.md`. Steps <`quorum-state get
   > built_steps`, or "none"> are built and committed; don't redo them, and don't start later steps. Step K:
   > <`quorum-plan show K`>. Leave the repo's checks passing, commit one commit for this step, and note any
   > deviation under the plan's `## Deviations`. There are no review findings yet.

2. When it hands back (its SubagentStop hook has made the checks pass), `quorum-state push built_steps K`, and say
   one line: `▸ Build step K/N: <what it did>, <commit>`.

If a step can't be finished (the checks keep failing and the task escalates), stop and say which step. The next
`/quorum:build` or `/quorum:run` starts at that step, not at the beginning. When `quorum-plan next` prints
nothing, every step is built: go on to the proof.

## 4. Report

Show the builder's report (changes, commits, check output). Then start `quorum:prover`:

> Task `<slug>`. Run `bash .claude/hooks/verify-completion.sh` and every row in `.tasks/<slug>/eval.md`. Read
> `CLAUDE.md` first.

Save its reply verbatim to `.tasks/<slug>/proof-build.md` and show it. If any row fails, say which, and offer to
start the builder again with the failures.

The next steps are `/quorum:simplify-diff`, then `/quorum:review-loop`.
