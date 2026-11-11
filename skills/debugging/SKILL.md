---
name: debugging
description: Quorum's debugging habit: reproduce a failure, read the whole error, check what changed, and name the root cause with evidence before changing any code. Use when a test, check, build, or command fails, or a bug is reported, and the cause isn't already proven. It only diagnoses and fixes the failure in front of you; it never starts a Quorum command.
---

# Root cause before fixes

A fix for a cause you haven't found is a guess, and a guess that makes the check pass can hide the bug. Find the
cause first. This skill fixes the failure in front of you; it never starts `/quorum:*` commands or a review.

## 1. Reproduce it

Run the exact failing command yourself and watch it fail. Note the command, and trim it to the smallest one that
still fails (one test, one input). A failure you can't reproduce isn't understood yet: say what you ran and what
happened, and ask for the missing piece (the input, the environment, the steps) instead of fixing blind.

## 2. Read the whole error

Read the full output, not its last line: the first failure (later ones often follow from it), the whole stack
trace down to the frame in this repo's code, and the exact values in the message. Quote the lines that matter.

## 3. Check what changed

If it used to work, the cause is usually in what changed: `git diff <base>` (a task's `quorum-state get base_sha`),
`git log -p` on the file the trace points to, a dependency or lockfile change, or the environment (versions,
variables, data). For a regression with a known good commit, `git bisect run <the reproduction>` finds it.

## 4. Name the root cause, with evidence

Write one sentence: what happens, at which `file:line`, and why. Then test that hypothesis cheaply before changing
anything: a print, a minimal input, a debugger, a single assertion. If the evidence disagrees, drop the hypothesis
and form another from what you learned. After three that don't hold, stop and report what you tried, what each
showed, and what you'd need to go further.

## 5. Fix the cause, then prove it

- Change the code at the cause, not where the symptom shows. Then look for the same mistake elsewhere in the
  files you touched.
- Never make a check pass by weakening it: don't loosen an assertion, skip a test, widen a timeout, or edit the
  check script or a lint config. During a Quorum task a hook blocks those, and the reviewers flag them.
- Rerun the reproduction (it passes now), then the repo's checks (`bash .claude/hooks/verify-completion.sh` in a
  bootstrapped repo). For a bug, add a test that fails without the fix, if there isn't one.

## Report

The reproduction, the root cause with its evidence, the fix, and the passing output. If you stopped at step 4,
the hypotheses and what disproved each.
