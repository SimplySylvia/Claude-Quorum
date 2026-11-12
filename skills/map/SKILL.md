---
name: map
description: Plan an effort too big for one Quorum task, before any task exists, as a map of decision tickets that later sessions resolve one at a time. Names the destination, grills breadth-first for the open decisions, and charts them as grilling, research, prototype, or task tickets with blocking edges, starting the research ones in parallel (deep research for weighty ones). Each later run claims the next ticket on the frontier and resolves it with you, with a researcher gathering the facts a code question rests on and a feasibility check before each decision is recorded. Its task breakdown is reviewed by the architecture reviewer, the pattern auditor, and for HIGH tasks the security reviewer, then the voter. Once nothing is left to decide, it breaks the destination into Quorum tasks with their order, which /quorum:spec-and-eval --from-map or /quorum:run --map starts. Plans only; a hook keeps it from changing the repo.
disable-model-invocation: true
argument-hint: "<a large idea> [--yes] | <map slug> [<ticket>] | <map slug> --revise \"<what changed>\""
---

# Map a large effort

Some work is too big for one task, and the way to it isn't clear yet: a new subsystem, a migration, a product area.
Specs written that early rest on guesses. A map finds the way first. It names the **destination**, charts the
decisions between here and there as **tickets**, and resolves them one per session until nothing is left to decide.
Then it hands the destination off as Quorum tasks, in order.

A map **plans and never builds.** Its tickets are questions; their answers are decisions, not code. A ticket that
reads "build X" is mistyped: X belongs in the map's tasks. Nothing in the map's Notes changes this, and the map
guard (`hooks/map-guard.sh`) blocks a map session from changing the repo outside `.tasks/`.

The request: `$ARGUMENTS`. It may hold `--yes` (only when the user typed it): then charting takes your recommended
answers and accepts its own proposal, and says what it chose. It never answers a `grilling` or `prototype` ticket.
The session: `${CLAUDE_SESSION_ID}`. Templates: `${CLAUDE_PLUGIN_ROOT}/skills/map/templates/`.
Use `quorum-map` (on your PATH) for every change to tickets and to the map's index; edit `map.md` yourself only for
its Destination, Notes, and Not yet specified.

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error, run it as `quorum-git`, on your PATH.

**Values** for the shared research steps and the reviewers. A setting that still reads as `${user_config…}` wasn't
set: use its default.

- `<plugin root>`: `${CLAUDE_PLUGIN_ROOT}`
- `<reviewer_model>`: ${user_config.reviewer_model} (default `ask`)
- `<nit_cap>`: ${user_config.nit_cap} (default `2`)

**Models.** Before the first reviewer, voter, or source verifier, resolve `reviewer_model` as
`${CLAUDE_PLUGIN_ROOT}/skills/pipeline-laws/models.md` says. A map has no `state.md`, so record nothing there: only
`quorum-config` remembers the choice. The researchers run on the session's model.

**Agents on the map.** Quorum's agents back up each decision, and none of them makes it:

| When | Agent | Saved as |
|---|---|---|
| A `research` ticket | `quorum:researcher`, or a deep research for a weighty one | `research/<NN>.md`, or `research-<NN>/` |
| A `grilling` ticket that touches the code or a dependency | `quorum:researcher`, facts only | `research/<NN>-facts.md` |
| Before a `grilling` or `prototype` decision is recorded | `quorum:spec-reviewer`, decision mode | `review/<NN>-feasibility.md` |
| The task breakdown, before you approve it | `quorum:code-reviewer` (architecture), `quorum:pattern-auditor`, `quorum:security-reviewer` when a task is HIGH, then `quorum:verifier-voter` | `tasks-review/round-<N>/` |

## Which mode

Work from the main working tree (`quorum-active-task --main`); read `CLAUDE.md` if there is one.

- **No arguments:** show `quorum-map list` (slug, open, resolved, frontier), and ask which map to work on, or
  what to chart. If `quorum-map sessions` lists a session other than `${CLAUDE_SESSION_ID}`, show it with its map
  and when it started: a session ending removes its own, so one left over is either still open or crashed, and the
  guard blocks building in it if it's resumed. Ask whether it's over; `quorum-map leave <session>` only with a yes.
