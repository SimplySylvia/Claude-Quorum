# The dashboard

[← Back to the README](../README.md)

While a task is active, Quorum shows where it is without you asking:

<p align="center">
  <img src="../assets/dashboard-review.png" alt="Claude Code with the Quorum dashboard docked on the right, for the task &quot;Export the sales rows as CSV&quot;, ticket SALES-12. The task card: csv-export, IN_REVIEW, MEDIUM, the goal, the stepper with Spec, Plan, and Build ticked and Review at round 2 of 3, and the plan&#39;s 2 review rounds, approved 2026-11-08. The Now card, code review round 2 of 3: 2 of 4 reviewers replied, Logic and edge cases clean, Architecture and drift 1 NIT, Patterns, Docs, and the verifier vote waiting, and a Next button for /quorum:review-loop that fills the prompt. Below, folding sections: Requirements opened by itself, 3 of 4 met, requirement 1 failing, then what&#39;s out of scope; Checks opened by itself, 5 of 6 pass, a warning that the proof ran before HEAD, and a PASS or FAIL badge on each check, with 1b, honors DATA_FILE, failing; Review rounds folded to r1 1 IMPORTANT, r2 reviewing; Other tasks folded to 1 unfinished task, 1 in worktrees. Above the prompt, the band: an IN_REVIEW badge, csv-export, MEDIUM, a dot per stage, Review 2/3, reviewers 2/4, checks 5/6, 1 check failing and proof older than HEAD in red, the Next button, and Dashboard." width="880">
</p>
<p align="center">
  <img src="../assets/dashboard-done.png" alt="The same task finished. The task card: AWAITING-HUMAN, every stage ticked and the PR stage waiting, the plan&#39;s 2 review rounds approved 2026-11-08 and 1 blind-test run, and PR #42 as a link with a copy button. The Now card, its border amber because the task waits on you: waiting for you, next, get PR #42 reviewed and merged. Every section folded to its summary, nothing wrong: Requirements 4 of 4 met, Checks 6 of 6 pass, Review rounds r1 1 IMPORTANT, r2 clean, and Other tasks, 1 unfinished task, 1 in worktrees. Above the prompt, the band: an AWAITING-HUMAN badge, csv-export, MEDIUM, five ticked dots and the PR&#39;s, PR #42, checks 6/6, and Dashboard." width="880">
</p>

<sub>Both are the demo task from `assets/src/dashboard-demo.sh` (see [CONTRIBUTING.md](../CONTRIBUTING.md)): mid-review, and
finished with its PR open.</sub>

- **The band above the prompt:** the task's status, a dot per stage, the round's progress, anything wrong in red,
  and **▶ Next** and **Dashboard** buttons.
- **The pane,** which opens by itself during a task (`/quorum-dashboard` shows or hides it):
  - **Task card:** title, goal, status, a stage stepper, and the PR once there is one.
  - **Now card:** what the current stage is doing, such as each reviewer's progress and the findings the voter
    kept. Its border turns amber when it's your move and red when the task is stuck.
  - **Folding sections:** Requirements, Checks, Review rounds, Spend (tokens and models used, the models the task
    chose, and a warning when an agent ran on another), Other tasks, and Other agents. A section with a problem opens
    by itself.
- **▶ Next** puts the next command in your prompt to send or edit. It never sends it for you.
- **Toasts** when a task converges, halts, escalates, or is ready for you.
- **`/quorum:review`:** the one this session is running gets a card of its own, with its reviewers, the voter's
  kept findings, and the builder during `--fix`. It sits under a task's cards, or takes the band and pane when
  there's no task. Finished reviews stay in a **Reviews** section, and an unfinished one is flagged as interrupted.

The pane docks beside the chat in a wide fullscreen terminal, and sits above the prompt otherwise. The dashboard only
reads `.tasks/`, so `claude -p`, cloud sessions, and the VS Code chat panel work as before, without it. It shows
tasks and reviews; maps and research aren't on it yet.
