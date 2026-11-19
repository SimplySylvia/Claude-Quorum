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

- **The band above the prompt:** the task's status, a dot per stage, the round's progress, the change's file count
  (`12 files`) once the band is 110 columns wide or more, anything wrong in red, and **▶ Next** and **Dashboard**
  buttons. The 110 columns are the band's own width, not the terminal's, so a docked pane narrows the band and can
  hide the count; undock or close the pane, or widen the terminal, to see it. A requirement that a current proof
  leaves unmet comes first in what's wrong (`R3 unmet`, or `2 unmet`), since a narrow band shows only the first
  problem, and a stale proof's progress reads `checks stale` instead of `checks 24/24`.
- **The pane,** which opens by itself during a task (`/quorum-dashboard` shows or hides it):
  - **Task card:** title, goal, status, a stage stepper, and the PR once there is one. Once the build has started,
    a footprint line sums up the change: `12 files · +268 −11 · 1 important · 1 nit · 1 pre`, naming the findings
    the latest voted code review round kept. An important finding awaiting re-review counts as
    `1 awaiting re-review`, as the tree shows it, not as important. It reads `no findings` after a vote that kept
    none, `not reviewed yet` before any vote, and adds `as of a1b2c3d` when the list was recorded at an older commit
    than the current one. The folded Files row (below) has the same summary. From `CONVERGED` on, while a current
    proof leaves a requirement unmet, the stepper's Review stage shows `!` in amber instead of `✓`, and the line
    under the stepper starts `converged with requirement 3 unmet` (or `converged with 2 requirements unmet`).
  - **Now card:** what the current stage is doing, such as each reviewer's progress and what it found, the voter's
    verdict and the next step, the plan's steps from Plan on, and a
    [tree of the task's changed files](#the-file-tree) with the findings the voter kept under their files. Its
    border turns amber when it's your move and red when the task is stuck. From `CONVERGED` on, while a current
    proof leaves a requirement unmet, its title gains ` · R3 unmet` (or ` · 2 unmet`) in amber.
    - **At the PR handoff** (`READY` and `AWAITING-HUMAN`), a **▸ Blind test** row shows the last blind run, such as
      `▸ Blind test  run 1 · reached · 0 blockers · 0 caused`, directly under the title, or under the "Every stage is
      done" line when that shows (it's left out once a PR is known), and before the Plan steps. ` · a11y 1` and
      ` · security 1` join it when the accessibility or security report kept an IMPORTANT. It reads `no report` in
      place of `reached` when the run has no `blind-R.md` (or no `Result:` in it), and `triage: no report` in place
      of `0 caused` with no `triage-R.md`. It's green when the run reached the goal with no blocker, nothing caused,
      and no accessibility or security IMPORTANT, and amber otherwise. An amber row puts what makes it so first, in
      the order security, a11y, caused, blockers, not reached, no report, triage: no report, so a narrow pane still
      shows it: `run 2 · security 1 · reached · 0 blockers · 0 caused`. Its label keeps the usual order, in words:
      `Blind test, run 1, reached the goal, 0 blockers, 0 caused, folded`. A press opens it to the rows the Blind
      test stage shows for that run: the blind user and friction triage (each `no report` when its file is
      missing), and the accessibility and security reports when they were written. An amber row opens by itself,
      and a press's choice is kept per task. A LOW task, a task with no blind run, and the Blind test stage itself
      show no such row.
  - **Folding sections:** Requirements, Checks, Review rounds (the plan's rounds and the code's, side by side), Spend
    (tokens and models used, the models the task chose, and a warning when an agent ran on another), Other tasks,
    and Other agents. A section with a problem opens by itself.
    - **Requirements:** with a proof saved, the summary reads `3 of 4 met`: green when all are met, red when a final
      proof's verdict leaves one unmet, and amber otherwise (a failing check, or a requirement still open or with no
      check). While one is unmet, the note names the first in rd.md order and counts the rest:
      `R3 Export honors DATA_FILE unmet, and 1 more`. It sits beside the summary when it fits, and on its own line
      under the row otherwise, where only the title is cut (or left out when even `R3 unmet, and 1 more` fills the
      line). The stepper, the Now title and the band show an unmet requirement too, from `CONVERGED` on, and only
      from a proof that isn't stale, since a stale proof's failures may already be fixed; this row shows it either
      way.
    - **Checks:** the summary names the commit the proof ran at, `24/24 pass @ eb6c1c1`, and adds `· stale` when
      that commit isn't HEAD, as after a fix commit: `24/24 pass @ eb6c1c1 · stale`. A stale proof never reads as
      passing: its summary is amber (red when a check failed), the PASS badges in the opened fold are muted rather
      than green, and the band reads `checks stale`. In a narrow pane the note gives way first, then the commit.
