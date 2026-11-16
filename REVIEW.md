# Code Review Constitution (`REVIEW.md`)

## 1. Core Review Philosophy
- **Evidence Requirement:** Every finding MUST cite an exact `file:line` reference and explain the concrete failure mechanism. Never guess based on variable or function names alone.
- **Confidence:** Every finding's second line is `Confidence: <0-100>`, how sure the reviewer is that it's real. The verifier checks the least confident findings hardest; the nit cap keeps the most confident nits.
- **Clean Summary Header:** Start every review output with an exact count of findings by tag (e.g., `Summary: 1 IMPORTANT, 2 NIT, 0 PRE-EXISTING`). If there is nothing substantive to fix, state plainly: `Summary: 0 issues found. Ready to land.`
- **Nitpick Cap:** Maximum of **2 `[NIT]` comments** per review pass. Drop all pure style/formatting preferences covered by linters.
- **`CLAUDE.md` Drift Check:** Flag `[IMPORTANT]` if this code change makes any documented command, path, or architectural statement in `./CLAUDE.md` inaccurate or outdated.

## 2. Severity Tags (Mandatory)
Every finding must be prefixed with exactly one of these tags:
- `[IMPORTANT]` — Bugs, race conditions, data loss risks, broken edge cases, security flaws, or spec violations. **Blocks completion.**
- `[NIT]` — Minor readability or non-blocking improvements (Capped at 2 max). **Does not block completion.**
- `[PRE-EXISTING]` — Bugs or tech debt discovered in touched files that existed *prior* to this diff. **Does not block current task**, logged for separate follow-up.

## 3. What Failure Looks Like in This Repository
<!-- Tailored by /quorum:init-pipeline to this repo: a Claude Code plugin of bash hooks and helpers, Markdown skills and agents, and a TypeScript dashboard module. Edit freely. -->
- **Hooks and `bin/` (bash):**
  - Breaking bash 3.2, the macOS system bash CI tests on: `declare -A`, `mapfile`, `${var,,}`, `|&`.
  - Unquoted paths.
  - Paths matched with forward slashes only. On Windows a hook gets backslash paths.
  - A hook that misreads its stdin JSON (a missing field, no `jq` guard) or exits non-zero by accident, which blocks the user's tool call or Stop.
  - Plain `git` where the sandbox needs `quorum-git`.
- **Skills and agents (Markdown):**
  - A stage's `steps.md` and its `SKILL.md` values drifting apart, or a new setting missing from `skills/run/SKILL.md`'s value list.
  - An agent's tool list allowing more than its role.
  - Instructions that contradict another stage's steps, or the files the dashboard and `bin/` scripts parse (a changed heading or line format).
- **Dashboard (`hooks/dashboard/`):**
  - A hook that awaits slow work on the turn path, or throws and is silently skipped.
  - An atom whose fields changed without its `shape` tag being bumped.
  - Reading outside `.tasks/` or git's own files.
  - A render that doesn't fit the tested pane width.
- **Docs and release:**
  - A changed skill, agent, or hook without a `version` bump in `.claude-plugin/plugin.json` and a `CHANGELOG.md` `Unreleased` note (`CONTRIBUTING.md`).
  - README, `guides/`, or the diagrams in `assets/src/diagrams.py` left describing old stages, agents, or commands.

## 4. Paths to Skip
Do not spend review tokens auditing:
- Generated files and build output (none detected yet; add paths here)
- Snapshot files unless a snapshot deletion removes critical test coverage

## 5. Convergence & Loop Rules
1. **Max 3 Rounds:** If an `[IMPORTANT]` issue survives 2 fix attempts, halt line-patching and escalate for an architectural rethink.
2. **Diff-Only on Round 2+:** In Round 2 and Round 3, inspect ONLY the lines changed since the previous round and their immediate callers. Do not re-scan untouched code to invent new findings.
3. **Class-Level Tagging:** Every `[IMPORTANT]` finding must include a `Pattern Category:` label (e.g., `Pattern Category: Missing Async Error Boundary`) so the Builder sweeps the entire diff for all instances of that pattern at once.

## 6. Learned Rules (Self-Updating Project Memory)
<!-- Append 1-line declarative rules below via /quorum:codify-lesson when repeated bugs or false positives occur in this repo -->
