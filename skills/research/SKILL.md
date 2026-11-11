---
name: research
description: Research a question before deciding whether there's a task, and which way. Plans lensed sub-questions for your approval, runs researchers in parallel (repo precedent, official docs, alternatives, counter-evidence), checks every claim against its source, and writes a report with a viability verdict and candidate tasks. Creates no task, state, or code; /quorum:spec-and-eval --from-research starts a task from it.
disable-model-invocation: true
argument-hint: "<question> [--effort quick|standard|deep] [--yes]"
---

# Research a question

Research that decides what the task is: whether something is worth doing, and which way. For example, "break down
how the GraphQL layer performs and find what would make it faster: tuning, caching, or a refactor". It can end in
no task, one, or several, so this creates only the research.

The request: `$ARGUMENTS`. It may hold `--effort quick|standard|deep` (default `standard`) and `--yes` (only when
the user typed it).

**Git:** if a `git` command fails with an `xcode-select` or `xcrun` error, run it as `quorum-git`, on your PATH.

## 1. Set it up

1. Work from the main working tree (`quorum-active-task --main`). Read `CLAUDE.md` if there is one.
2. Propose a short kebab-case slug for the question. The folder is `.tasks/research-<slug>/`; it must not exist.
   Create it, and write the question, in your own words with nothing private, to its `question.md`. If `.tasks/`
   isn't gitignored here, say so: research can quote the code.
3. `quorum-lessons history research-<slug> > .tasks/research-<slug>/history.md`: what earlier tasks learned.

This folder has no `state.md`, so nothing treats it as a task: not `quorum-active-task`, `/quorum:run`, nor the
dashboard.

## 2. Evidence from the running app

When the question is about how the app behaves when it runs (performance, errors, load, cost), code and docs
aren't enough. Ask the user which connected tools to use, if any: an observability MCP server, logs, a profiler's
output, a dashboard export. Gather what they point you to yourself, and save a summary to
`.tasks/research-<slug>/evidence.md`: the numbers, where each came from, and the time range. Keep it to what the
question needs: no personal, customer, or patient data, no credentials, and nothing from it in a search query. Skip
this step when the question is about code or design only.

## 3. Research it

Read `${CLAUDE_PLUGIN_ROOT}/skills/research/steps.md` and follow it, with:

- `<research dir>`: `.tasks/research-<slug>/`
- `<effort>`: from `$ARGUMENTS`, else `standard`
- `<plugin root>`: `${CLAUDE_PLUGIN_ROOT}`
- `<reviewer_model>`: ${user_config.reviewer_model} (default `ask`)

Give every researcher `evidence.md` too, if you wrote one ("Read `.tasks/research-<slug>/evidence.md`: measurements
from the running app").

## 4. Viability and candidate tasks

Add two sections to `research.md`, after **Recommendation**:

```
Viability: <worth doing | not worth doing | worth doing only if ...> — <the evidence for that, from the claims>

Candidate tasks:
1. <a one-line request, ready for /quorum:spec-and-eval> — tier: <LOW|MEDIUM|HIGH, why> — follows option <n>
2. ...
(or "none", and why)
```

## 5. Report

Show the viability verdict, the candidate tasks, the assumptions to confirm, and the remaining gaps. For each
candidate, give the command that starts it: `/quorum:spec-and-eval --from-research <slug> <n>`. Start nothing
yourself: the user decides which, if any.

If the report lists **Assumptions to confirm**, offer to settle them now, as one grilling round
(`${CLAUDE_PLUGIN_ROOT}/skills/grilling/SKILL.md`): each assumption, with what you'd assume. Mark each answer in
`research.md` (confirmed, rejected, or left open, and by the user), and say if an answer changes the viability or a
candidate. A task started from it then reads the answers, not the guesses. With `--yes`, skip this.

If the candidates are many and depend on each other, or the viability rests on decisions only the user can make,
suggest `/quorum:map` instead: charting them as a map keeps those decisions apart from any one task.
