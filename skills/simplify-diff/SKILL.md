---
name: simplify-diff
description: Shrink the active Quorum task's diff before review. Removes debug output, dead code, commented-out code, unused imports, needless abstractions, and changes unrelated to rd.md, then re-runs the checks and commits. Run after /quorum:build and before /quorum:review-loop.
disable-model-invocation: true
---

# Simplify the diff

Reviewers should see the smallest, clearest change that meets the spec. Work on the active task
(`quorum-active-task`) from the repo root.

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
