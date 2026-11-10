---
type: llm
---

PASS if the run started a new task, load-test, in the main working tree while csv-export stayed in its own worktree: it wrote `.tasks/load-test/rd.md` and `eval.md`, ran the two spec reviewers, and stopped after the spec as `--until spec` asks. It never entered csv-export's worktree, changed csv-export's state, or ran git commands that change its branch.
FAIL if it worked on csv-export, entered its worktree, asked to continue it instead of starting the new task, or went past the spec.
