<!-- The steps of /quorum:pr-draft, which /quorum:run follows too. Values in angle brackets that the caller
     gives (the plugin root, the arguments, and the plugin's settings) are listed in SKILL.md and run's SKILL.md. -->

# Draft the PR

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error (a sandbox hiding the real git), run it
as `quorum-git`, on your PATH, with the same arguments. Quorum's own helpers already do.

Use the slug in `<arguments>`, or `quorum-active-task`. If neither gives one, use the newest task under `.tasks/`
whose status is `READY` or `AWAITING-HUMAN`, and say which. Work from the repo root.

Don't run git commands that change the working tree, index, or history here, and don't push or create the PR.

1. **Check the status.** `quorum-state --task <slug> get status` must be `READY` or `AWAITING-HUMAN`. Otherwise
   say which command comes next (`pipeline-laws` has the stage map) and stop.
2. **Check the proof.** `.tasks/<slug>/proof-final.md` must exist with no failed check: `Result: ALL PASS`, or
   only skipped checks (`Result: <n> SKIPPED`), the same rule `quorum-state` applies to `READY`. If it's missing or
   anything failed, say so and stop: a PR shouldn't claim checks that didn't pass. With skipped checks, tell the
   writer which ones and why (from the proof), so the PR names them as not run rather than passing.
   If the branch already has a PR (`gh pr view --json url --jq .url` prints one), record it with
   `quorum-state --task <slug> set pr <url>` and say you're drafting a new description for it.
3. **Run the writer.** Resolve the task's helper model as in
   `<plugin root>/skills/pipeline-laws/models.md` (configured defaults: `reviewer_model` = <reviewer_model>, `helper_model` = <helper_model>) (`--models` in
   `<arguments>` asks again), then start `quorum:pr-writer` with `helper_model` and:

   > Task `<slug>`. Base commit `<quorum-state get base_sha>`. Draft the PR title and description, and list any
   > commits that must not ship. Read `CLAUDE.md`, `.tasks/<slug>/rd.md`, `state.md`, `proof-final.md`, and
   > `.tasks/<slug>/blind/` if it exists. <With skipped checks: "These checks were skipped, not passed: <ids and
   > reasons>. List them as not run.">

4. **Save and show.** Save its reply verbatim to `.tasks/<slug>/pr.md`, and the description alone (everything
   after the `---` line) to `.tasks/<slug>/pr-body.md`. Show the reply.
5. **Next steps for the user,** without running them:
   - If commits are listed under "Drop before merging", give the exact command to remove them (for example
     `git rebase --onto <sha> <sha>^`, or an interactive rebase they run themselves), and say to rerun the fast
     checks afterwards.
   - The push and create commands that fit the repo (for example `git push -u origin <branch>` and
     `gh pr create --title "<title>" --body-file .tasks/<slug>/pr-body.md`). When `gh pr create` runs in this
     session, Quorum records the new PR's URL as the task's `pr`. If they open it another way, give
     `quorum-state --task <slug> set pr <url>` to record it.
