---
name: grilling
description: Quorum's grilling habit. Interview the user in rounds until every decision a plan, spec, or map rests on is settled. Each round asks every question that can be asked now, numbered, each with a recommended answer; facts get looked up, never asked. Use when the user asks to be grilled or to stress-test a plan or idea, and wherever a Quorum step says to grill. It only asks and records answers; it never starts a Quorum command.
---

# Grilling

A plan goes wrong where it rests on a decision nobody made: something the agent assumed, or a question asked so
loosely that the answer didn't settle it. Grilling finds those decisions and gets the user to make each one, in as
few rounds as the questions allow.

The step that sends you here says what's being decided, where answers go, and when to stop. Without one, you're
grilling a plan or idea the user brought; record the decisions in your reply.

## The design tree

Each decision opens others: choose "bill per seat" and "what counts as a seat" follows. Questions whose
prerequisites are settled are the **frontier**: you can ask them now without guessing at answers you haven't heard.

- **Depth first** (the default): follow the frontier until each branch reaches something concrete enough to build
  or check.
- **Breadth first** (when the step asks, for example charting a map): one level across every branch before going
  deeper, to see the whole shape and the questions that can't be asked yet.

A question that depends on another one still open belongs in a later round, not this one.

## A round

Ask the whole frontier at once, in one message. With AskUserQuestion, that's up to 4 questions per call; if the
frontier holds more, ask the 4 whose answers unblock the most, and the rest next round. Without it, number them in
one message. Each question:

- **A short title**, and one or two sentences: what's being decided and why it matters here. No more. Long
  questions tire people and hide why you're asking.
- **The choices**, when there are a few, each in a few words.
- **Your recommended answer**, first (with AskUserQuestion, label it "(Recommended)"), and one line on why. Word the
  question so "yes" accepts it.

Then wait. Each round's answers reshape the tree: work out the new frontier before the next round.

## Rules

- **Facts are yours to find.** Never ask what the code, the docs, `CLAUDE.md`, or a command could tell you. Look it
  up, or start an `Explore` agent for a wide search, and ask only about intent, priorities, scope, and trade-offs. A
  lookup still running blocks only the questions that wait on it.
- **Don't ask twice.** Before each round, check what's already decided: the request, earlier answers, the spec,
  `research.md`, a map's decisions (`decisions.md`), `REVIEW.md`. Cite a settled answer instead of asking again. If
  it now looks wrong, say why and ask whether to change it.
- **The user's answers are the user's.** Never answer your own question, and never take silence as a yes. If they
  say "you decide", record "the user left it to me: <your recommendation>".
- **Challenge a vague answer.** "Fast", "secure", or "the usual way" isn't a decision. Ask for the number, the case,
  or the example that would settle it, once.
- **Name the trade-off you heard.** If two answers pull against each other, say so and ask which wins.
- **With `--yes`** (only when the user typed it), don't ask: take each recommended answer, and list them as
  assumptions in your reply, except where the step says the user must answer.
- **Most specs need one round, sometimes two.** If you're on a fourth round, the scope is probably too big: say so,
  and suggest splitting it (for an effort bigger than one task, `/quorum:map`).

## Ending

Stop when the frontier is empty: every branch either decided, ruled out of scope, or left open on purpose as a known
gap. Then list the decisions in a few lines and ask whether anything's wrong. Don't act on them before the user
confirms, unless the step that sent you here says what comes next.
