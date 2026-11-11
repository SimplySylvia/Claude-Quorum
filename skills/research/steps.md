<!-- The steps of a deep research, which /quorum:research and /quorum:spec-and-eval --deep-research both follow.
     Values in angle brackets that the caller gives are listed in each caller's SKILL.md and in run's SKILL.md. -->

# Deep research

You are the lead. You don't research yourself: researchers do, each in its own context, and a source verifier checks
the claims a script can't. Your job is to split the question well, give each researcher exactly what its lens
needs, check what comes back, and write one report that a spec can stand on.

The caller gives you `<research dir>` (a task's `.tasks/<slug>/`, or a standalone `.tasks/research-<slug>/`), the
question, and `<effort>`: `quick`, `standard` (the default), or `deep`. Findings go in `<research dir>/research/`,
and the report in `<research dir>/research.md`. Use local and synthetic data only, and nothing private in a query.

## 1. Scope it, and get one yes

1. Read `CLAUDE.md`, `REVIEW.md`, `<research dir>/history.md` if it has anything, and enough of the code to know
   what the question touches. Find the versions the lockfile or manifest pins.
2. Ask a clarifying question only if its answer would change what gets researched, and ask it once.
3. Propose the sub-questions: as many as the effort allows (below), each with one lens:

   | Lens | Answers | Never gets |
   |---|---|---|
   | `repo` | What the code does today, from the repo alone | What's being built: it reports what's there, not support for a plan |
   | `docs` | What the official docs say, for the pinned versions, and what's deprecated | |
   | `alternatives` | Other ways to do it, and prior art | |
   | `counter` | Why the leading option is wrong here | The findings that support it |

   Use `counter` only once there's a leading option: in the gap round, or when the question already names one.
4. Show the sub-questions, the effort, and what it costs (researchers and rounds), and ask the user to approve or
   edit them (AskUserQuestion where it's offered). This is the one gate. With `--yes`, go on and say so.

## 2. Effort

| Effort | Researchers | Rounds | Tool calls each |
|---|---|---|---|
| `quick` | 2 | 1 | 8 |
| `standard` | 3 | up to 2 | 15 |
| `deep` | up to 6 | up to 2 | 25 |

Start the effort's number of researchers in the first round (`deep`: 4 to 6). If the question needs fewer, say so
at the gate, with why, and use `quick`; with `--yes`, use the effort's number as it is. A `standard` first round is
`repo`, `docs`, and `alternatives`, unless the question names a leading option, in which case `counter` can replace
`alternatives`.

## 3. Research in parallel

Start the round's researchers **in one message, in parallel**, as `quorum:researcher`, numbering their files on
from the last (`1-repo.md`, `2-docs.md`, ...). Each gets only:

> Lens: `<lens>`. Sub-question: <the sub-question; for `repo`, about the code only>. Budget: <calls> tool calls.
> Write to: `<research dir>/research/<n>-<lens>.md`. <For `docs`: "Pinned versions: <name version, ...>.">
> <For `counter`: "The leading option: <one line>.">

Each writes its file and replies with a few lines. Keep those replies short in your own notes: the files hold the
evidence.

## 4. Check the claims, cheapest first

1. `quorum-research-check <research dir>/research/*.md` gives every claim a result. `OK` claims stand. A `MOVED` one
   stands at the line it names. A `DROP` claim is out. An `ERROR` is a claim missing its source: it's out too.
2. If any claim is `VERIFY`, start `quorum:source-verifier` (with `reviewer_model`, resolved as in
   `<plugin root>/skills/pipeline-laws/models.md`; a standalone research has no `state.md`, so record nothing
   there, and only `quorum-config` remembers the choice) with:

   > Claims to check: <the `VERIFY` claims, `file#n`, one per line>. Pinned versions: <name version, ...>.

   Save its reply verbatim to `<research dir>/research/verify.md`. `SUPPORTED` claims stand. `UNSUPPORTED` ones
   are out. `WRONG VERSION` and `UNREACHABLE` ones stand only as unverified, and say so wherever they're used.
3. `ASK` claims (assumptions) go to the user, listed in the report under **Assumptions to confirm**. They never go
   into a spec as fact.

## 5. One gap round, at most

List what the claims that stand don't answer yet: a sub-question with nothing but dropped or unverified claims, a
leading option nobody has argued against, or a conflict between two sources. If the list is empty, or this effort
has one round, stop. Otherwise run steps 3 and 4 once more, for those gaps only (with `counter` for the leading
option, if it hasn't had one). Never a third round.

## 6. Write the report

Write `<research dir>/research.md` in the format the spec and the planner already read, from the claims that stand:

```
Question: <the question>

Repo precedent:
- <path:line> — <what it does and how it applies>

Options:
1. <name> — <how it works here>. Fits the repo: <yes/partly/no, why>. Risks: <...>. Cost: <small/medium/large>.

Recommendation: <option> — <why>. <What the counter-evidence said, and why it doesn't change this, or does.>

For the spec:
- <a requirement, non-goal, or edge case the spec should include because of this research>

Assumptions to confirm:
- <each ASSUMED claim, for the user> (or "none")

Remaining gaps:
- <what the research couldn't settle, and why: budget, no source found, sources conflict> (or "none")

Sources (checked <YYYY-MM-DD>):
- <URL> — <what it supports, the version, and its verdict: verified by quote, or by the source verifier, or
  unverified>
```

Every sentence in the report rests on a claim that stands; cite the findings file and claim (`2-docs.md#3`) where it
helps. Never drop a sub-question silently: if it got no answer, it's a remaining gap. Then show the user the
options, the recommendation, the assumptions to confirm, and the remaining gaps.