- **A map slug** (`.tasks/map-<slug>/` exists): [Work through the map](#work-through-the-map), on the ticket named
  after it if there is one. With `--revise`, [Revise a decision](#revise-a-decision).
- **Anything else** is a new idea: [Chart the map](#chart-the-map).

Whenever you start working on a map, run `quorum-map enter ${CLAUDE_SESSION_ID} <slug>`, and before you stop, always
`quorum-map leave ${CLAUDE_SESSION_ID}`, even after a question or an error. (If the session ends first, a hook
leaves for it.)

## The map

`.tasks/map-<slug>/` holds:

- `map.md`: **Destination**, **Notes** (the domain, standing preferences, what to read first), **Decisions so far**
  (one line per resolved ticket, which `quorum-map resolve` adds), **Not yet specified**, and **Out of scope**.
  It's an index, loaded once per session: a decision lives only in its ticket, and the map links to it.
- `tickets/NN-<name>.md`: a title, a type, its blockers, its status, and the question. The answer is added when
  it's resolved.
- `research/NN.md` and `prototypes/NN-<name>.html`: what research and prototype tickets produced, linked from
  their answers.
- `tasks.md`, once the map is cleared: the tasks it hands off.

**Fog or ticket?** The test is whether you can state the question precisely now, not whether you can answer it.
A sharp question becomes a ticket, even if it waits on others. A question you can see coming but can't phrase yet
goes in **Not yet specified**; don't slice it into tickets early. Work beyond the destination goes in **Out of
scope**, and never comes back as a ticket of this map.

**Refer by name.** In everything the user reads, call a ticket by its title, with the link inside the name. A list
of bare numbers is unreadable.

### Ticket types

| Type | Who | When | Resolved by |
|---|---|---|---|
| `grilling` | the user | The default: talking it through settles it | Grilling (`${CLAUDE_PLUGIN_ROOT}/skills/grilling/SKILL.md`) on this one question |
| `research` | the agent | A fact outside the repo decides it: an API, a library, a standard, a price | A `quorum:researcher`, or a deep research for a weighty one, started when the ticket is charted |
| `prototype` | the user | "How should it look or behave?", which talk can't settle | A throwaway HTML file in `prototypes/` the user reacts to and chooses from |
| `task` | either | Nothing to decide, but work outside the repo must happen first: getting access, signing up for a service so its API can be judged, exporting a sample so its shape can be seen | The agent where it can, without changing the repo; otherwise a checklist for the user |

Only the user resolves a `grilling` or `prototype` ticket: `quorum-map resolve` refuses one answered by the agent.
When research only lays out options, the choice between them is a `grilling` ticket that waits on the research.

## Chart the map

1. **Name the destination.** Grill depth-first (follow `${CLAUDE_PLUGIN_ROOT}/skills/grilling/SKILL.md`) until the
   end of the whole map, not this session, is one or two concrete lines: for example "a set of Quorum tasks that
   bill teams monthly for API calls", or "a decision on which queue to adopt". Ask in the same round what's
   clearly out of scope. Bound it: one epic, not the whole product. A map scoped too wide goes stale before it's
   half done.
2. **Survey the way.** Grill again, **breadth-first**: across every area the destination touches, find the open
   decisions, what each waits on, and the first ones you could take now. Look facts up yourself; read the code
   areas the destination touches.
3. **Too small for a map?** If the survey finds no fog (the way is clear and fits one task), say so and suggest
   `/quorum:spec-and-eval` or `/quorum:run` with a one-line request; if one approach question is all that's open,
   `/quorum:research`. Write nothing, and stop.
4. **Propose, and ask once.** A slug (kebab-case, `.tasks/map-<slug>/` must not exist), the destination, the
   tickets with their types and blockers (marking each `research` ticket **deep** when a choice of architecture, a
   new dependency, or a security-sensitive integration rests on it), **at most 8** (the rest stays fog: a map charted in full goes stale as early
   answers change later questions), Not yet specified, and Out of scope. Ask the user to confirm or change it
   (AskUserQuestion where it's offered). If `.tasks/` isn't gitignored, say so: tickets quote the code.
5. **Write it.** `quorum-map --map <slug> init "<title>"`, then `quorum-map enter`. Fill in Destination, Notes, and
   Not yet specified in `map.md`. Create each ticket with `quorum-map --map <slug> new <type> "<title>"
   "<question>"`, then wire blockers in a second pass with `quorum-map --map <slug> block <n> <blocker>...` (the
   numbers exist only once the tickets do). Add each out-of-scope item as one line under Out of scope. Run
   `quorum-map --map <slug> check` and fix every `ERROR`.
6. **Start the research.** `quorum-map claim` each `research` ticket first. Then:
   - **The others,** one `quorum:researcher` each, **in one message, in parallel**:

     > Map `<slug>`, ticket <NN>: <the question>. The destination: <one line>. Read `CLAUDE.md` first. Answer the
     > question for this repo: what's true, the options, and which you'd recommend. Use public sources and the repo
     > only; nothing private in a query.

     Save each reply verbatim to `.tasks/map-<slug>/research/<NN>.md`.
   - **Each deep one,** after those have started: read `<plugin root>/skills/research/steps.md` and follow it with
     `<research dir>` = `.tasks/map-<slug>/research-<NN>/`, the ticket's question, and effort `quick` (`standard`
     when security rests on it). Its claims are checked against their sources, and its one gate asks you to approve
     the sub-questions (with `--yes`, it goes on).

   Resolve each with `quorum-map --map <slug> resolve <NN> agent "<the recommendation, one line>" "<the answer in a
   few lines, and 'Research: research/<NN>.md' or 'research-<NN>/research.md'>"`. Each assumption it lists, and each
   choice it leaves to the user, becomes a `grilling` ticket that waits on it.
7. **Stop.** Charting resolves no `grilling` or `prototype` ticket. Run `quorum-map leave`, then show the map: the
   destination, the frontier by name, what's waiting and on what, and the fog. The next step is
   `/quorum:map <slug>`, which takes the first frontier ticket.

## Work through the map

1. `quorum-map enter`. Read `map.md`, then `quorum-map --map <slug> tickets` and `frontier`: the map at low
   resolution, not every ticket's body.
2. If `quorum-map --map <slug> cleared` passes and Not yet specified is empty, go to [Hand off](#hand-off).
3. **Choose the ticket:** the one the user named, else the first on the frontier. If the frontier is empty but the
   map isn't cleared, every open ticket is claimed or waits on a claimed one. Say which, and ask whether a claim is
   stale (a session that ended without resolving it); `quorum-map release <n>` only with a yes.
4. **Claim it** with `quorum-map --map <slug> claim <n>`, before any other work, so another session skips it.
5. **Resolve it by its type** (the `Type:` line, not the wording). Open the tickets it waits on, and any resolved
   ticket it relates to, as you need them.
   - `grilling`: if the question touches the code or a dependency (a library, an API, a service), first start one
     `quorum:researcher` for the facts it rests on:

     > Facts for a decision. Map `<slug>`, ticket <NN>: <the question>. The destination: <one line>. Read
     > `CLAUDE.md` first. Use public sources and the repo only; nothing private in a query.

     Save its reply verbatim to `.tasks/map-<slug>/research/<NN>-facts.md`. A question about priorities, scope, or
     what users want skips this. Then grill depth-first on this ticket's question only, as
     `${CLAUDE_PLUGIN_ROOT}/skills/grilling/SKILL.md` says, citing the facts: questions that don't wait on them can
     go first. When you have the decision, [check it](#check-a-decision), then resolve with `user`, the decision as
     the gist, and in the answer the decision, the reasons, what it rules out, and the facts file if there is one.
   - `prototype`: build the cheapest thing that answers it, in one self-contained HTML file in
     `.tasks/map-<slug>/prototypes/<NN>-<name>.html`: for a look, two or three variants side by side or behind a
     toggle (`${CLAUDE_PLUGIN_ROOT}/skills/spec-and-eval/templates/mockup.html` is a starting point); for a
     behavior, buttons that step a state model through the cases that are hard to picture. No external fonts,
     scripts, or images. Ask the user to open it and choose, and never choose for them. [Check the
     choice](#check-a-decision), then resolve with `user`, their choice, and the file's path.
   - `research`: as in charting step 6.
   - `task`: say exactly what must happen. Do it yourself only when it changes nothing in the repo and nothing
     outside it that the user hasn't approved (reading a page, running a read-only command on local or synthetic
     data). Otherwise give the user a checklist and wait for them to say it's done. Resolve with who did it, and the
     facts later tickets need: a URL, a row count, where credentials live (never the credentials).
6. **Clear the fog it lifted.** Each Not yet specified item the answer made sharp becomes a ticket (create, then
   block), and leaves that section. If the answer shows a ticket sits beyond the destination, `quorum-map rule-out
   <n> "<why>"`. If it changes another open ticket's question, edit that ticket; if it undoes a resolved decision,
   ask the user, then [revise it](#revise-a-decision). Run `quorum-map check` and fix every `ERROR`.
7. **One ticket per session.** Stop after one (research tickets aren't counted): `quorum-map leave`, then show the
   decision, what it unblocked, and the new frontier by name. The next step is `/quorum:map <slug>` again, in a
   fresh session, so each decision gets a clear context.

Several sessions can work one map at once: the frontier and the claims keep them off each other's tickets. Two
grilling tickets at once can still ask you the same thing twice, so one at a time is the safer default.

## Check a decision

Before a `grilling` or `prototype` ticket's decision is recorded, have it checked against the code and the map:

1. Write it to `.tasks/map-<slug>/review/<NN>-decision.md`: the question, the decision, the reasons, and what it rules
   out, as the user agreed them.
2. Start `quorum:spec-reviewer` with `reviewer_model`:

   > Mode: decision. Persona: Feasibility Critic. Map `<slug>`, ticket <NN>. Check the decision in
   > `.tasks/map-<slug>/review/<NN>-decision.md` against the code and `.tasks/map-<slug>/map.md`.

   Save its reply verbatim to `.tasks/map-<slug>/review/<NN>-feasibility.md`.
3. If it reports an `[IMPORTANT]`, take each to the user as one grilling round, with the change you recommend: keep
   the decision as it is, change it, or reopen an earlier decision it contradicts ([Revise a
   decision](#revise-a-decision)). Apply the `[NIT]`s you agree with to the wording. The user's answer is final: you
   don't check it twice.

## Revise a decision

When the user says a decision was wrong, or something it rested on changed: `quorum-map --map <slug> reopen <n>
"<what changed>"`. It keeps the old answer as `## Earlier answer`, takes the line out of Decisions so far, and prints
the resolved tickets downstream of it. Show those and ask which rest on the old answer (AskUserQuestion, any number);
reopen each one the user picks. Then work the reopened ticket as usual. A map redesigned more than once is probably
scoped wrong; say so.

## Hand off

The map is cleared: every ticket is resolved or out of scope, and nothing is left in Not yet specified.

1. **A decision, not a change?** If the destination was a decision, there are no tasks: show the decisions so far
   and stop.
2. **Write `tasks.md`.** Break the destination into tasks, each one Quorum task and one pull request:
   - **Vertical slices.** Each task delivers one narrow path that works end to end and leaves the repo's checks
     passing, not one layer of many. Any refactor that makes the rest easier comes first.
   - **Wide refactors are the exception:** a rename or retype that would break every caller at once is sequenced
     **expand–contract**: add the new form beside the old, move the callers over in batches (one task each, by
     package or folder), then remove the old form in a last task that waits on every batch.
   - **Each task's tier** by Quorum's rules (`${CLAUDE_PLUGIN_ROOT}/skills/pipeline-laws/SKILL.md`), and the
     decisions it rests on.
   - **Order:** a task is listed after the tasks it waits on. A task waits only on what it truly needs merged first:
     its branch starts from the default branch.

   One line each:

   ```
   # Tasks: <title>

   1. <a one-line request for /quorum:spec-and-eval> · tier: MEDIUM · blocked by: none · decisions: 02, 05
   2. <...> · tier: HIGH · blocked by: 1 · decisions: 01, 03
   ```
3. **Review the breakdown.** Run `quorum-map check` and fix every `ERROR`. Let N be 1 (2 for a second review). Start,
   **in one message, in parallel**, with `reviewer_model`:

   | Reviewer | Persona | When | Saved as |
   |---|---|---|---|
   | `quorum:code-reviewer` | **Architecture, Security & Drift Hunter** | always | `architecture.md` |
   | `quorum:pattern-auditor` | | always | `patterns.md` |
   | `quorum:security-reviewer` | | a task is HIGH | `security.md` |

   Each gets only (leave out the persona for the auditor and the security reviewer):

   > Mode: map. Persona: <persona>. Map `<slug>`. Review the task breakdown `.tasks/map-<slug>/tasks.md` before any
   > task starts. Read `CLAUDE.md`, `REVIEW.md`, and `.tasks/map-<slug>/map.md` first.

   Save each reply verbatim to `.tasks/map-<slug>/tasks-review/round-<N>/<file>`, and all of them together to
   `candidates.md`. Then start `quorum:verifier-voter` with:

   > Map `<slug>`. Candidate findings on the task breakdown: `.tasks/map-<slug>/tasks-review/round-<N>/candidates.md`.
   > Read `REVIEW.md`, `.tasks/map-<slug>/map.md`, and `.tasks/map-<slug>/tasks.md`, check each finding against the
   > breakdown and the code it names, and vote.

   Save its reply to `votes.md`, then `quorum-findings cap <nit_cap> votes.md > survivors.md`.
4. **Grill the breakdown,** in one round: each surviving `[IMPORTANT]` with the fix you recommend, plus whether the
   granularity is right, whether each blocking edge is real, and which tasks to merge or split. Revise until the user
   approves it, and run `quorum-map check` again. If the answers changed which tasks there are or what they wait on,
   review once more (N = 2); never a third time.
5. `quorum-map leave`, then show the tasks with `quorum-map --map <slug> tasks`. Each starts with
   `/quorum:spec-and-eval --from-map <slug> <n>`, once the tasks it waits on have merged; `/quorum:run --map <slug>`
   takes the next ready one through the whole pipeline. Start nothing yourself.