- **▶ Next** puts the next command in your prompt to send or edit. It never sends it for you.
- **Toasts** when a task converges, halts, escalates, or is ready for you.
- **`/quorum:review`:** the one this session is running gets a card of its own, with its reviewers, the voter's
  kept findings as the same findings tree, and the builder during `--fix`. It sits under a task's cards, or takes
  the band and pane when there's no task. Finished reviews stay in a **Reviews** section, and an unfinished one is
  flagged as interrupted. A finished review's row opens to its findings tree too.

The pane docks beside the chat in a wide fullscreen terminal, and sits above the prompt otherwise. The dashboard reads
`.tasks/`, and runs two commands in the background: `gh`, for the task's PR, and, for a [map](#maps), the plugin's
`bin/quorum-map tasks`, which asks git, or GitHub through `gh` when a task records a PR, whether a task merged. None of
it holds up a turn, and `claude -p`, cloud sessions, and the VS Code chat panel work as before, without it. It shows
tasks, reviews, and maps; research isn't on the dashboard.

## Maps

A [map](research-and-maps.md) shows in two places: as a **Map card** on a task started from it, and as the whole pane
in a `/quorum:map` session.

### The Map card

When the task on show records `map` and `map_task` in its state.md, and that map's files read, a Map card sits
directly above the Task card. Above the prompt, the order is the Now card, the Task card, then the Map card. A task
with no map, or whose map folder is missing, has no Map card and looks as it did.

- **The title row:** `Map · <title>` with the map's slug on the right; a long title is cut at the end and never runs
  into the slug.
