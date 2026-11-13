# Research and maps: before a task

[← Back to the README](../README.md)

## Researching before you build

`/quorum:research <question>` is for research that decides what the task is: whether something is worth doing, and
which way. For example, "is it worth caching the parsed data, and how?" It creates only the research, in
`.tasks/research-<slug>/`, and never a task.

1. **One gate.** It proposes 2 to 6 sub-questions, each with a lens, and you approve or edit them:
   - **repo precedent:** what the code does today. This researcher isn't told what's being built;
   - **official docs:** for the versions the lockfile pins, with a deprecation check;
   - **alternatives and prior art;**
   - **counter-evidence:** against the leading option, without seeing what supports it.
2. **Researchers in parallel.** Each writes its findings to its own file and returns a few lines, under a
   tool-call budget set by `--effort quick|standard|deep` (2, 3, or up to 6 researchers). For runtime questions, it
   first asks which connected tools (an observability server, logs, a profiler) to gather evidence from.
3. **Every claim carries its evidence.** Claims are tagged `VERIFIED` (with `path:line @ sha` and the line's text),
   `CITED` (with the quote, the URL, the date, and the version), or `ASSUMED`.
   - `quorum-research-check` re-finds every repo quote, and drops a claim whose quote is gone.
   - The `source-verifier` agent reopens only the pages a decision rests on, plus claims with numbers or no quote.
     It drops what the page doesn't say, and flags docs for the wrong version.
   - Assumptions come to you, never into a spec as fact. It offers to settle them in one round.
4. **One gap round at most**, and then the report: the usual options and recommendation, plus **Viability**,
   **Candidate tasks**, **Assumptions to confirm**, and **Remaining gaps**.
5. **Starting a task from it.** `/quorum:spec-and-eval --from-research <slug> <n>` starts a task from a candidate,
   with the research already done. When the candidates are many and depend on each other, it suggests a map.

Inside a task, `--deep-research [quick|standard|deep]` on `/quorum:spec-and-eval` or `/quorum:run` researches the
same way in place of the single researcher. It's opt-in. `state.md` records whether research changed a decision
(`research_decision`), to show whether it pays for itself. The secret guard also checks every web query and URL,
including the researchers'.

## Mapping a large effort

Some work is too big for one task, and the way to it isn't clear yet: a new subsystem, a migration, a product area.
A spec written that early rests on guesses. `/quorum:map` finds the way first, as a map of decisions in
`.tasks/map-<slug>/`. It's an idea taken from Matt Pocock's
[wayfinder](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md) skill, with
Quorum's research, checks, and task pipeline behind it.

```
/quorum:map Let regional managers run their own weekly reports, with trends and alerts   # chart it
/quorum:map regional-reporting            # resolve the next decision with you, one per session
/quorum:run --map regional-reporting      # once it's cleared: the next ready task, through every stage
```

1. **Chart it.** It grills you for the **destination**, one or two concrete lines, and what's out of scope. Then it
   grills breadth-first across everything the destination touches, and charts what it finds:
   - **Tickets**, at most 8 at first, each a question with a type: `grilling` (you talk it through), `research`
     (a `researcher` finds the facts, started at once and in parallel), `prototype` (a throwaway HTML file you react
     to), or `task` (work outside the repo that must happen first, like getting access). Each ticket lists the
     tickets it waits on.
   - **Not yet specified:** questions it can see coming but can't phrase yet. They become tickets as answers clear
     the way, so the map doesn't go stale charting what it can't see.
   - **Out of scope:** work beyond the destination, which never comes back as a ticket.

   If the survey finds nothing unclear, it says the effort fits one task and points you to `/quorum:spec-and-eval`.
2. **Work through it.** Each `/quorum:map <slug>` claims the first ticket on the **frontier** (open, and waiting on
   nothing still open), resolves it with you, adds one line to the map's **Decisions so far**, turns the questions
   the answer made sharp into new tickets, and stops. One ticket per session keeps each decision in a clear
   context. `--revise` reopens a decision that turned out wrong and lists the decisions that rested on it.
3. **Hand it off.** Once nothing is left to decide, it breaks the destination into Quorum tasks in `tasks.md`:
   vertical slices, each one pull request, with its tier, the tasks it waits on, and the decisions it rests on.
   You approve the breakdown after it's reviewed (below).
4. **Build it.** `/quorum:run --map <slug>` starts the next task whose blockers have merged and takes it through
   every stage; `/quorum:spec-and-eval --from-map <slug> <n>` starts one by number. The spec saves the map's
   decisions to `decisions.md`, writes them into the requirements and non-goals, and doesn't ask again what the map
   decided. The spec reviewers and the planner read them too.

**Quorum's agents back up each decision, and none of them makes it:**

- **Research tickets** get a `researcher` each, or for a weighty one (a new dependency, an architecture choice,
  something security rests on) a deep research, whose claims are checked against their sources.
- **A grilling question about the code or a dependency** gets a `researcher` first, in a facts-only mode: what the
  code does today, what the docs say for the pinned version, and the constraints, with no recommendation. You decide
  from facts instead of guesses.
- **Before a decision is recorded,** the `spec-reviewer`'s Feasibility Critic checks it against the code and the
  map's earlier decisions. A problem comes back to you in one round, and your answer stands.
- **The task breakdown** is reviewed in map mode before you approve it: the architecture reviewer checks that each
  task is a real vertical slice and its blocking edges are true, the pattern auditor that no task rebuilds what the
  repo has, and for a HIGH task the security reviewer that nothing is exposed before the task that guards it
  merges. The voter drops false alarms, and what it keeps comes to you with a recommended fix.

**A map plans and never builds.** Its tickets are questions, not build steps, and a hook blocks a map session from
editing the repo outside `.tasks/`, writing into it from Bash, committing, or starting a branch. The map's Notes
can't lift that, because the agent writes the Notes. Only you answer a `grilling` or `prototype` ticket:
`quorum-map resolve` refuses one answered by the agent. A task waits until the tasks it depends on have **merged**,
because its branch starts from the default branch; `quorum-map --map <slug> tasks` shows which have started, which
merged, and which are ready. `bin/quorum-map` keeps the map's index, the frontier, claims, and blocking edges
without a model, and `quorum-map check` catches a broken map: a cycle, a ticket with no question, or a decision
missing from the index.

## From a problem to merged code

For an effort too big for one task, a map comes first. It settles the decisions, then hands them off as tasks, and
each task goes through every stage above:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/map-flow-dark.svg">
    <img src="../assets/map-flow-light.svg" alt="From a problem to merged code. 1, chart it with /quorum:map and the problem: the destination, grilled until it's one or two concrete lines, plus what's out of scope; a breadth-first survey of every open decision; then at most 8 tickets, with research tickets started at once, in parallel. If it fits one task, charting stops and points to /quorum:spec-and-eval. 2, decide, with /quorum:map and the map's slug, one ticket per session: claim the first ticket waiting on nothing still open; you decide, after a researcher gathers the facts a code question rests on; the Feasibility Critic checks the decision against the code and earlier decisions; then the next ticket, in the next session. 3, hand off, once nothing is left to decide: tasks.md, vertical slices with a tier, what each waits on, and the decisions behind it; a review by the architecture reviewer, the pattern auditor, the security reviewer for HIGH tasks, and the voter; then you approve it. 4, build each task with /quorum:run --map: the spec comes from decisions.md; the whole pipeline runs, plan, build, review loop, blind test, proof; it drafts the PR and you merge it; then the next task whose blockers have merged. 5, learn with /quorum:retro. A map session plans only: a hook blocks it from changing the code." width="880">
  </picture>
</p>
