---
name: spec-and-eval
description: Start a Quorum task. Classifies the risk tier, researches the approach (MEDIUM/HIGH), writes the requirements (rd.md) and runnable checks (eval.md), has two spec reviewers check them against the code, creates the task's state.md, and for UI work writes a mockup for sign-off. With --from-map <map> <n>, starts a task a cleared /quorum:map handed off, from the map's decisions. With --redesign <slug>, restarts a HALTED task from a redesign option. Run before writing any code; /quorum:plan comes next.
disable-model-invocation: true
argument-hint: "<what to build> [--bug] [--research | --no-research | --deep-research [quick|standard|deep]] [--models] | --from-research <slug> [<candidate>] | --from-map <map> <n> | --redesign <slug>"
---

# Spec a task

Read `${CLAUDE_PLUGIN_ROOT}/skills/spec-and-eval/steps.md` and follow it. `/quorum:run` follows the same steps, so they live in
that one file.

The steps use these values. A setting that still reads as `${user_config…}` wasn't set: use its default.

- `<plugin root>`: `${CLAUDE_PLUGIN_ROOT}`
- `<arguments>`: `$ARGUMENTS`
- `<reviewer_model>`: ${user_config.reviewer_model} (default `ask`)
- `<helper_model>`: ${user_config.helper_model} (default `ask`)