- **The stepper:** the map's four phases, `Chart · Tickets · Hand off · Tasks`, such as
  `✓ Chart ● Tickets 2/4 in scope ○ Hand off ○ Tasks 1/3`. A done phase is `✓`, the current one `●`, or `◆` in amber
  when the map waits on you, and a later one `○`. The map is in Chart while it has no tickets, in Tickets while any ticket is
  open or claimed, in Tasks once `tasks.md` exists and its breakdown review has voted, or a task names the map, and
  in Hand off between them. `Tickets 4/4` counts resolved of in-scope tickets (out-of-scope ones aren't counted), and
  reads `Tickets 4/4 in scope` whenever a ticket is out of scope, so it doesn't seem to disagree with the tickets'
  summary, which counts them all. `Tasks 1/3` counts merged of all tasks.
- **The task line:** `task 1 of 3 · Export the sales rows as CSV`, then `· next: 3 <request>` when another task is
  ready, and `· task states unknown` until the first [task states](#where-task-states-come-from) arrive. A
  `map_task` beyond the tasks in `tasks.md`, or no `tasks.md`, reads just `task 4`.
- **The task list:** a `▸ Tasks  1 of 3 merged` row (the count green once every task merged) folds the map's tasks.
  It starts folded during a task, and opens by itself at a hand-off: while the task waits at the PR handoff (`READY`
  or `AWAITING-HUMAN`), and when a task turns `ready` between two task-state results. A press's choice is kept per
  task, and wins until the next task turns ready. The first result after a reload opens nothing. Opened, it shows the
  key line, `key: the dots are Spec, Plan, Build, Review, Blind test, PR · – skipped` (wrapped, `· – skipped` stays on
  one line), then a row per task:
  - its state mark, then `<n> <request>`, cut at the end and bold for the task on show;
  - on the right, the six stage dots from that task's state.md, as the Task card's stepper places them, with `–` for
    a LOW task's blind test, then the current stage (`Build`, `Blind`, or `done` once merged);
  - a second line with the state word, `· PR #55` when its state.md records a PR, its tier, and its footprint when
    it has a recorded file list: `merged · PR #55 · MEDIUM · 1 file · +12 · 1 important`. As on the Task card, an
    important finding awaiting re-review counts as `1 awaiting re-review`, here and in the task's file tree.

  Each state reads as one word and one mark:

  | State | Word | Mark |
  |---|---|---|
  | merged | `merged` | `✓` green |
  | ready | `ready` | `○` dim |
  | blocked | `after task 1, 2` (the blockers not merged yet) | `○` dim |
  | `DRAFT-AWAITING-VISUAL-SIGNOFF`, `READY`, `AWAITING-HUMAN` | `your move` | `◆` amber |
  | `PLANNING`, `BUILDING`, `IN_REVIEW`, `CONVERGED`, `BLIND-TEST` | the status in words (`in review`) | `●` while an agent of the task on show runs, else `○` dim |
  | `HALTED`, `ESCALATED` | `halted`, `escalated` | `✗` red |
  | unknown, or no state yet | none | none |

  A merged or finished task with a recorded file list is a button: a press opens its [file tree](#the-file-tree),
  read-only. The task on show is one only in a map session, since otherwise its own Now card holds its tree.
  Every row's label says it in words, such as `Task 2, Import the rows back, merged, done, MEDIUM, folded`.

### Where task states come from

Whether a map's task is ready, blocked, under way, or merged comes from `bin/quorum-map --map <slug> tasks`, which
the dashboard runs in the background and never waits on; it asks git, or GitHub through `gh` when a task records a
PR, whether a task merged. It runs again at most every two minutes, and at once when the status of the task on show
changes. A run that fails or takes more than 15 seconds keeps the last states, and the next try waits two minutes.

### The map session

While this session works a map (`/quorum:map` records it in `.tasks/.map-sessions/<session id>`), the map takes the
band and the pane, even with a task on show. They go back to the task, or the empty pane, once the session leaves the
map. Another session's map, including one a crashed session left behind, doesn't show here. A `quorum-map` call
refreshes the dashboard at once, so a claimed or resolved ticket shows before the turn ends.

- **The band:** a ` MAP ` badge, the map's slug, the four phase dots with the current phase by name and count, as
  the stepper reads it (`Tickets 2/4 in scope`), and **Dashboard**. The badge is amber whenever the map waits on you
  (a claimed grilling or prototype ticket, or a task breakdown waiting for your approval), and in Claude's colour
  otherwise.
- **The Map card:** its title row and stepper, then the Destination and the tickets' summary, cut to the card.
- **The Now card** says what the session is doing, its border amber when it waits on you:
  - **Chart:** `charting the map`.
  - **Tickets, with a ticket claimed:** `ticket 02 · research`, its title, its question, and a row per running agent
    (`● Researcher  running 42s`). A claimed grilling ticket waits on you, since only you answer it:
    `◆ waiting for you · answer ticket 04` (`◆ waiting for you · pick a variant for ticket 04` for a prototype).
  - **Tickets, with none claimed:** `between tickets` and how many are ready (`2 ready`).
  - **Hand off:** `hand off · writing the task breakdown`, then `hand off · reviewing the task breakdown` with the
    review round's reviewer and voter rows, as the plan review shows them.
  - **Tasks:** before any task starts, `◆ waiting for you · approve the task breakdown`, with `clean` or the
    breakdown review's kept findings (`kept ✗2`); once one has, `task 1 · building`. Both list the ready tasks,
    `ready: task 3 <request>`.
- **Tickets,** open, with a summary such as `5 tickets · 2 resolved · 1 out of scope` (a zero count other than
  `resolved` is left out, so `0 ready` doesn't show). Each ticket sits two columns under the first ticket it waits
  on, at most three levels deep, so a long chain still fits. A row reads `▸`/`▾`, its mark, `NN <title>`, then on
  the right its status:
  - `by you` (green `✓`) or `by agent` (muted `✓`) for a resolved ticket, by who decided it;
  - `your answer` (`◆`, amber) for a claimed grilling or prototype ticket. Another claimed ticket reads
    `in progress` (`●`) while an agent runs in this session, and `claimed` (`○`, dim) otherwise, so a stale claim
    never looks busy;
  - `ready` for an open ticket whose blockers are all closed, in the text colour so it stands out, and `after 04`
    (dim) naming the blockers still open;
  - `out of scope`.

  An open ticket shows its type before its status (`grilling · ready`); in a tight row the type goes first, then the
  title is cut at the end, and the row's label still names the type. A press on a row (`▸`/`▾`) opens or folds its
  detail line, wrapped to the row's indent: a resolved ticket's gist with `· decided by you` or
  `· decided by the agent`, which wraps whole onto the next line rather than split, an out-of-scope ticket's reason,
  or an open ticket's question. Resolved and out-of-scope tickets start open and open ones folded, and the choice is
  kept.
- **Tasks,** once `tasks.md` exists: the [task list](#the-map-card), open. No row gets an agent's `●` here, since the
  running agents are the map's.
- **Decisions,** folded: `▸ Decisions  2 so far` (or `none yet`). Opened, each of map.md's Decisions so far, ending
  `· you` or `· agent`, which wraps whole.
- **Below them,** a running `/quorum:review`, past reviews, and Other tasks, with the task on show listed first,
  whatever its status.

Docked, the order is the Map card, the Now card, Tickets, Tasks, then Decisions. Above the prompt, the Now card comes
first, then the Map card, and the finished work folds so the open work stays in view: `▸ ✓ 3 finished tickets` at the
top of Tickets holds the resolved and out-of-scope tickets, and `▸ ✓ 1 merged task` under the task list's key line
holds the merged tasks. A press opens either.

## The file tree

While a task runs, the Now card shows the change as one tree of files: what the plan said each step would touch,
what the build has changed so far, which changes no step planned, and where the review's findings land. The plan,
build, review-loop, and blind-test steps record the list into `.tasks/<slug>/files.tsv` with `quorum-files record`
at their save points (see [Repository layout](reference.md) in the reference). The stages record the file list, so
the tree needs no git of its own. The tree changes only when a stage records, with one exception: in Build and review,
the file being edited is marked as it happens (see [the file being edited](#the-file-being-edited)).

- **Plan:** directly under the Now card's title, a **Plan steps** list, one row per step of `plan.md`,
  such as `○ 2 Export endpoint  ✗1  2 files · req 1, 2`: the step's mark, its number and title, the plan review's
  findings on the step's lines, how many files the step names, and the requirements it serves. `K files` counts
  every file the step names, changed or not, and is left out until the plan records its list; `req …` is left out
  for a step that names no requirements. A plan finding is counted on the step whose lines hold it, and is still
  listed under `.tasks/<slug>/plan.md` in the tree. Before the first plan-review round, its rows can't be pressed,
  since no tree is drawn yet. Below the list come the plan review's reviewer and voter rows, then the tree: a header
  such as `4 steps · 9 files, 3 new`, then the files the plan's steps name, with the plan review's findings under
  `.tasks/<slug>/plan.md`.
- **Build:** the same Plan steps list above the tree, without finding marks: `✓` a built step, `●` the step being
  built (the one `quorum-plan next` gives, while a builder runs), and `○` one not built yet. Then a header such as
  `5 of 9 planned files changed · 1 unplanned`, then the change so far. No findings.
- **Review:** the same tree, with the findings of the round on show under their files. Before any round has voted,
  it keeps the Build header. HALTED, and ESCALATED during review, show this tree too, unfolded. The plan's steps fold
  to one row above the tree, `▸ Plan steps  3 of 3 built`, the count in the success colour once every step is
  built. A press opens the list, with its marks only, and the dashboard remembers the choice for each task. Before
  the first review round, the row sits under the Now card's title, and its steps can't be pressed.
- **Blind test, and after the review loop converges:** one folded row,
  `▸ Files  7 files · +268 −11 · 1 nit · 1 pre`, with the footprint line's summary. A press opens the Review
  tree, and the dashboard remembers the choice. It shows once the build has started; before that, the Review tree
  stays. The `▸ Plan steps` row sits above it, and pressing a step opens the Files row so its files show
  highlighted.
- **A press on a step** marks the step's own row with a `▎` before its bold title, in place, and highlights the
  files it names: each gets a `▎` before its bold name, and its label, which a screen reader reads, adds
  `in step N`. The folders above them stay open. The hint under the list's title changes from
  `press a step to highlight its files` to `step N's files are highlighted`. Steps can be pressed only where a tree
  of recorded files is drawn under them. Pressing the same step again clears
  it, pressing another switches to it, and a step that names no files selects nothing. The choice isn't kept across
  sessions. A fast-path task, or a plan with no numbered steps, has no Plan steps list.
- **Spec,** and a task with no list recorded yet, have no file tree; a Review with no list shows only the findings'
  files, as a `/quorum:review` does.

A file row reads, left to right: progress, the git letter, the name, line counts, the step, and the finding marks,
such as `✓ M report.py  +86 −3  s3  ✗1`.

- **Progress** against the plan: `✓` its step is built and the file has changed, `○` its step isn't built yet or
  the file isn't changed yet (its label reads `step 2 built, not changed yet`), `●` the file being edited (below),
  and `*` changed though no step names it, with the word `unplanned` beside the name. A file several steps name is
  `✓` only when all of them are built and the file has changed; in a build that isn't sliced into steps, every step
  counts as built once the build's proof exists. A task with no plan has no progress column, except for the `●`. A
  second key line names the ones shown: `✓ built  ○ not yet  ● editing  * unplanned`.
- **The letter:** `M` modified, `A` added, `D` deleted, `R` renamed. It's dim while the file is only planned.
- **Line counts:** `+86 −3`, leaving out a side with no lines, `bin` for a binary file (or a new file you can't
  read), and nothing while the file is only planned. A folder shows its file count there instead (`4 files`); the change's line totals are on the
  footprint line.
- **The step:** `s3`, the lowest step that names the file, blank when none does.
- **Columns line up** across the whole tree, folded rows included, so nothing moves when a folder opens or closes.
  In a narrow pane the name gives way first, cut in the middle down to 4 columns, then the `editing` and
  `unplanned` words, the step, and the line counts; the progress, the letter, and the marks always stay.
- **Big changes fold:** past 15 files, a folder with no open or `↻` finding and no unplanned file starts folded,
  and the header adds `clean folders folded (15+ files)`. A press opens it. With 15 files or fewer, folders start
  open. A folder that holds the file being edited, or the selected step's files, stays open while it does, whatever
  its fold, and its label adds `held open while editing` or `held open for step N`.
- **`file_icons`:** set the plugin option to `nerd` for a file type icon beside each file and folder. It's off by
  default, needs a [Nerd Font](https://www.nerdfonts.com/) (v3) in the terminal, and shows only in the terminal,
  not in the VS Code panel.

### The file being edited

In Build and review, a file of the project that an agent changes with Write, Edit, or NotebookEdit shows
`● editing`: `●` in the progress column and the word `editing` beside its name and in its label.

- **The flash:** for 2.5 s after the edit, the row is highlighted like a selected step's file, with a `▎` and its
  name bold, in Claude's accent colour.
- **After that,** `●` and `editing` stay without the flash. They move to the next file edited, and clear when the
  agent that made the edit ends its turn (the main session's own turn for its edits), or the task leaves Build and
  review.
- **In Build,** a file whose steps are all built, none of them the one being built, shows its own mark instead. In
  review, the edited file always shows `●`.
- **A file the list doesn't have yet** shows as a live row under its folders, `● editing unplanned` (no
  `unplanned` in a task with no plan), with no letter, line counts, or step. The row goes when its edit clears, as
  above; if a record lists the file first, the recorded row replaces it. It's never written to `files.tsv`.
- **Edits made through Bash** (`sed`, codemods, scripts) don't show, since Claude Code doesn't report which files
  they touch. Neither do edits under `.tasks/` or outside the project.

### Findings in the tree

The findings the verifier kept sit under their files, read from the project root, so a path written with `./`, as
an absolute path, or in the task's worktree lands on the same file. A chain of folders with one child each is
merged into one row (`app/frontend/src/components/`), and a long name is cut in the middle. A finding with no file
sits under **other**, after the files. A `/quorum:review` records no file list, so its tree holds only the files
with findings.

- **The header** names the round on show: `the verifier kept these in round 2`, or `kept nothing in round 2`.
  While the next round reviews, the tree keeps the last round the verifier voted on. A `/quorum:review` says run
  where a task says round.
- **Marks:** `✗` important, `↻` awaiting re-review, `✓` fixed this run, `n` nit, `p` pre-existing. A key line
  under the header names only the marks shown, such as `key: ✗ important  n nit`, and wraps between entries in a
  narrow pane.
- **Security findings:** a finding with a `Security: <kind>` line in its body (see [`REVIEW.md`](../REVIEW.md),
  section 1) shows the word `security` in red before its title, and its label adds `security: injection`. A `✗` or
  `↻` count that holds one is followed by `!` (`✗2!`, `↻1!`), the row's label adds `1 of them security`, and the
  key adds `! security`. While a `!` shows, the `✗` and `↻` columns are one column wider in every row, so they
  still line up. A security finding a later round fixed, or the voter dropped, keeps its `security` word, muted,
  and gets no `!`. Plan-review findings show the same way.
- **Awaiting re-review:** once a round's fix changes the file of an important finding that round kept, the finding
  shows `↻` instead of `✗` until a later round reviews it. The voter row then reads `kept ↻1 n1 → re-review` in
  place of `→ fix round`, and each reviewer row whose finding is now `↻` reads `↻1 found ✗1`. While the next round
  reviews and hasn't voted, the voter row keeps that verdict, labelled with its round
  (`round 1: kept ↻1 n1 → re-review`), and the reviewer rows are the new round's. A finding a new round keeps on
  a file an earlier fix changed reads `✗` again, with `→ fix round`.
- **Folders** roll their findings up by mark beside their file count: `src/  2 files  ✗1  n1`.
- **A press** on a folder or file folds or opens it, and the dashboard remembers the choice through later rounds.
  A press on a folder held open for an edit or a step is remembered too, and applies once the hold ends.
  Folders start open, and so does a file with findings still to fix. A finding is one line, cut at the end; a press
  on it shows its full title, the verifier's confidence, and a **copy path** button that copies `path:line`.
- **Fixed findings:** an important finding an earlier round kept that a later round no longer keeps shows as `✓`
  under its file, reading `round 1 → fixed by round 2`; a nit or pre-existing finding a later round no longer keeps
  just leaves the tree. A file with only fixed findings starts folded, unless the task is HIGH. A finding counts as
  the same one when its file and category match, whatever its severity, so a finding whose line moved, or whose
  severity changed, isn't shown as fixed; one that comes back in a later round is open again. When the round on
  show keeps nothing, a task's tree still shows its files, with only `✓` rows for findings; a `/quorum:review`
  tree shows only the `✓` rows. For a `/quorum:review`, a finding is fixed only when a later run reviewed a
  different range end.
- **Dropped on dispute:** a finding the voter dropped after the builder disputed it shows dim, with no mark and no
  count, as `dropped on dispute in round 1`, as soon as the voter drops it. The voter row then reads, for example,
  `kept ✗1 n1 · 1 dropped on dispute → fix round`, so its counts and the tree's still add up.

The tree shows only the task's changed files and the files its findings name. For a whole-repo tree that animates
as Claude reads and writes, try [claude-code-filetree](https://github.com/data-goblin/claude-code-filetree), a
separate mod that runs beside this one.
