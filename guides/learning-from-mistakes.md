# Learning from mistakes

[← Back to the README](../README.md)

A lesson is only learned once it changes what the next build or review does, and the surest change is one a machine
checks. Quorum suggests one when a Pattern Category comes back, the voter drops the same false alarm twice, or the
blind test finds what every reviewer missed, and writes it only after you say yes.

- **`/quorum:codify-lesson`** turns one lesson into the cheapest thing that stops it, in this order: a check the
  repo already has but `verify-completion.sh` never ran, a regression test, a lint rule, a pattern rule a hook
  blocks during tasks, a one-line rule in `REVIEW.md`, or a pointer in `CLAUDE.md` when an agent couldn't find
  something. `--audit` offers to retire rules no review has cited in months, and steering lines that do nothing.
- **`/quorum:retro`** looks back over a whole task, a map, a session, or a stretch of work (`--since <date>`), after
  Matt Pocock's [retro](https://github.com/mattpocock/skills/blob/main/skills/engineering/retro/SKILL.md). It reads
  Quorum's records (rounds, false alarms, blind-test blockers, halts, plan deviations, reopened decisions, research
  that changed nothing) and the session logs: `quorum-session` counts the tool calls, failed commands, hook blocks,
  files read again and again, and long searches, never the content. It ranks what it finds most severe first, from
  checks and review rules to broken commands, missing access, and Quorum settings worth changing; applies the ones
  you pick in `codify-lesson`'s order; and saves the retro to `.tasks/retro-<date>/`, so a declined idea isn't
  proposed again for nothing.

Each new plan reads what earlier tasks learned (`quorum-lessons history`): post-mortems, blind-test blockers,
findings that kept coming back, and the learned rules, and says how it avoids each.
