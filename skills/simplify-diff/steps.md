<!-- The steps of /quorum:simplify-diff, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Simplify the diff

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

Reviewers should see the smallest, clearest change that meets the spec. Work on the active task
(`quorum-active-task`) from the repo root.

**Worktree.** If `quorum-state get worktree` prints a path and `quorum-active-task --code` prints another, the
task's code is in its own git worktree: call `EnterWorktree` with that `path` first, so you and the agents you start
work there. In a worktree, run one simple command per Bash call, with no `&&`, pipes into `bash` or `python`, or
variables in a git command: Claude Code refuses a command it can't show stays inside the worktree.

1. Status must be `BUILDING` or `IN_REVIEW`, and `base_sha` must be set (`quorum-state get base_sha`). Otherwise
   say which command comes next and stop.
2. Read `.tasks/<slug>/rd.md` and `eval.md`. Then read the whole change: `git diff <base_sha>` (committed and
   uncommitted) and `git diff --stat <base_sha>`.
3. Remove, only within lines this task added or changed:
   - debug output (`console.log`, `print`, `dbg!`, `fmt.Println` left from debugging) and commented-out code;
   - unused imports, variables, functions, and files;
   - abstractions with one caller that make the code harder to read, and options nobody uses;
   - changes unrelated to `rd.md` (reformatting, renames, drive-by edits). Mention any real bug you notice in
     untouched code instead of fixing it.
   Don't change behavior, and don't touch lines this task didn't change.
4. Run `bash .claude/hooks/verify-completion.sh` and the `eval.md` task checks. If anything fails, undo the
   simplification that broke it.
5. If you changed anything, commit it as one commit following the repo's commit message style (for example
   "Simplify <slug>"). Show `git diff --stat <base_sha>` before and after.

The next step is `/quorum:review-loop`.
