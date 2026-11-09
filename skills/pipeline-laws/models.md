# Choosing the models for a task's agents

Models change often, so Quorum never names one. Each task records two choices in `state.md`, and the skills pass
them to the agents they start:

| Choice | `state.md` key | Agents |
|---|---|---|
| Reviewers | `reviewer_model` | `spec-reviewer`, `code-reviewer`, `pattern-auditor`, `docs-auditor`, `a11y-auditor`, `security-reviewer`, `verifier-voter` |
| Helpers | `helper_model` | `friction-triager`, `pr-writer` |

Every other agent (`researcher`, `planner`, `builder`, `prover`, `blind-user`) always runs on the session's model.

Each value is `inherit` (the session's model) or a value the Agent tool's `model` parameter accepts.
Run `quorum-state` with `--task <slug>` when the skill works on a task that isn't the active one.

## Resolve the choices

Do this once, before the skill starts its first agent from either group, for the choices the skill names.
`/quorum:spec-and-eval` resolves both, so a task asks once, at its start. For each choice:

1. **`$ARGUMENTS` contains `--models`:** ask (below), even if a choice is recorded.
2. **`quorum-state get <key>` prints a value:** use it.
3. **The configured default** (the skill gives it, from `reviewer_model` or `helper_model` in the plugin options) is
   set, not `ask`, and doesn't read as a `${user_config…}` placeholder: use it and record it with
   `quorum-state set <key> <value>`.
4. **Otherwise ask** (below). With `--yes` and nothing recorded or configured, use `inherit` without asking, record
   it, and say so.

## Ask

Ask both questions in one prompt (AskUserQuestion), and only the ones still unresolved. Build the options from the
values your Agent tool's `model` parameter accepts right now, not from a list in this file, plus **Session model**
(`inherit`). Describe each option in a few words: how capable, fast, and costly it is relative to the others.

- **Reviewers:** recommend **Session model**. Reviewers decide what gets fixed and what ships, so a weaker model
  here misses bugs.
- **Helpers:** recommend the fastest option. Their work is summarizing and sorting what other agents found.

Record each answer with `quorum-state set <key> <value>`, where the value is exactly what you'll pass as `model`, or
`inherit` for the session's model. If the user types a model the Agent tool doesn't accept, say so and ask again.

## Use them

- Starting an agent in a group: pass the group's value as the Agent tool's `model` parameter. For `inherit`, leave
  `model` out.
- If the Agent tool rejects a recorded value (a model was retired), ask that question again, record the new value,
  and start the agent again.
- Name the choices in one line when the skill starts its first agent, for example
  "Reviewers: Session model · helpers: <value> (run the command with `--models` to change them)".
