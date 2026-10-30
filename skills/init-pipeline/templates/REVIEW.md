# Code Review Constitution (`REVIEW.md`)

## 1. Core Review Philosophy
- **Evidence Requirement:** Every finding MUST cite an exact `file:line` reference and explain the concrete failure mechanism. Never guess based on variable or function names alone.
- **Clean Summary Header:** Start every review output with an exact count of findings by tag (e.g., `Summary: 1 IMPORTANT, 2 NIT, 0 PRE-EXISTING`). If there is nothing substantive to fix, state plainly: `Summary: 0 issues found. Ready to land.`
- **Nitpick Cap:** Maximum of **2 `[NIT]` comments** per review pass. Drop all pure style/formatting preferences covered by linters.
- **`CLAUDE.md` Drift Check:** Flag `[IMPORTANT]` if this code change makes any documented command, path, or architectural statement in `./CLAUDE.md` inaccurate or outdated.

## 2. Severity Tags (Mandatory)
Every finding must be prefixed with exactly one of these tags:
- `[IMPORTANT]` — Bugs, race conditions, data loss risks, broken edge cases, security flaws, or spec violations. **Blocks completion.**
- `[NIT]` — Minor readability or non-blocking improvements (Capped at 2 max). **Does not block completion.**
- `[PRE-EXISTING]` — Bugs or tech debt discovered in touched files that existed *prior* to this diff. **Does not block current task**, logged for separate follow-up.

## 3. What Failure Looks Like in This Repository
<!-- Tailored by /quorum:init-pipeline to this repo's stack ({{PROFILE}}). Edit freely. -->
{{FAILURE_MODES}}

## 4. Paths to Skip
Do not spend review tokens auditing:
{{SKIP_PATHS}}
- Snapshot files unless a snapshot deletion removes critical test coverage

## 5. Convergence & Loop Rules
1. **Max 3 Rounds:** If an `[IMPORTANT]` issue survives 2 fix attempts, halt line-patching and escalate for an architectural rethink.
2. **Diff-Only on Round 2+:** In Round 2 and Round 3, inspect ONLY the lines changed since the previous round and their immediate callers. Do not re-scan untouched code to invent new findings.
3. **Class-Level Tagging:** Every `[IMPORTANT]` finding must include a `Pattern Category:` label (e.g., `Pattern Category: Missing Async Error Boundary`) so the Builder sweeps the entire diff for all instances of that pattern at once.

## 6. Learned Rules (Self-Updating Project Memory)
<!-- Append 1-line declarative rules below via /quorum:codify-lesson when repeated bugs or false positives occur in this repo -->
