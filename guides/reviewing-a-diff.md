# Reviewing any diff

[← Back to the README](../README.md)

`/quorum:review` runs the review loop's reviewers and voter on a diff that isn't a Quorum task: the current
branch, a pull request (`123` or its URL), or a git range (`main..HEAD`). It needs no spec, no plan, and no
bootstrap.

```
/quorum:review                 # this branch against the default branch
/quorum:review 123             # a GitHub PR; add --comment to post the findings on it, after you approve them
```

- **Intent instead of a spec.** The reviewers judge the change against the PR's description, or the commit
  messages for a branch or range, and the code.
- **The same reviewers, by tier.** It proposes a risk tier from what the diff changes and you confirm it (or pass
  `--tier`), which picks the reviewers exactly as the review loop does, plus the security reviewer for HIGH. One
  round, then the voter.
- **Without `REVIEW.md`,** reviewers follow the template's general rules, and the report suggests
  `/quorum:init-pipeline` for rules tailored to the repo.
- **`--comment`** turns the kept `[IMPORTANT]` findings into a GitHub review: inline comments where the line is in
  the PR's diff, the rest in its summary. It shows you every comment and posts nothing without your yes.
- **`--fix`** has the builder fix the kept findings in one commit. The Stop hook checks its work as it does in a
  task, so it needs `verify-completion.sh`; then it offers a review of the fix.
- **A wrong finding becomes a rule.** `/quorum:codify-lesson` reads a review's runs as it reads a task's rounds, so
  a false alarm the voter kept, or one it keeps dropping, can become a line in `REVIEW.md` for the next review.

Each review keeps its runs in `.tasks/review-<id>/` (`review-pr-123`, `review-feat-csv-export`), apart from any
task, so running it again on the same PR reuses its model choice. On a Quorum task's own branch it sends you to
`/quorum:review-loop`, which checks the code against the task's spec and plan.
