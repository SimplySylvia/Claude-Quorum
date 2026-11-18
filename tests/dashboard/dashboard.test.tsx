import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { ElementQuery, Engine, FoundElement } from 'claude-code/testing'

import {
  countFindings, countRequirements, evalRows, isReportedPass, isStaleProof, packedRef, joinChecks, nextStep, parseBlind, parseFrontmatter, parsePr,
  parseProof, parseSpec, prDetail, prFromUrl, prNext,
  requirementState, roleOf,
  roundReviewers, slugFromHead, spendOf, stageOf, stages, tokenCount,
  keptFindings, countPlanSteps, normalizePath, modelMismatches, choiceLabel, nextCommand, openByDefault, problemsOf, splitTicket, ago, isReviewId, latestRun, liveReview, shortRange,
  plural, voterNext, parseFileList, parsePlanSteps, editPath,
} from '../../hooks/dashboard/task'
import {
  awaitingFrom, awaitingOf, cellWidth, changeHeader, confidenceRow, cutChain, cutEnd, cutMiddle, disputeDrops, footprint, iconsOn, isBigTree, markText, markWords, repoPath, roundKept, isEditShown, runEnds, splitLoc, stepFindings, stepRows, trackFindings, treeHeader, treeRows,
} from '../../hooks/dashboard/tree'
import type { TreeChange, TreeRow } from '../../hooks/dashboard/tree'
import type { ChangedFile, FileList, FindingsView, TreeFinding } from '../../types'
import { DEMO_PLAN, DEMO_PLAN_SHOW } from './fixtures/demo-plan'

const state = (status: string, extra = '') => `---
slug: export-csv
risk: MEDIUM
status: ${status}
round: 2
base_sha: abc123
round_shas:
  - abc123
  - def456
stop_blocks: 0
signoff: null
plan_rounds: 2
plan_approved: 2026-11-08
pending_findings: ["app/report.py:42"]
blind_runs: 0
${extra}---
## Round 1
`

const SURVIVORS = `[IMPORTANT] app/report.py:42 — Pattern Category: Unescaped CSV fields
Mechanism: a comma splits a row.

[NIT] app/report.py:7 — naming
`
const CANDIDATES = `${SURVIVORS}[NIT] app/report.py:9 — spacing
[IMPORTANT] app/cli.py:3 — Pattern Category: Wrong env var
`

const RD = `# Export customers as CSV (CARE-42)

- **Slug:** \`export-csv\`
- **Risk tier:** MEDIUM. Users run it.
- **UI change:** no.

## Goal
<!-- One or two sentences. -->
Users can run \`export\` to get every customer as a **CSV** file.

Today there is no export.

## Requirements
1. \`export\` writes a CSV of every customer.
2. **Commas are quoted.** Fields with commas are wrapped in quotes.
3. **Docs:** add \`export\` to README.md.

## Non-goals
- No Excel output.
`

const EVAL = `# Eval: Export CSV

## Task checks
| # | Requirement | Command | Passes when |
|---|---|---|---|
| 1 | writes every customer | \`python -m app export\` | 3 rows |
| 2 | quotes commas | \`pytest -k comma\` | passes |
| 3 | README names export | \`rg -n export README.md\` | a match |

## Edge cases
- empty file
`

const PROOF = `Proof: export-csv at 1a2b3c4
Result: 1 FAIL

| # | Check | Result | Evidence |
|---|---|---|---|
| fast | bash .claude/hooks/verify-completion.sh | PASS | "All checks passed." |
| 1 | python -m app export | PASS | 3 rows |
| 2 | pytest -k comma | FAIL | 1 failed |
| 2b | fails without the fix (worktree) | PASS | 1 failed on old code |
| 3 | rg -n export README.md | PASS | README.md:40 |
`

const BLIND = `Goal: export customers
Result: NOT REACHED

Blockers:
- BLOCKER: ran export on data/empty.json — traceback — a header row

Friction:
- FRICTION: ran export --help — no example
- FRICTION: ran export — no progress shown
`

const TRIAGE = `Triage: export-csv, 2 friction items

CAUSED:
- "no progress shown" — app/cli.py:12: the new command prints nothing

RELATED:
- "no example" — help text predates this change
`

const BAND = {
  plugin: 'quorum',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { bodyColumns: 140, hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const PANE = {
  plugin: 'quorum',
  component: 'Pane',
  requestId: 'quorum-dashboard',
  props: { title: 'Quorum', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Lets the dashboard's background PR lookup finish.
const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

// Stands for the engine beneath the plugin: a project at /repo holding the files in `files`, each last changed at
// `mtimes[path]` (1 when not given). Folders are the ones those paths imply.
// `links`: absolute folders that list as symbolic links, as a task's folder in the main tree does once it has a worktree.
// `o.cwd`: the session's cwd, read on each call (`root` when not given); `o.clock: false` leaves `clock.now` and
// `clock.every` to the test, so `mock.clock(on)` can drive time (the engine takes one unmatched hook per event).
function world(on: On, files: Record<string, string>, root = '/repo', mtimes: Record<string, number> = {}, links: string[] = [], o: { cwd?: string; clock?: false } = {}) {
  const seen = { status: [] as (string | undefined)[], toasts: [] as string[], opened: 0, ticks: 0, live: [] as string[], copied: [] as string[], filled: [] as string[], draft: '', reads: [] as string[], writes: [] as string[] }
  // Paths are relative to `root`, or absolute (a worktree's session reads the main working tree's .tasks/).
  const abs = (path: string) => (path.startsWith('/') ? path : `${root}/${path}`)
  const file = (path: string) => Object.entries(files).find(([k]) => abs(k) === path)?.[1]
  const mtime = (path: string) => Object.entries(mtimes).find(([k]) => abs(k) === path)?.[1] ?? 1
  // The entries directly under `dir`, from the paths beneath it.
  const entries = (dir: string) => {
    const prefix = `${dir}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of Object.keys(files).map(abs)) {
      if (!path.startsWith(prefix)) continue
      const [name, ...rest] = path.slice(prefix.length).split('/')
      if (name) names.set(name, rest.length > 0 ? 'dir' : 'file')
    }
    return [...names].map(([name, kind]) => (links.includes(`${prefix}${name}`)
      ? { name, kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true }
      : { name, kind, size: 0, mtimeMs: kind === 'file' ? mtime(`${prefix}${name}`) : 0, isLink: false }))
  }
  // `seen.reads`: every path the dashboard read, listed, statted, or checked for.
  on('fs.list', (_, e) => {
    seen.reads.push(e.path)
    const found = entries(e.path)
    if (found.length === 0) throw new Error(`ENOENT: ${e.path}`)
    return { value: found }
  })
  on('fs.stat', (_, e) => {
    seen.reads.push(e.path)
    if (file(e.path) === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file' as const, size: 0, mtimeMs: mtime(e.path), isLink: false } }
  })
  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: o.cwd ?? root }))
  on('session.id', () => ({ value: 'sess-a' }))
  on('agent.list', () => ({ value: seen.live.map(id => ({ id, description: '', type: 'quorum:code-reviewer', status: 'running' as const })) }))
  // Each period of $.clock.every is one dispatch; refusing the first ends that interval, so this counts intervals.
  if (o.clock !== false) on('clock.every', () => { seen.ticks++; return { deny: 'test' } })
  // A $.clock.after timer fires at once on the fixed clock.
  if (o.clock !== false) on('clock.after', () => ({ value: undefined }))
  on('fs.read', (_, e) => {
    seen.reads.push(e.path)
    const text = file(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.exists', (_, e) => { seen.reads.push(e.path); return { value: file(e.path) !== undefined } })
  // `seen.writes`: every path the dashboard wrote; the write lands in `files`.
  on('fs.write', (_, e) => { seen.writes.push(e.path); files[e.path] = e.text; return { value: undefined } })
  if (o.clock !== false) on('clock.now', () => ({ value: 1_000 }))
  on('ui.status', (_, e) => { seen.status.push(e.text); return { value: undefined } })
  on('ui.toast', (_, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => { seen.opened++; return { value: { isPlaced: true } } })
  on('command.register', () => ({ value: { command: 'quorum-dashboard' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('ui.copy', (_, e) => { seen.copied.push(e.text); return { value: { isCopied: true as const } } })
  on('prompt.read', () => ({ value: { text: seen.draft, cursor: seen.draft.length } }))
  on('prompt.fill', (_, e) => { seen.filled.push(e.text); return { isFilled: true, origin: e.origin } })
  return seen
}

const repo = (status: string) => ({
  '.git/HEAD': 'ref: refs/heads/feat/export-csv\n',
  '.tasks/export-csv/state.md': state(status),
  '.tasks/export-csv/rd.md': RD,
  '.tasks/export-csv/eval.md': EVAL,
  '.tasks/export-csv/review/round-1/candidates.md': CANDIDATES,
  '.tasks/export-csv/review/round-1/survivors.md': SURVIVORS,
  '.tasks/export-csv/review/round-2/candidates.md': SURVIVORS,
})

describe('task helpers', () => {
  test('reads block and inline lists, quotes and nulls like quorum-state', () => {
    const fm = parseFrontmatter(state('IN_REVIEW', 'escalated_from: "BUILDING" # was\n'))
    expect(fm.round_shas).toEqual(['abc123', 'def456'])
    expect(fm.pending_findings).toEqual(['app/report.py:42'])
    expect(fm.escalated_from).toBe('BUILDING')
    expect(fm.signoff).toBe('null')
    expect(parseFrontmatter('no frontmatter')).toEqual({})
  })

  test('places statuses on the rail', () => {
    expect(stageOf('IN_REVIEW', undefined)).toBe(3)
    expect(stageOf('HALTED', 3)).toBe(3)
    expect(stageOf('ESCALATED', 2)).toBe(2)
    const rail = stages('CONVERGED', 'LOW', 4)
    expect(rail.map(s => s.state)).toEqual(['done', 'done', 'done', 'done', 'skipped', 'todo'])
    expect(stages('HALTED', 'HIGH', 3)[3]?.state).toBe('stuck')
    expect(stages('READY', 'HIGH', 5)[5]?.state).toBe('waiting')
    // The fast path skips the plan round, and LOW skips the blind test.
    expect(stages('IN_REVIEW', 'LOW', 3, true).map(s => s.state)).toEqual(['done', 'skipped', 'done', 'active', 'skipped', 'todo'])
    expect(stages('IN_REVIEW', 'LOW', 3)[1]?.state).toBe('done')
  })

  test('next steps, findings and branch slugs', () => {
    expect(nextStep('IN_REVIEW', 'MEDIUM')).toBe('/quorum:review-loop')
    expect(nextStep('CONVERGED', 'LOW')).toBe('LOW tasks already have their summary')
    expect(countFindings(CANDIDATES)).toEqual({ important: 2, nit: 2, preExisting: 0 })
    expect(slugFromHead('ref: refs/heads/fix/a.b-c\n')).toBe('a.b-c')
    expect(slugFromHead('ref: refs/heads/main')).toBe('')
  })

  test('an escaped pipe in a table cell is a | in that cell, not a new column', () => {
    expect(evalRows('## Task checks\n| # | Requirement | Command |\n|---|---|---|\n| 1 | a \\| b | `x \\| y` |\n')).toEqual([{ id: '1', label: 'a | b' }])
  })

  test('reads requirements, eval rows, and the prover table, and joins them', () => {
    expect(countRequirements(RD)).toBe(3)
    expect(evalRows(EVAL).map(r => r.id)).toEqual(['1', '2', '3'])
    const proof = parseProof(PROOF, 'proof-build.md')
    expect(proof.rev).toBe('1a2b3c4')
    expect(proof.result).toBe('1 FAIL')
    const checks = joinChecks(evalRows(EVAL), proof)
    expect(checks.map(c => `${c.id}:${c.result}`)).toEqual(['fast:PASS', '1:PASS', '2:FAIL', '3:PASS', '2b:PASS'])
    expect(joinChecks(evalRows(EVAL), null).every(c => c.result === null)).toBe(true)
  })

  test('reads what the task is from rd.md, and each requirement\'s checks', () => {
    const spec = parseSpec(RD)
    expect(spec?.title).toBe('Export customers as CSV (CARE-42)')
    expect(spec?.goal).toBe('Users can run export to get every customer as a CSV file.')
    expect(spec?.isUi).toBe(false)
    expect(spec?.requirements).toEqual([
      { n: '1', title: 'export writes a CSV of every customer.' },
      { n: '2', title: 'Commas are quoted' },
      { n: '3', title: 'Docs: add export to README.md.' },
    ])
    expect(spec?.nonGoals).toEqual(['No Excel output.'])
    expect(parseSpec('')).toBeNull()
    expect(parseSpec('1. **Fast checks pass:** run them.\n')?.requirements).toEqual([])
    expect(parseSpec('## Requirements\n1. **Fast checks pass:** run them.\n')?.requirements[0]?.title).toBe('Fast checks pass')

    const checks = joinChecks([{ id: '4, 5', label: '' }, { id: '6', label: '' }, { id: '6b', label: '' }], {
      file: 'proof-final.md', rev: '', result: '', rows: [{ id: '4, 5', check: '', result: 'PASS' }, { id: '6', check: '', result: 'PASS' }, { id: '6b', check: '', result: 'FAIL' }], verdicts: [],
    })
    expect(requirementState('5', checks)).toEqual({ checks: 1, state: 'pass' })
    expect(requirementState('6', checks)).toEqual({ checks: 2, state: 'fail' })
    expect(requirementState('16', checks)).toEqual({ checks: 0, state: 'none' })
    expect(requirementState('4', joinChecks([{ id: '4', label: '' }], null))).toEqual({ checks: 1, state: 'open' })
    // A final proof's verdict wins over the checks: a passing check doesn't make a PARTIAL requirement met.
    const verdicts = parseProof('Proof: x at 1a2b3c4\n\n## Requirements\n| Req | Verdict | Evidence |\n|---|---|---|\n| 5 | **PARTIAL** | no quoting |\n| R6 | MET | `a.py:3` |\n| 7 | maybe | ? |\n', 'proof-final.md').verdicts
    expect(verdicts).toEqual([{ n: '5', verdict: 'PARTIAL', evidence: 'no quoting' }, { n: '6', verdict: 'MET', evidence: 'a.py:3' }])
    expect(requirementState('5', checks, verdicts).state).toBe('fail')
    expect(requirementState('6', checks, verdicts).state).toBe('pass')
    expect(requirementState('16', checks, verdicts).state).toBe('none')
  })

  test('reads the branch\'s PR from gh, and says what it means', () => {
    const open = parsePr('x', '[{"number":33807,"state":"OPEN","isDraft":false,"url":"https://github.com/o/r/pull/33807"}]', 5)
    expect(open).toEqual({ slug: 'x', number: 33807, state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/33807', checkedAt: 5 })
    expect(parsePr('x', '[]', 5).state).toBe('NONE')
    expect(parsePr('x', 'not json', 5).state).toBe('UNKNOWN')
    expect(parsePr('x', '{"number":7,"state":"MERGED","isDraft":false,"url":"u"}', 5).state).toBe('MERGED')
    expect(prFromUrl('x', 'https://github.com/o/r/pull/42')).toEqual({ slug: 'x', number: 42, state: 'UNKNOWN', isDraft: false, url: 'https://github.com/o/r/pull/42', checkedAt: 0 })
    expect(prFromUrl('x', '')).toBeNull()
    expect(prDetail(prFromUrl('x', 'https://github.com/o/r/pull/42'), true)).toBe('PR #42')
    expect(prDetail(open, true)).toBe('PR #33807 open')
    expect(prDetail({ ...open, state: 'MERGED' }, true)).toBe('PR #33807 merged')
    expect(prDetail(parsePr('x', '[]', 5), true)).toBe('pr.md drafted, PR not opened yet')
    expect(prDetail(parsePr('x', 'not json', 5), true)).toBe('pr.md drafted')
    expect(prNext(open, true, 'fallback')).toBe('Get PR #33807 reviewed and merged')
    expect(prNext(null, false, 'fallback')).toBe('fallback')
    expect(isReportedPass('All eval checks pass on 673fa13 (fast checks 117/117).')).toBe(true)
    expect(isReportedPass('All checks pass except 7b, which fails.')).toBe(false)
    expect(isReportedPass('Ran the checks.')).toBe(false)
  })

  test('reads HEAD from packed-refs and tells a stale proof', () => {
    const sha = 'a'.repeat(40)
    expect(packedRef(`# pack-refs with: peeled\n${sha} refs/heads/feat/x\n`, 'refs/heads/feat/x')).toBe(sha)
    expect(packedRef(`${sha} refs/heads/main\n`, 'refs/heads/feat/x')).toBe('')
    expect(isStaleProof('1a2b3c4', '1a2b3c4' + 'f'.repeat(33))).toBe(false)
    expect(isStaleProof('1a2b3c4', '9'.repeat(40))).toBe(true)
    expect(isStaleProof('1a2b3c4', '')).toBe(false)
  })

  test('reads a blind run and names reviewers by persona', () => {
    expect(parseBlind(1, { blind: BLIND, triage: TRIAGE })).toEqual({
      run: 1, result: 'NOT REACHED', blockers: 1, friction: 2, a11y: null, security: null, caused: 1,
    })
    expect(roleOf('code-reviewer', 'Persona: Architecture, Security & Drift Hunter. Task: x')).toBe('architecture')
    expect(roleOf('code-reviewer', 'Mode: plan. Persona: Test Adequacy Hunter, plan mode. Task: x')).toBe('tests')
    expect(roleOf('spec-reviewer', 'Persona: Spec Improver. Task: x')).toBe('improver')
    expect(roleOf('verifier-voter', 'Task: x')).toBe('voter')
    expect(roleOf('builder', 'Task: x')).toBe('builder')
  })

  test('a round expects the reviewers its tier gets, plus any conditional one that replied', () => {
    expect(roundReviewers('review', 'LOW', {}).map(r => r.role)).toEqual(['logic'])
    expect(roundReviewers('review', 'MEDIUM', { 'a11y.md': 'Summary: 0 issues found. Ready to land.' }).map(r => r.role))
      .toEqual(['logic', 'architecture', 'patterns', 'docs', 'a11y'])
    expect(roundReviewers('plan', 'HIGH', {}).map(r => r.role)).toEqual(['logic', 'architecture', 'patterns', 'docs', 'security'])
    expect(roundReviewers('review', 'LOW', { 'logic.md': SURVIVORS })[0]?.findings).toEqual({ important: 1, nit: 1, preExisting: 0 })
    // A standalone review's HIGH tier always gets the security reviewer, as a plan's does; a task's review loop doesn't.
    expect(roundReviewers('standalone', 'HIGH', {}).map(r => r.role)).toEqual(['logic', 'architecture', 'patterns', 'docs', 'security'])
    expect(roundReviewers('review', 'HIGH', {}).map(r => r.role)).toEqual(['logic', 'architecture', 'patterns', 'docs'])
  })

  test('reads a standalone review\'s folder, run, and range', () => {
    expect(isReviewId('review-pr-12')).toBe(true)
    expect(isReviewId('review-feat-csv-export')).toBe(true)
    expect(isReviewId('export-csv')).toBe(false)
    expect(isReviewId('review-')).toBe(false)
    expect(latestRun([])).toBe(0)
    expect(latestRun(['run-1', 'run-10', 'run-2', 'intent.md', 'run-x'])).toBe(10)
    expect(shortRange(`${'1a2b3c4'.padEnd(40, '0')}..${'5d6e7f8'.padEnd(40, 'a')}`)).toBe('1a2b3c4..5d6e7f8')
    expect(shortRange('main..HEAD')).toBe('main..HEAD')
  })

  test('the live review is this session\'s running one; times read as how long ago', () => {
    const r = (id: string, status: string, isOurs: boolean) => ({ id, status, isOurs })
    expect(liveReview([r('a', 'REVIEWED', true), r('b', 'REVIEWING', false), r('c', 'FIXING', true)])?.id).toBe('c')
    expect(liveReview([r('a', 'INTERRUPTED', true), r('b', 'REVIEWING', false)])).toBeNull()
    expect(ago(60_000, 30_000)).toBe('just now')
    expect(ago(5 * 60_000, 0)).toBe('5m ago')
    expect(ago(3 * 3_600_000, 0)).toBe('3h ago')
    expect(ago(3 * 86_400_000, 0)).toBe('3d ago')
  })

  test('reads files.tsv strictly: a bad header or a short row is no list', () => {
    const head = `# quorum-files 1 head=${'a'.repeat(40)} base=${'b'.repeat(40)} since=def456 recorded=1763300000`
    const good = `${head}\nM\t86\t3\tsrc/a.ts\t-\t1,3\t1\nA\t-\t-\tsrc/b.ts\t-\t3\t0\nR\tbin\tbin\tdocs/café notes.md\told.md\t-\t-\n`
    expect(parseFileList(good)).toEqual({
      head: 'a'.repeat(40), base: 'b'.repeat(40), since: 'def456', recorded: 1763300000, files: [
        { letter: 'M', added: 86, removed: 3, path: 'src/a.ts', oldPath: '', steps: [1, 3], fix: true },
        { letter: 'A', added: null, removed: null, path: 'src/b.ts', oldPath: '', steps: [3], fix: false },
        { letter: 'R', added: 'bin', removed: 'bin', path: 'docs/café notes.md', oldPath: 'old.md', steps: [], fix: null },
      ],
    })
    // Before the build, and with no rows: `-` reads as ''.
    expect(parseFileList(`# quorum-files 1 head=${'a'.repeat(40)} base=- since=- recorded=1\n`)).toEqual({ head: 'a'.repeat(40), base: '', since: '', recorded: 1, files: [] })
    // A bad header, or any bad row, is no list.
    for (const bad of [
      '',
      good.replace('# quorum-files 1 ', '# quorum-files 2 '),
      good.replace(` recorded=1763300000`, ''),
      good.replace(`head=${'a'.repeat(40)}`, 'head=abc1234'),
      good.replace('since=def456', 'since=xyz'),
      `${head}\nM\t86\tsrc/a.ts\n`,
      `${head}\nM\t86\t3\tsrc/a.ts\t-\t1\t1\textra\n`,
      `${head}\nX\t86\t3\tsrc/a.ts\t-\t1\t1\n`,
      `${head}\nM\t8x\t3\tsrc/a.ts\t-\t1\t1\n`,
      `${head}\nM\t86\t3\t\t-\t1\t1\n`,
      `${head}\nM\t86\t3\tsrc/a.ts\t-\t1,,3\t1\n`,
      `${head}\nM\t86\t3\tsrc/a.ts\t-\t1\t2\n`,
    ]) expect(parseFileList(bad)).toBeNull()
  })
})

const reviewState = (status: string, risk = 'MEDIUM', session = 'sess-a') => `---
slug: review-pr-12
kind: review
range: ${'1a2b3c4'.padEnd(40, '0')}..${'5d6e7f8'.padEnd(40, 'a')}
session: ${session}
risk: ${risk}
status: ${status}
round: 0
---
## Run 1
`

test('this session\'s review with no task shows in the band and the pane: reviewers, voter, builder, then history', async ($, on) => {
  const files: Record<string, string> = {
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.tasks/review-pr-12/state.md': reviewState('REVIEWING'),
    '.tasks/review-pr-12/intent.md': 'From PR #12\n',
  }
  const seen = world(on, files)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(seen.opened).toBe(1)

  // Before its first run folder: the card says so, and nothing has replied.
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^review-pr-12$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^REVIEWING · MEDIUM · 1a2b3c4\.\.5d6e7f8$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Picking the reviewers/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /No active Quorum task/ })).toBeUndefined()
  await pane.unmount()

  files['.tasks/review-pr-12/run-1/logic.md'] = SURVIVORS
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/review-pr-12/run-1/logic.md', content: SURVIVORS })
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^ REVIEWING $/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^review-pr-12 · MEDIUM$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^reviewers 1\/4$/ })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'next' })).toBeUndefined()
  await band.unmount()
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /run 1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /reviewers 1\/4 replied/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✗ Logic & edge cases\s+✗1 n1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^○ Verifier vote\s+waiting$/ })).toBeDefined()
  await pane.unmount()

  for (const role of ['architecture', 'patterns', 'docs']) files[`.tasks/review-pr-12/run-1/${role}.md`] = 'Summary: 0 issues found.\n'
  await $.tool.call({ tool: 'Bash', command: 'cat > .tasks/review-pr-12/run-1/candidates.md' })
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^voter voting$/ })).toBeDefined()
  await band.unmount()

  // The voter kept the finding, and the builder is fixing it.
  files['.tasks/review-pr-12/run-1/votes.md'] = SURVIVORS
  files['.tasks/review-pr-12/run-1/survivors.md'] = SURVIVORS
  files['.tasks/review-pr-12/state.md'] = reviewState('FIXING')
  await $.tool.call({ tool: 'Bash', command: 'quorum-state --task review-pr-12 set status FIXING' })
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^ FIXING $/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^builder fixing$/ })).toBeDefined()
  await band.unmount()
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^✗ Verifier vote\s+kept ✗1 n1 → fix$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^○ Builder\s+fixes ✗1$/ })).toBeDefined()
  // The kept findings, as a tree under the builder: a row per file, and a row per finding that opens to a copy
  // button for its location.
  expect(await rowOf(pane, 'review-pr-12:tree:app/report.py')).toMatch(/^ {4}report\.py +✗1 {2}n1$/)
  expect(await rowOf(pane, 'review-pr-12:tree:app/report.py:42#0')).toMatch(/✗ :42 Unescaped CSV fields$/)
  await pane.press({ key: 'review-pr-12:tree:app/report.py:42#0' })
  await pane.press({ key: 'review-pr-12:tree:app/report.py:42#0:copy' })
  expect(seen.copied).toEqual(['app/report.py:42'])
  await pane.unmount()

  // Once REVIEWED it's over: the band is the engine's again, and the pane keeps the review in its history, open by
  // itself since there's no task. Its row opens to the range and the kept findings.
  files['.tasks/review-pr-12/state.md'] = reviewState('REVIEWED')
  await $.tool.call({ tool: 'Bash', command: 'quorum-state --task review-pr-12 set status REVIEWED' })
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await band.unmount()
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /No active Quorum task/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^1 review · newest just now$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^review-pr-12 {2}$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✗1 n1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ · MEDIUM · 1 run · just now$/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'review-pr-12:tree:app/report.py' })).toBeUndefined()
  await pane.press({ key: 'past-toggle-review-pr-12' })
  expect(await pane.find({ type: 'Text', text: /^1a2b3c4\.\.5d6e7f8$/ })).toBeDefined()
  expect(await rowOf(pane, 'review-pr-12:tree:app/report.py')).toMatch(/^ {4}report\.py +✗1 {2}n1$/)
  // The finding is still open from the card: its fold choice is kept per review id.
  await pane.press({ key: 'review-pr-12:tree:app/report.py:42#0:copy' })
  expect(seen.copied).toEqual(['app/report.py:42', 'app/report.py:42'])
  await pane.unmount()
})

test('beside an active task, this session\'s review is live and the rest are history, unfinished ones flagged', async ($, on) => {
  const files: Record<string, string> = {
    ...repo('IN_REVIEW'),
    '.tasks/review-pr-12/state.md': reviewState('REVIEWING', 'HIGH'),
    '.tasks/review-pr-9/state.md': reviewState('REVIEWED'),
    '.tasks/review-pr-9/run-1/survivors.md': 'Summary: 0 IMPORTANT, 0 NIT, 0 PRE-EXISTING\n',
    // Running, but in another session: live there, or that session died.
    '.tasks/review-main/state.md': reviewState('REVIEWING', 'MEDIUM', 'sess-b'),
    '.tasks/review-old/state.md': reviewState('INTERRUPTED'),
    '.tasks/review-old/run-1/logic.md': SURVIVORS,
    // A task whose slug happens to start with review-: no `kind: review`, so not a review.
    '.tasks/review-copy/state.md': state('IN_REVIEW'),
  }
  world(on, files, '/repo', {
    '.tasks/review-pr-12/state.md': 30, '.tasks/review-pr-9/state.md': 40, '.tasks/review-main/state.md': 10,
    '.tasks/review-old/state.md': 5, '.tasks/review-copy/state.md': 50,
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^ IN_REVIEW $/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^export-csv · MEDIUM$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^review-pr-12: reviewers 0\/5$/ })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'next' }))?.text).toBe('▶ /quorum:review-loop')
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Code review, round 2 of 3/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^review-pr-12$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^REVIEWING · HIGH · / })).toBeDefined()
  // Beside a task the history starts folded, newest first, and says how many never finished.
  expect(await pane.find({ type: 'Text', text: /^3 reviews · newest just now$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /2 unfinished/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^review-main {2}$/ })).toBeUndefined()
  await pane.press({ key: 'toggle-reviews' })
  expect(await pane.find({ type: 'Text', text: /^review-pr-9 {2}$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^clean$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^running elsewhere or interrupted$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^interrupted$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^review-copy/ })).toBeUndefined()
  await pane.press({ key: 'past-toggle-review-old' })
  expect(await pane.find({ type: 'Text', text: /Run 1 never finished/ })).toBeDefined()
  await pane.press({ key: 'past-toggle-review-main' })
  expect(await pane.find({ type: 'Text', text: /Another session runs it, or stopped mid-run/ })).toBeDefined()
  await pane.unmount()

  // A narrow band keeps to the task.
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 100 }, surface: 'terminal' })
  expect(await narrow.find({ type: 'Text', text: /review-pr-12/ })).toBeUndefined()
  await narrow.unmount()
})

test('another session\'s running review never takes the band, or opens the pane by itself', async ($, on) => {
  const seen = world(on, { '.git/HEAD': 'ref: refs/heads/main\n', '.tasks/review-pr-12/state.md': reviewState('REVIEWING', 'MEDIUM', 'sess-b') })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(seen.opened).toBe(0)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /No active Quorum task/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^running elsewhere or interrupted$/ })).toBeDefined()
  await pane.unmount()
})

test('the band and pane show the active task, and Quorum keeps no status line', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(seen.status).toEqual([undefined])
  expect(seen.opened).toBe(1)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^ IN_REVIEW $/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^export-csv · MEDIUM$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^ Review 2\/3$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^1 pending$/ })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'next' }))?.text).toBe('▶ /quorum:review-loop')
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /2 plan review rounds, approved 2026-11-08/ })).toBeDefined()
  // Checks holds a problem (a pending finding), so it opens by itself; the rounds stay folded to their summary.
  expect(await pane.find({ type: 'Text', text: /1 finding pending/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^code r1 ✗1 · r2 reviewing$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /voter kept 2 of 4/ })).toBeUndefined()
  await pane.press({ key: 'toggle-rounds' })
  expect(await pane.find({ type: 'Text', text: /voter kept 2 of 4/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /2 candidates, voting/ })).toBeDefined()
  await pane.unmount()
})

test('a fast-path task says so under the stage rail, with no plan rounds', async ($, on) => {
  const fast = state('BUILDING').replace('risk: MEDIUM', 'risk: LOW\nfast: true\nbug: true')
    .replace('plan_rounds: 2', 'plan_rounds: 0').replace('plan_approved: 2026-11-08', 'plan_approved: null')
  world(on, { ...repo('BUILDING'), '.tasks/export-csv/state.md': fast })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^bug fix: proven when its reproduction passes and fails without the fix · fast path: no plan round, one reviewer$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /plan review round/ })).toBeUndefined()
  await pane.unmount()
})

test('a large plan built a step at a time shows its progress on the Build stage', async ($, on) => {
  const plan = '# Plan\n\n## Steps\n1. **One** — a\n2. **Two** — b\n   - detail\n3. **Three** — c\n4. **Four** — d\n5. **Five** — e\n\n## Tests\n1. not a step\n'
  const building = state('BUILDING').replace('pending_findings: ["app/report.py:42"]', 'pending_findings: []\nbuilt_steps: ["1", "2"]')
  world(on, { ...repo('BUILDING'), '.tasks/export-csv/state.md': building, '.tasks/export-csv/plan.md': plan })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Build 2\/5/ })).toBeDefined()
  await pane.unmount()
})

test('a HALTED or ESCALATED task stays on the stage it stopped at, across a restart', async ($, on) => {
  const files: Record<string, string> = repo('ESCALATED')
  files['.tasks/export-csv/state.md'] = state('ESCALATED', 'escalated_from: BUILDING\n')
  world(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Fix the failing checks/ })).toBeDefined()
  await pane.unmount()

  files['.tasks/export-csv/state.md'] = state('HALTED').replace('blind_runs: 0', 'blind_runs: 2')
  await $.tool.call({ tool: 'Bash', command: 'quorum-state set status HALTED' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^ HALTED $/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^ Blind test$/ })).toBeDefined()
  await band.unmount()
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /blind test: 2 runs/ })).toBeDefined()
  await pane.unmount()
})

test('a status change toasts once, and only for statuses worth it', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  const seen = world(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(seen.toasts).toEqual([])

  files['.tasks/export-csv/state.md'] = state('CONVERGED')
  await $.tool.call({ tool: 'Bash', command: 'quorum-state set status CONVERGED' })
  expect(seen.toasts).toEqual(['export-csv: review converged'])

  // An unrelated command doesn't re-read.
  files['.tasks/export-csv/state.md'] = state('HALTED')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(seen.toasts.length).toBe(1)
})

test('in a task\'s worktree, the pane shows that task, from the main tree\'s .tasks/, and lists the others', async ($, on) => {
  const other = (status: string, extra = '') => `---\nslug: x\nrisk: LOW\nstatus: ${status}\n${extra}---\n`
  world(on, {
    // The session moved into the worktree: its .git names its git dir, whose commondir leads to the main one.
    '.git': 'gitdir: /repo/.git/worktrees/export-csv\n',
    '/repo/.git/worktrees/export-csv/HEAD': 'ref: refs/heads/feat/export-csv\n',
    '/repo/.git/worktrees/export-csv/commondir': '../..\n',
    '/repo/.tasks/.active': 'import-xls\n',
    '/repo/.tasks/export-csv/state.md': state('IN_REVIEW', 'worktree: /repo/.claude/worktrees/export-csv\n'),
    '/repo/.tasks/export-csv/rd.md': RD,
    '/repo/.tasks/import-xls/state.md': other('PLANNING'),
    '/repo/.tasks/ui-copy/state.md': other('BUILDING', 'worktree: /repo/.claude/worktrees/ui-copy\n'),
    '/repo/.tasks/old-fix/state.md': other('READY'),
    '/repo/.tasks/review-pr-3/state.md': other('REVIEWING', 'kind: review\n'),
  }, '/repo/.claude/worktrees/export-csv', { '/repo/.tasks/ui-copy/state.md': 900, '/repo/.tasks/import-xls/state.md': 800 },
  ['/repo/.tasks/export-csv', '/repo/.tasks/ui-copy'])
  await $.session.start({ cwd: '/repo/.claude/worktrees/export-csv', surface: 'terminal', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^export-csv · $/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^2 unfinished tasks · 1 in worktrees$/ })).toBeDefined()
  await pane.press({ key: 'toggle-tasks' })
  expect(await pane.find({ type: 'Text', text: /^ui-copy\s+BUILDING · LOW · own worktree · just now$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^import-xls\s+PLANNING · LOW · just now$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /old-fix|review-pr-3/ })).toBeUndefined()
  await pane.unmount()
})

test('a worktree on a branch with no task shows no task, even with .tasks/.active set', async ($, on) => {
  world(on, {
    '.git': 'gitdir: /repo/.git/worktrees/side\n',
    '/repo/.git/worktrees/side/HEAD': 'ref: refs/heads/feat/unrelated\n',
    '/repo/.git/worktrees/side/commondir': '../..\n',
    '/repo/.tasks/.active': 'export-csv\n',
    '/repo/.tasks/export-csv/state.md': state('IN_REVIEW'),
  }, '/repo/.claude/worktrees/side')
  await $.session.start({ cwd: '/repo/.claude/worktrees/side', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^No active Quorum task$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^1 unfinished task$/ })).toBeDefined()
  await pane.unmount()
})

test('task files are read from the project root, not the working directory', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'), '/work/repo')
  await $.session.start({ cwd: '/work/repo/app', surface: 'terminal', isInteractive: true })
  expect(seen.status).toEqual([undefined])
})

test('with no task the band is the engine\'s and the status line is clear', async ($, on) => {
  const seen = world(on, { '.git/HEAD': 'ref: refs/heads/main\n' })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBeUndefined()
  expect(seen.opened).toBe(0)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await band.unmount()
})

test('kept findings read with their tag, location, Pattern Category, and confidence', () => {
  const kept = keptFindings(`Summary: 1 IMPORTANT, 1 NIT, 0 PRE-EXISTING

[IMPORTANT] app/report.py:42 — Pattern Category: Unescaped CSV fields
Confidence: 95
Mechanism: a comma splits a row.

[NIT] app/report.py:7 — naming

## Dropped
DROP [IMPORTANT] app/report.py:5 — (b) handled by the caller
`)
  expect(kept).toEqual([
    { tag: 'IMPORTANT', loc: 'app/report.py:42', title: 'Unescaped CSV fields', confidence: 95, security: null },
    { tag: 'NIT', loc: 'app/report.py:7', title: 'naming', confidence: null, security: null },
  ])
})

test('the next step names the command the Next button fills, if any', () => {
  expect(nextCommand('/quorum:review-loop')).toBe('/quorum:review-loop')
  expect(nextCommand('Review mockup.html, then /quorum:plan')).toBe('/quorum:plan')
  expect(nextCommand('Get PR #42 reviewed and merged')).toBeNull()
})

test('a ticket id in the title moves out of it', () => {
  expect(splitTicket('Export customers as CSV (CARE-42)')).toEqual({ title: 'Export customers as CSV', ticket: 'CARE-42' })
  expect(splitTicket('Export customers as CSV')).toEqual({ title: 'Export customers as CSV', ticket: '' })
  expect(splitTicket('Fix (some) parsing')).toEqual({ title: 'Fix (some) parsing', ticket: '' })
})

test('sections open by themselves only while they hold a problem', () => {
  const base = { spec: null, checks: [], proof: null, isProofStale: false, expectedProof: '', stopBlocks: 0, status: 'IN_REVIEW', pending: 0 }
  const t = (extra: object) => ({ ...base, ...extra }) as unknown as Parameters<typeof openByDefault>[0]
  expect(openByDefault(t({}))).toEqual({ tasks: false, requirements: false, checks: false, rounds: false, reviews: false, spend: false, agents: false })
  expect(openByDefault(t({ isProofStale: true })).checks).toBe(true)
  expect(openByDefault(t({ expectedProof: 'proof-final.md' })).checks).toBe(true)
  expect(openByDefault(t({ pending: 1 })).checks).toBe(true)
  expect(openByDefault(t({ stopBlocks: 2, status: 'BUILDING' })).checks).toBe(true)
  expect(openByDefault(t({ stopBlocks: 2, status: 'AWAITING-HUMAN' })).checks).toBe(false)
  expect(openByDefault(t({ status: 'HALTED' })).rounds).toBe(true)
})

test('the band names what is wrong, briefly', () => {
  const checks = [{ id: '1', label: 'a', result: 'FAIL' }, { id: '2', label: 'b', result: 'FAIL' }, { id: '3', label: 'c', result: 'PASS' }]
  const proof = { file: 'proof-build.md', rev: 'abc', result: '', rows: [] }
  expect(problemsOf({ proof, checks, isProofStale: true, pending: 1 } as never)).toEqual(['✗ 2 checks failing', 'proof older than HEAD', '1 pending'])
  expect(problemsOf({ proof: null, checks, isProofStale: false, pending: 0 } as never)).toEqual([])
})

test('the band\'s Next fills the prompt, and a narrow band keeps the badge, the dots, and the buttons', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'next' })
  await settle()
  expect(seen.filled).toEqual(['/quorum:review-loop '])
  await band.unmount()

  band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 80 }, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^ IN_REVIEW $/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^export-csv · MEDIUM$/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /^ Review 2\/3$/ })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'next' }))?.text).toBe('▶ Next')
  expect(await band.find({ type: 'Button', key: 'open' })).toBeDefined()
  await band.unmount()
})

test('the Next button puts the command in the prompt, after nothing or before a draft, and never sends it', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'))
  let sent = 0
  on('session.send', () => { sent++; return { value: { isSent: false } } as never })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Button', key: 'next' }))?.text).toBe('▶ Next: /quorum:review-loop')

  await pane.press({ key: 'next' })
  await settle()
  seen.draft = 'focus on the CSV quoting'
  await pane.press({ key: 'next' })
  await settle()
  seen.draft = '/quorum:review-loop --models'
  await pane.press({ key: 'next' })
  await settle()
  expect(seen.filled).toEqual(['/quorum:review-loop ', '/quorum:review-loop focus on the CSV quoting', '/quorum:review-loop --models'])
  expect(sent).toBe(0)
  await pane.unmount()
})

test('a section the person closes stays closed, even while it holds a problem', async ($, on) => {
  world(on, repo('IN_REVIEW'))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // A pending finding opens Checks by itself.
  expect(await pane.find({ type: 'Text', text: /1 finding pending for the builder/ })).toBeDefined()
  await pane.press({ key: 'toggle-checks' })
  expect(await pane.find({ type: 'Text', text: /1 finding pending for the builder/ })).toBeUndefined()
  // Folded, its row still names the worst of what's wrong: the missing proof before the pending finding.
  expect(await pane.find({ type: 'Text', text: /proof-build\.md missing$/ })).toBeDefined()
  await pane.press({ key: 'toggle-checks' })
  expect(await pane.find({ type: 'Text', text: /1 finding pending for the builder/ })).toBeDefined()
  await pane.unmount()
})

test('a plan\'s steps are the numbered lines under its Steps heading', () => {
  expect(countPlanSteps('## Steps\n1. a\n2. b\n   - c\n\n## Tests\n1. no\n')).toBe(2)
  expect(countPlanSteps('')).toBe(0)
})

test('plan steps are read from plan.md with their number, title, requirements, and line span', () => {
  const plan = [
    '# Plan', //                                                    1
    '', //                                                          2
    '## Steps', //                                                  3
    '1. **The parser** — `task.ts` · requirements: 1, 2', //       4
    '   - Reuses: `plain`.', //                                     5
    '   - Convention: no `$`.', //                                  6
    '   ', //                                                       7: spaces only
    '\t', //                                                        8: a tab only
    '', //                                                          9
    '2. **Ünïcode — the list** — `a.ts` · requirements: 3 ,4, · mechanical', // 10
    '\t- a tab-indented line', //                                   11
    '', //                                                          12
    '', //                                                          13
    '4. Gap step without bold', //                                  14
    '   - last indented', //                                        15
    '', //                                                          16
    '## Tests', //                                                  17
    '1. not a step', //                                             18
  ].join('\n')
  expect(parsePlanSteps(plan)).toEqual([
    { n: 1, title: 'The parser', requirements: [1, 2], from: 4, to: 6 },
    { n: 2, title: 'Ünïcode — the list', requirements: [3, 4], from: 10, to: 11 },
    { n: 4, title: 'Gap step without bold', requirements: [], from: 14, to: 15 },
  ])
  // A step's own number again continues it; a number that comes back after another step is ignored, and ends that step.
  expect(parsePlanSteps('## Steps\n1. A\n   a\n1. again\n   b\n2. B\n')).toEqual([
    { n: 1, title: 'A', requirements: [], from: 2, to: 5 },
    { n: 2, title: 'B', requirements: [], from: 6, to: 6 },
  ])
  expect(parsePlanSteps('## Steps\n1. A\n2. B\n   b\n1. C\n   c\n')).toEqual([
    { n: 1, title: 'A', requirements: [], from: 2, to: 2 },
    { n: 2, title: 'B', requirements: [], from: 3, to: 4 },
  ])
  // An unindented line ends a step.
  expect(parsePlanSteps('## Steps\n1. A\n   a\nprose\n   not a\n')).toEqual([{ n: 1, title: 'A', requirements: [], from: 2, to: 3 }])
  // No plan.md, no Steps section, or no numbered steps: no list.
  expect(parsePlanSteps('')).toEqual([])
  expect(parsePlanSteps('# Plan\n1. a\n   b\n## Tests\n')).toEqual([])
  expect(parsePlanSteps('## Steps\n- a\n   b\n## Tests\n1. c\n')).toEqual([])
})

test('the step spans match the lines quorum-plan show prints', () => {
  const steps = parsePlanSteps(DEMO_PLAN)
  const lines = DEMO_PLAN.split('\n')
  expect(steps.map(s => s.n)).toEqual([1, 2, 3])
  const shown = steps.flatMap(s => lines.slice(s.from - 1, s.to).filter(l => !/^[ \t]*$/.test(l))).join('\n') + '\n'
  expect(shown).toBe(DEMO_PLAN_SHOW)
})

test('git\'s relative paths resolve', () => {
  expect(normalizePath('/repo/.git/worktrees/a/../..')).toBe('/repo/.git')
  expect(normalizePath('/repo/./.claude//worktrees/a')).toBe('/repo/.claude/worktrees/a')
})

test('token counts read in a few characters', () => {
  expect(tokenCount(950)).toBe('950')
  expect(tokenCount(12_345)).toBe('12k')
  expect(tokenCount(999_600)).toBe('1M')
  expect(tokenCount(1_400_000)).toBe('1.4M')
})

test('spend totals the agents\' tokens and counts them by model, most used first', () => {
  const agent = (id: string, model: string, tokensIn: number, tokensCached: number, tokensOut: number) =>
    ({ id, type: 'code-reviewer', role: 'logic', description: id, model, startedAt: 0, endedAt: 1, tokensIn, tokensCached, tokensOut })
  const spend = spendOf([agent('a', 'opus', 100, 50, 10), agent('b', 'haiku', 20, 0, 5), agent('c', 'haiku', 30, 10, 5)])
  expect(spend.agents).toBe(3)
  expect(spend.tokensIn).toBe(150)
  expect(spend.tokensCached).toBe(60)
  expect(spend.tokensOut).toBe(20)
  expect(spend.models).toEqual([['haiku', 2], ['opus', 1]])
  expect(spendOf([]).agents).toBe(0)
})

test('a model choice matches the model the engine reports by alias, and inherit is never a mismatch', () => {
  const agent = (type: string, model: string) =>
    ({ id: type, type, role: type, description: type, model, startedAt: 0, endedAt: 1, tokensIn: 0, tokensCached: 0, tokensOut: 0 })
  const crew = [agent('code-reviewer', 'claude-haiku-5-5'), agent('pr-writer', 'claude-sonnet-5-5'), agent('pr-writer', 'claude-sonnet-5-5'), agent('prover', 'claude-opus-5-5')]
  expect(modelMismatches(crew, 'haiku', 'haiku')).toEqual(['helpers chose haiku, but 2 ran on claude-sonnet-5-5'])
  expect(modelMismatches(crew, 'claude-haiku-5-5', 'inherit')).toEqual([])
  expect(modelMismatches(crew, '', '')).toEqual([])
  expect(choiceLabel('inherit')).toBe('session model')
})

test('the pane shows what the command\'s agents used, from each request, and the model each ran on', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  world(on, files)
  on('agent.spawn', (_, e) => ({ model: e.subagentType === 'quorum:verifier-voter' ? 'claude-haiku-5-5' : 'claude-opus-5-5', agentId: e.tool_use_id }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const,
      usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 99_000, model: e.model },
    }
  })
  const spawn = (id: string, subagentType: string, prompt: string) =>
    $.agent.spawn({ tool_use_id: id, prompt, description: id, subagentType, parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^Spend\s*$/ })).toBeUndefined()
  await pane.unmount()

  await spawn('a1', 'quorum:code-reviewer', 'Persona: Logic & Edge-Case Hunter. Task: export-csv.')
  await spawn('v1', 'quorum:verifier-voter', 'Task: export-csv.')
  // A stream runs as it's read: read each to its end, as the engine does.
  const step = async (agentId: string | undefined, index: number) => {
    const stream = $.turn.step({ turnId: 't', index, model: 'm', messageCount: 1, agentId })
    for await (const _ of stream) { /* no chunks */ }
    return stream.result
  }
  await step('a1', 0)
  await step('a1', 1)
  await step('v1', 0)
  await step(undefined, 0) // the main loop's own request isn't an agent's

  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^Spend\s*$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^2 agents · 1\.5M in · 6k out$/ })).toBeDefined()
  await pane.press({ key: 'toggle-spend' })
  expect(await pane.find({ type: 'Text', text: /^Since the last command; 1\.2M of the input was cached$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^claude-opus-5-5 ×1 · claude-haiku-5-5 ×1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Chosen: reviewers not chosen · helpers not chosen$/ })).toBeDefined()
  await pane.unmount()
})

test('an agent on another model than the task chose is flagged, and opens Spend by itself', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  files['.tasks/export-csv/state.md'] = state('IN_REVIEW', 'reviewer_model: haiku\nhelper_model: inherit\n')
  world(on, files)
  on('agent.spawn', (_, e) => ({ model: e.subagentType === 'quorum:verifier-voter' ? 'claude-haiku-5-5' : 'claude-opus-5-5', agentId: e.tool_use_id }))
  const spawn = (id: string, subagentType: string, prompt: string) =>
    $.agent.spawn({ tool_use_id: id, prompt, description: id, subagentType, parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await spawn('a1', 'quorum:code-reviewer', 'Persona: Logic & Edge-Case Hunter. Task: export-csv.')
  await spawn('v1', 'quorum:verifier-voter', 'Task: export-csv.')
  await spawn('b1', 'quorum:builder', 'Task export-csv. Fix the findings.')

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^\s*model mismatch$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Chosen: reviewers haiku · helpers session model$/ })).toBeDefined()
  // The voter ran on haiku as chosen, and the builder always runs on the session's model.
  expect(await pane.find({ type: 'Text', text: /^⚠ reviewers chose haiku, but 1 ran on claude-opus-5-5$/ })).toBeDefined()
  await pane.unmount()
})

test('the round\'s reviewers show waiting, running, then their findings', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  const seen = world(on, files)
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.tool_use_id }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const spawn = (id: string, subagentType: string, prompt: string) =>
    $.agent.spawn({ tool_use_id: id, prompt, description: id, subagentType, parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Code review, round 2 of 3/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /reviewers 0\/4 replied/ })).toBeDefined()
  await pane.unmount()

  expect(seen.ticks).toBe(0)
  await spawn('a1', 'quorum:code-reviewer', 'Persona: Logic & Edge-Case Hunter. Task: export-csv.')
  expect(seen.ticks).toBe(1)
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /running 0s/ })).toBeDefined()
  await pane.unmount()

  // The skill saves the reply with Write, which re-reads the round.
  files['.tasks/export-csv/review/round-2/logic.md'] = SURVIVORS
  await $.turn.complete({ agentId: 'a1', turnId: 'x', answer: 'done', reason: 'answer', durationMs: 1, isAborted: false })
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/review/round-2/logic.md', content: SURVIVORS })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /reviewers 1\/4 replied/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✗ Logic & edge cases\s+✗1 n1$/ })).toBeDefined()
  await pane.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^reviewers 1\/4$/ })).toBeDefined()
  await band.unmount()

  // The first interval was cancelled when the agent finished, so the next agent starts a new one.
  await spawn('v1', 'quorum:verifier-voter', 'Task: export-csv.')
  expect(seen.ticks).toBe(2)

  files['.tasks/export-csv/review/round-2/votes.md'] = SURVIVORS
  files['.tasks/export-csv/review/round-2/survivors.md'] = SURVIVORS
  await $.tool.call({ tool: 'Bash', command: 'quorum-findings cap 2 votes.md > .tasks/export-csv/review/round-2/survivors.md' })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^✗ Verifier vote\s+kept ✗1 n1 → fix round$/ })).toBeDefined()
  // Each kept finding, as a row under its file with its mark, line, and Pattern Category; opened, a copy button
  // for its location.
  expect((await pane.find({ type: 'Button', key: 'export-csv:tree:app/report.py' }))?.text).toMatch(/^ {4}report\.py +✗1 {2}n1$/)
  expect((await pane.find({ type: 'Button', key: 'export-csv:tree:app/report.py:42#0' }))?.text).toMatch(/✗ :42 Unescaped CSV fields$/)
  await pane.press({ key: 'export-csv:tree:app/report.py:42#0' })
  await pane.press({ key: 'export-csv:tree:app/report.py:42#0:copy' })
  expect(seen.copied).toEqual(['app/report.py:42'])
  await pane.unmount()
})

test('the pane opens with what the task is: title, goal, requirements, and what is out of scope', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The ticket id moves out of the title, to the header's right.
  expect(await pane.find({ type: 'Text', text: /^Export customers as CSV$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^CARE-42$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Users can run export to get every customer as a CSV file\.$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^3 in rd\.md$/ })).toBeDefined()
  // Nothing wrong with the requirements yet, so they're folded until clicked.
  expect(await pane.find({ type: 'Text', text: /^○ 2  Commas are quoted$/ })).toBeUndefined()
  await pane.press({ key: 'toggle-requirements' })
  expect(await pane.find({ type: 'Text', text: /^○ 2  Commas are quoted$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^- No Excel output\.$/ })).toBeDefined()
  await pane.unmount()

  files['.tasks/export-csv/proof-build.md'] = PROOF
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/proof-build.md', content: PROOF })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // A failed requirement opens the section by itself.
  expect(await pane.find({ type: 'Text', text: /^2\/3 met$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✗ 2  Commas are quoted$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✓ 3  Docs: add export to README\.md\.$/ })).toBeDefined()
  await pane.unmount()

  // The final proof's verdicts decide, with their evidence, even where every check passed.
  const FINAL = `${PROOF.replace('Result: 1 FAIL', 'Result: 1 FAIL').replace('| FAIL | 1 failed |', '| PASS | 1 passed |')}
## Requirements
| Req | Verdict | Evidence |
|---|---|---|
| 1 | MET | rows 1 pass; \`app/export.py:12\` is called from main() |
| 2 | PARTIAL | quotes commas, not quotes inside a field |
| 3 | MET | README.md:40 |
`
  files['.tasks/export-csv/proof-final.md'] = FINAL
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/proof-final.md', content: FINAL })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^2\/3 met$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✗ 2  Commas are quoted  PARTIAL  quotes commas, not quotes inside a field$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✓ 1  export writes a CSV of every customer\.  rows 1 pass; app\/export\.py:12 is called from main\(\)$/ })).toBeDefined()
  await pane.unmount()
})

test('checks join eval.md with the latest proof', async ($, on) => {
  const files: Record<string, string> = repo('BUILDING')
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^3 not run yet$/ })).toBeDefined()
  await pane.unmount()

  files['.tasks/export-csv/proof-build.md'] = PROOF
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/proof-build.md', content: PROOF })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // A failed check opens Checks by itself, with a FAIL badge on its row.
  expect(await pane.find({ type: 'Text', text: /^4\/5 pass$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /proof-build.md at 1a2b3c4/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ FAIL $/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^quotes commas$/ })).toBeDefined()
  expect(await pane.findAll({ type: 'Text', text: /^ PASS $/ })).toHaveLength(4)
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^checks 4\/5$/ })).toBeDefined()
  await band.unmount()
})

test('a finished task with no proof file says so, shows the log, and hides stale Stop-hook blocks', async ($, on) => {
  const files: Record<string, string> = repo('AWAITING-HUMAN')
  files['.tasks/export-csv/state.md'] = state('AWAITING-HUMAN').replace('stop_blocks: 0', 'stop_blocks: 4')
    + '\n## Stage 7\nAll eval checks pass on 673fa13 (fast checks 117/117). Status set to AWAITING-HUMAN.\n'
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^no proof saved$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /proof-final.md is missing, so \/quorum:pr-draft will stop/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Round log: All eval checks pass on 673fa13/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /not run yet/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Stop hook blocked/ })).toBeUndefined()
  // The log says every check passed: requirements and checks are marked, muted, as reported.
  expect(await pane.find({ type: 'Text', text: /^3 reported passing$/ })).toBeDefined()
  await pane.press({ key: 'toggle-requirements' })
  expect(await pane.find({ type: 'Text', text: /^From the round log, not a saved proof$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✓ 2  Commas are quoted$/ })).toBeDefined()
  await pane.unmount()
})

test('a finished task shows its PR from GitHub, asking again only after the TTL or a gh pr command', async ($, on) => {
  const files: Record<string, string> = repo('AWAITING-HUMAN')
  files['.tasks/export-csv/pr.md'] = '## Summary\n'
  const seen = world(on, files)
  const calls: string[][] = []
  let answer = '[]'
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    return { value: { exitCode: 0, stdout: answer, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await settle()
  expect(calls[0]).toEqual(['gh', 'pr', 'list', '--head', 'feat/export-csv', '--state', 'all', '--limit', '1', '--json', 'number,state,isDraft,url'])
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /pr\.md drafted, PR not opened yet$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Push the branch and open the PR/ })).toBeDefined()
  await pane.unmount()

  // An ordinary refresh within the TTL doesn't ask again.
  await $.tool.call({ tool: 'Bash', command: 'quorum-state get status' })
  await settle()
  expect(calls.length).toBe(1)

  answer = '[{"number":33807,"state":"OPEN","isDraft":false,"url":"https://github.com/o/r/pull/33807"}]'
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "x" --body-file .tasks/export-csv/pr-body.md' })
  await settle()
  expect(calls.length).toBe(2)
  expect(seen.status).toEqual([undefined])
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The number is the link, and the state follows it as a word, so "open" can't be read as the link's label.
  const link = await pane.find({ type: 'Link' })
  expect(link?.props).toMatchObject({ href: 'https://github.com/o/r/pull/33807', label: 'PR #33807' })
  expect(await pane.find({ type: 'Text', text: /^open$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Get PR #33807 reviewed and merged$/ })).toBeDefined()
  await pane.press({ key: 'copy-pr' })
  expect(seen.copied).toEqual(['https://github.com/o/r/pull/33807'])
  await pane.unmount()

  answer = answer.replace('OPEN', 'MERGED')
  await $.tool.call({ tool: 'Bash', command: 'gh pr view 33807' })
  await settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Merged: every stage's dot is ticked.
  const dots = await band.findAll({ type: 'Text', text: /^[✓●○◆✗–]$/ })
  expect(dots.map(d => d.text).join('')).toBe('✓✓✓✓✓✓')
  await band.unmount()
})

test('a PR recorded in state.md is asked about by its URL, and shown even without gh', async ($, on) => {
  const files: Record<string, string> = repo('AWAITING-HUMAN')
  files['.tasks/export-csv/state.md'] = state('AWAITING-HUMAN', 'pr: https://github.com/o/r/pull/42\n')
  world(on, files)
  const calls: string[][] = []
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: 'gh: not logged in', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await settle()
  expect(calls[0]).toEqual(['gh', 'pr', 'view', 'https://github.com/o/r/pull/42', '--json', 'number,state,isDraft,url'])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Without gh the state is unknown: the linked number stands alone.
  expect((await pane.find({ type: 'Link' }))?.props).toMatchObject({ href: 'https://github.com/o/r/pull/42', label: 'PR #42' })
  expect(await pane.find({ type: 'Text', text: /^open$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^Get PR #42 reviewed and merged$/ })).toBeDefined()
  await pane.unmount()
})

test('without gh, a finished task still says pr.md is drafted, and never claims no PR exists', async ($, on) => {
  const files: Record<string, string> = repo('AWAITING-HUMAN')
  files['.tasks/export-csv/pr.md'] = '## Summary\n'
  world(on, files)
  on('process.run', () => { throw new Error('gh: command not found') })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /pr\.md drafted$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /not opened/ })).toBeUndefined()
  await pane.unmount()
})

test('a proof from before HEAD is flagged as possibly out of date', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  files['.tasks/export-csv/proof-build.md'] = PROOF
  files['.git/refs/heads/feat/export-csv'] = `1a2b3c4${'0'.repeat(33)}\n`
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^proof-build\.md at 1a2b3c4$/ })).toBeDefined()
  await pane.unmount()

  // A fix commit lands, packed this time.
  delete files['.git/refs/heads/feat/export-csv']
  files['.git/packed-refs'] = `${'9'.repeat(40)} refs/heads/feat/export-csv\n`
  await $.tool.call({ tool: 'Bash', command: 'quorum-state get round' })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^proof-build\.md ran at 1a2b3c4, before HEAD \(9999999\): these results may be out of date$/ })).toBeDefined()
  await pane.unmount()
})

test('the spec and blind-test stages show their own reports', async ($, on) => {
  const files: Record<string, string> = repo('DRAFT-AWAITING-VISUAL-SIGNOFF')
  files['.tasks/export-csv/spec-review/feasibility.md'] = 'Summary: 0 issues found. Ready to build.\n'
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /3 requirements in rd.md · 3 checks in eval.md/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✓ Feasibility critic\s+clean$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^○ Spec improver\s+waiting$/ })).toBeDefined()
  await pane.unmount()

  files['.tasks/export-csv/state.md'] = state('BLIND-TEST').replace('blind_runs: 0', 'blind_runs: 1')
  files['.tasks/export-csv/blind/blind-1.md'] = BLIND
  files['.tasks/export-csv/blind/triage-1.md'] = TRIAGE
  await $.tool.call({ tool: 'Bash', command: 'quorum-state set status BLIND-TEST' })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /Blind test, run 1/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /did not reach the goal · 1 blocker · 2 friction/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /1 item caused by this change/ })).toBeDefined()
  await pane.unmount()
})

test('a reload marks agents the engine no longer runs as finished', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'))
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.description }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const spawn = (description: string) => $.agent.spawn({ tool_use_id: description, prompt: 'fix', description, subagentType: 'quorum:builder', parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  await spawn('gone')
  await spawn('alive')
  seen.live = ['alive']

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^1 running · 1 done$/ })).toBeDefined()
  await pane.press({ key: 'toggle-agents' })
  const marks = await pane.findAll({ type: 'Text', text: /^[●✓] $/ })
  // The two builders, under Other agents, are drawn last.
  expect(marks.slice(-2).map(m => m.text)).toEqual(['✓ ', '● '])
  await pane.unmount()
})

describe('findings tree helpers', () => {
  // A round's survivors.md, from `[TAG] loc — Pattern Category: title` lines.
  const kept = (...lines: string[]) => `Summary: ${lines.length} kept\n\n${lines.map(l => `${l}\n`).join('')}`
  const imp = (loc: string, title = 'Unescaped CSV fields') => `[IMPORTANT] ${loc} — Pattern Category: ${title}`
  const nit = (loc: string, title = 'Naming') => `[NIT] ${loc} — Pattern Category: ${title}`
  const pre = (loc: string, title = 'Old debt') => `[PRE-EXISTING] ${loc} — Pattern Category: ${title}`
  const ELSEWHERE = nit('lib/z.py:5')
  const rounds = (...texts: string[]) => texts.map((t, i) => roundKept(i + 1, t, '', null))
  const runs = (ends: string[], ...texts: string[]) => texts.map((t, i) => roundKept(i + 1, t, '', ends[i] ?? null))
  const states = (v: FindingsView | null) => (v?.findings ?? []).map(f => `${f.state} ${f.path}:${f.line} r${f.round}${f.fixedBy === null ? '' : `>${f.fixedBy}`}`)
  // Width as the card draws it: code points, a Private Use Area icon as 2.
  const width = (text: string) => [...text].reduce((n, c) => n + (/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u.test(c) ? 2 : 1), 0)
  const rowText = (r: TreeRow) => r.parts.map(p => p.text).join('')
  const finding = (path: string, line: number | null, tag: TreeFinding['tag'], title: string, extra: Partial<TreeFinding> = {}): TreeFinding =>
    ({ path, line, tag, title, confidence: null, security: null, state: 'open', round: 1, fixedBy: null, ...extra })
  const view = (findings: TreeFinding[], extra: Partial<FindingsView> = {}): FindingsView => ({ unit: 'round', round: 1, kept: findings.length, dropped: 0, findings, ...extra })
  const opts = (extra: Partial<Parameters<typeof treeRows>[1]> = {}) => ({ scope: 's', width: 46, icons: false, isHigh: false, folds: {}, ...extra })

  test('repoPath joins ./, roots at a boundary, longest first, and backslashes', () => {
    const roots = ['/repo', '/repo/.claude/worktrees/export-csv', 'C:/repo']
    for (const loc of ['./app/x.py', 'app/x.py', '/repo/app/x.py', '/repo/.claude/worktrees/export-csv/app/x.py', 'C:\\repo\\app\\x.py']) {
      expect(repoPath(loc, roots)).toBe('app/x.py')
    }
    expect(repoPath('/repo2/app/x.py', roots)).toBe('/repo2/app/x.py')
    // Longest first: /repo never eats the worktree's own prefix.
    expect(repoPath('/repo/.claude/worktrees/s/app/x.py', ['/repo', '/repo/.claude/worktrees/s'])).toBe('app/x.py')
    // A backslash root, a trailing slash, and an empty root.
    expect(repoPath('D:\\work\\src\\a.ts', ['D:\\work\\', ''])).toBe('src/a.ts')
    expect(splitLoc('C:/repo/app/x.py:13')).toEqual({ path: 'C:/repo/app/x.py', line: 13 })
    expect(splitLoc('')).toEqual({ path: '', line: null })
    expect(disputeDrops('DROP [IMPORTANT] ./app/x.py:3 — (b) handled\nDROP [NIT] a.py:1 — style\nKEEP [IMPORTANT] b.py:2 — real\n')).toEqual(['./app/x.py:3'])
    const log = `---\nrange: a..f\n---\n## Run 1 (a..b, MEDIUM)\n## Run 2 (a..c, HIGH)\n`
    expect(runEnds(log, 3, 'a..d')).toEqual({ 1: 'b', 2: 'c', 3: 'd' })
    expect(runEnds(log, 2, 'a..d')).toEqual({ 1: 'b', 2: 'c' })
  })

  test('trackFindings pairs by path and category at any severity, nearest line first', () => {
    expect(trackFindings([], [], 'round')).toBeNull()
    // The line moved: still open, at its new line.
    expect(states(trackFindings(rounds(kept(imp('app/x.py:3')), kept(imp('app/x.py:6'))), [], 'round'))).toEqual(['open app/x.py:6 r2'])
    // The severity changed: open at the new severity, never fixed.
    const nitNow = trackFindings(rounds(kept(imp('app/x.py:3')), kept(nit('app/x.py:3', 'unescaped  CSV Fields'))), [], 'round')
    expect(states(nitNow)).toEqual(['open app/x.py:3 r2'])
    expect(nitNow?.findings[0]?.tag).toBe('NIT')
    // Two kept, one left: the kept one pairs with the nearest line, so :3 is the fixed one.
    expect(states(trackFindings(rounds(kept(imp('app/x.py:3'), imp('app/x.py:9')), kept(imp('app/x.py:8'))), [], 'round')))
      .toEqual(['fixed app/x.py:3 r1>2', 'open app/x.py:8 r2'])
    // Another path, or another category, is another finding.
    expect(states(trackFindings(rounds(kept(imp('app/x.py:3')), kept(imp('app/y.py:3'), imp('app/x.py:3', 'Other'))), [], 'round')))
      .toEqual(['fixed app/x.py:3 r1>2', 'open app/x.py:3 r2', 'open app/y.py:3 r2'])
  })

  test('trackFindings decides fixed and dropped against the round on show', () => {
    // Kept in rounds 1 and 3 but not 2: it came back, so it's open.
    expect(states(trackFindings(rounds(kept(imp('app/x.py:3')), kept(ELSEWHERE), kept(imp('app/x.py:3'), ELSEWHERE)), [], 'round')))
      .toEqual(['open app/x.py:3 r3', 'open lib/z.py:5 r3'])
    // IMPORTANT in rounds 1 and 2, gone in 3.
    expect(states(trackFindings(rounds(kept(imp('app/x.py:3')), kept(imp('app/x.py:3')), kept(ELSEWHERE)), [], 'round')))
      .toEqual(['fixed app/x.py:3 r2>3', 'open lib/z.py:5 r3'])
    // IMPORTANT in round 1, a NIT in round 2, gone in 3: the round is the last that kept it as IMPORTANT.
    const demoted = trackFindings(rounds(kept(imp('app/x.py:3')), kept(nit('app/x.py:3', 'Unescaped CSV fields')), kept(ELSEWHERE)), [], 'round')
    expect(states(demoted)).toEqual(['fixed app/x.py:3 r1>3', 'open lib/z.py:5 r3'])
    expect(demoted?.findings[0]?.tag).toBe('IMPORTANT')
    // Fixed by round 2, shown under round 3: fixedBy is the round after the last that kept it.
    expect(states(trackFindings(rounds(kept(imp('app/x.py:3'), ELSEWHERE), kept(ELSEWHERE), kept(ELSEWHERE)), [], 'round')))
      .toEqual(['fixed app/x.py:3 r1>2', 'open lib/z.py:5 r3'])
    // A NIT that goes away is let go.
    expect(states(trackFindings(rounds(kept(nit('app/x.py:3')), kept(ELSEWHERE)), [], 'round'))).toEqual(['open lib/z.py:5 r2'])
    // The round on show kept nothing: only the fixed findings stay.
    const none = trackFindings(rounds(kept(imp('app/x.py:3'), ELSEWHERE), 'Summary: 0 issues found. Ready to land.\n'), [], 'round')
    expect(states(none)).toEqual(['fixed app/x.py:3 r1>2'])
    expect(none?.kept).toBe(0)
    expect(none?.round).toBe(2)

    // Runs: a fix counts only across runs over a different range end.
    expect(states(trackFindings(runs(['b', 'b', 'c'], kept(imp('app/x.py:3'), ELSEWHERE), kept(ELSEWHERE), kept(ELSEWHERE)), [], 'run')))
      .toEqual(['fixed app/x.py:3 r1>3', 'open lib/z.py:5 r3'])
    expect(states(trackFindings(runs(['b', 'c', 'c'], kept(imp('app/x.py:3'), ELSEWHERE), kept(ELSEWHERE), kept(ELSEWHERE)), [], 'run')))
      .toEqual(['fixed app/x.py:3 r1>2', 'open lib/z.py:5 r3'])
    expect(states(trackFindings(runs(['b', 'c', 'd'], kept(imp('app/x.py:3'), ELSEWHERE), kept(ELSEWHERE), kept(ELSEWHERE)), [], 'run')))
      .toEqual(['fixed app/x.py:3 r1>2', 'open lib/z.py:5 r3'])
    // Last kept by run 2, over the same end as run 3: the same code, so it's let go.
    expect(states(trackFindings(runs(['b', 'c', 'c'], kept(imp('app/x.py:3'), ELSEWHERE), kept(imp('app/x.py:3'), ELSEWHERE), kept(ELSEWHERE)), [], 'run')))
      .toEqual(['open lib/z.py:5 r3'])
    // A short SHA and its full form are the same end.
    expect(states(trackFindings(runs(['1a2b3c4', '1a2b3c4'.padEnd(40, '0')], kept(imp('app/x.py:3'), ELSEWHERE), kept(ELSEWHERE)), [], 'run')))
      .toEqual(['open lib/z.py:5 r2'])
    expect(trackFindings(runs(['b', 'c'], kept(imp('app/x.py:3')), kept(ELSEWHERE)), [], 'run')?.unit).toBe('run')

    // A drop in an earlier round, written another way, joins its finding: dropped, not fixed.
    const earlier = trackFindings([roundKept(1, kept(imp('app/x.py:3')), 'DROP [IMPORTANT] /repo/app/x.py:3 — (b) handled', null), roundKept(2, kept(ELSEWHERE), '', null)], ['/repo'], 'round')
    expect(states(earlier)).toEqual(['dropped app/x.py:3 r1', 'open lib/z.py:5 r2'])
    expect(earlier?.dropped).toBe(0)
    // A drop in the round on show wins over open, and the view counts it.
    const own = trackFindings([roundKept(1, kept(imp('app/x.py:3'), ELSEWHERE), 'DROP [IMPORTANT] ./app/x.py:3 — (b) handled\n', null)], ['/repo'], 'round')
    expect(states(own)).toEqual(['dropped app/x.py:3 r1', 'open lib/z.py:5 r1'])
    expect(own?.dropped).toBe(1)
    expect(own?.kept).toBe(2)
  })

  test('treeRows merges single-child folders, splits where they branch, sorts, rolls up, and cuts to width', () => {
    const v = view([
      finding('z.ts', 1, 'PRE-EXISTING', 'Old debt'),
      finding('a/b/d/y.ts', 2, 'NIT', 'Naming'),
      finding('a/b/c/x.ts', 3, 'IMPORTANT', 'Unescaped CSV fields'),
      finding('b.ts', 4, 'NIT', 'Spacing'),
    ])
    const rows = treeRows(v, opts())
    expect(rows.filter(r => r.kind !== 'finding').map(r => r.key)).toEqual(['s:tree:a/b/', 's:tree:a/b/c/', 's:tree:a/b/c/x.ts', 's:tree:a/b/d/', 's:tree:a/b/d/y.ts', 's:tree:b.ts', 's:tree:z.ts'])
    expect(rows.some(r => r.key === 's:tree:a/')).toBe(false)
    // Files with open findings start open; findings start folded.
    expect(rows.filter(r => r.kind === 'finding').map(r => r.key)).toEqual(['s:tree:a/b/c/x.ts:3#0', 's:tree:a/b/d/y.ts:2#0', 's:tree:b.ts:4#0', 's:tree:z.ts:1#0'])
    const top = rows[0]
    expect(top?.label).toBe('a/b/ folder, 2 files, 1 important, 1 nit, open')
    // Every row is the card's width, with the counts in right-aligned mark columns.
    expect(rowText(top as TreeRow)).toMatch(/^▾ a\/b\/ +2 files  ✗1  n1    $/)
    expect(rowText(rows.find(r => r.key === 's:tree:z.ts') as TreeRow)).toMatch(/ {8}p1$/)
    for (const r of rows.filter(r => r.kind !== 'finding')) expect(width(rowText(r))).toBe(46)
    expect(rowText(rows.find(r => r.key === 's:tree:a/b/c/x.ts:3#0') as TreeRow)).toBe('        ✗ :3 Unescaped CSV fields')
    expect(rows.find(r => r.key === 's:tree:a/b/c/x.ts:3#0')?.label).toBe('important at a/b/c/x.ts:3: Unescaped CSV fields, folded')

    // A fold wins over the default; folding never moves a column.
    const folded = treeRows(v, opts({ folds: { 's:tree:a/b/': false } }))
    expect(folded.map(r => r.key)[0]).toBe('s:tree:a/b/')
    expect(folded[0]?.label).toEndWith(', folded')
    expect(folded.some(r => r.key.startsWith('s:tree:a/b/c'))).toBe(false)
    expect(rowText(folded[0] as TreeRow)).toMatch(/^▸ a\/b\/ +2 files  ✗1  n1    $/)

    // Fixed and dropped rows, a file whose only finding is fixed starting folded, and the `other` row last.
    const marks = view([
      finding('app/x.py', 3, 'IMPORTANT', 'Unescaped CSV fields', { state: 'fixed', round: 1, fixedBy: 2 }),
      finding('app/y.py', 9, 'IMPORTANT', 'Wrong env var', { state: 'dropped' }),
      finding('', null, 'NIT', 'Summary wording'),
    ], { round: 2 })
    const m = treeRows(marks, opts({ folds: { 's:tree:app/x.py:3#0': true } }))
    expect(m.map(r => r.key)).toEqual(['s:tree:app/', 's:tree:app/x.py', 's:tree:app/y.py', 's:tree:app/y.py:9#0', 's:tree::other', 's:tree::other:#0'])
    expect(m[1]?.label).toBe('app/x.py, 1 fixed, folded')
    expect(rowText(m[1] as TreeRow)).toMatch(/^ {2}▸ x\.py +✓1 {4}$/)
    expect(rowText(m[3] as TreeRow)).toBe('      · :9 dropped on dispute in round 1')
    expect(m[3]?.parts.every(p => p.dim)).toBe(true)
    expect(rowText(m[5] as TreeRow)).toBe('    n (no location) Summary wording')
    expect(m[5]?.copy).toBeNull()
    // On a HIGH task the fixed one's file opens.
    const high = treeRows(marks, opts({ isHigh: true }))
    expect(rowText(high.find(r => r.key === 's:tree:app/x.py:3#0') as TreeRow)).toBe('      ✓ :3 round 1 → fixed by round 2')

    // Cuts: a 70-character name keeps its extension, a long chain its first and last folder, a long title ends in …
    const long = `${'n'.repeat(67)}.ts`
    const chain = `${['first', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'].join('/')}/last`
    const title = 'A very long Pattern Category that cannot possibly fit on a single row of the docked pane at all'
    const cut = view([finding(`${chain}/${long}`, 12, 'IMPORTANT', title, { confidence: 92 }), finding(`${chain}/b.ts`, 1, 'NIT', 'x')])
    for (const icons of [false, true]) {
      const open = treeRows(cut, opts({ icons, folds: { [`s:tree:${chain}/${long}:12#0`]: true } }))
      const f = open.find(r => r.kind === 'finding' && r.isOpen) as TreeRow
      expect(f.copy).toBe(`${chain}/${long}:12`)
      expect(f.confidence).toBe(92)
      expect(f.more.length).toBeGreaterThan(0)
      expect([rowText(f).trimStart().replace(/^✗ :12 /, ''), ...f.more.map(l => l.trim())].join(' ')).toBe(title)
      const lines = [...open.map(rowText), ...f.more, confidenceRow(f, 46).map(p => p.text).join('')]
      for (const l of lines) expect(width(l)).toBeLessThanOrEqual(46)
      expect(confidenceRow(f, 46).map(p => p.text).join('')).toMatch(/confidence 92 +copy path$/)
      const file = open.find(r => r.kind === 'file' && r.copy === null && r.key.endsWith(long)) as TreeRow
      expect(rowText(file)).toMatch(/…n+\.ts +✗1 {4}$/)
      expect(rowText(open[0] as TreeRow)).toMatch(/^▾ (\S+ )?first\/…\/last\/ /)
      for (const r of open) expect(r.label).toMatch(/, (open|folded)$/)
      const closed = treeRows(cut, opts({ icons })).find(r => r.kind === 'finding' && r.key.includes(long)) as TreeRow
      expect(rowText(closed)).toEndWith('…')
      expect(width(rowText(closed))).toBeLessThanOrEqual(46)
    }
    // Icons: the type's glyph and colour, the test tube for tests, and the open folder.
    const iconRows = treeRows(view([finding('src/a.ts', 1, 'NIT', 'x'), finding('src/a.test.ts', 1, 'NIT', 'x'), finding('README.md', 1, 'NIT', 'x')]), opts({ icons: true }))
    expect(iconRows[0]?.parts.find(p => p.text === '\uE5FE')?.color).toBe('#8b8b8b')
    expect(iconRows.find(r => r.key === 's:tree:src/a.ts')?.parts.find(p => p.text === '\uE628')?.color).toBe('#519aba')
    expect(iconRows.find(r => r.key === 's:tree:src/a.test.ts')?.parts.find(p => p.text === '\u{F0668}')?.color).toBe('#519aba')
    expect(iconRows.find(r => r.key === 's:tree:README.md')?.parts.some(p => p.text === '\u{F0219}')).toBe(true)
    expect(iconRows.some(r => r.parts.some(p => p.text.includes('\uE609')))).toBe(false)
    expect(iconsOn('nerd', 'terminal')).toBe(true)
    expect(iconsOn('nerd', 'vscode')).toBe(false)
    expect(iconsOn('off', 'terminal')).toBe(false)
    expect(iconsOn('yes', 'terminal')).toBe(false)
    expect(cellWidth('a\uE628\u{F0668}')).toBe(5)
    // A cut keeps whole characters.
    expect(cutEnd('naïve😀😀😀', 7)).toBe('naïve😀…')
    expect(cutMiddle(`${'😀'.repeat(20)}.md`, 10)).toBe('😀😀😀…😀😀😀.md')
    expect(cutChain('a/b/c/d/', 6)).toBe('a/…/d/')
  })

  test('treeHeader wraps the key and keeps the header when nothing is kept', () => {
    expect(treeHeader(null, 46)).toBeNull()
    expect(treeHeader(view([], { kept: 0 }), 46)).toEqual({ header: 'the verifier kept nothing in round 1', key: [] })
    const text = (k: { text: string }[][]) => k.map(l => l.map(p => p.text).join(''))
    const two = treeHeader(view([finding('src/a.ts', 1, 'IMPORTANT', 'x'), finding('src/b.ts', 2, 'NIT', 'y')], { round: 3, unit: 'run' }), 46)
    expect(two?.header).toBe('the verifier kept these in run 3')
    expect(text(two?.key ?? [])).toEqual(['key: ✗ important  n nit'])
    const all = treeHeader(view([
      finding('a.ts', 1, 'IMPORTANT', 'x'), finding('b.ts', 1, 'IMPORTANT', 'x', { state: 'fixed', fixedBy: 2 }),
      finding('c.ts', 1, 'NIT', 'x'), finding('d.ts', 1, 'PRE-EXISTING', 'x'),
    ]), 46)
    expect(text(all?.key ?? [])).toEqual(['key: ✗ important  ✓ fixed this run  n nit', '     p pre-existing'])
    for (const l of text(all?.key ?? [])) expect(width(l)).toBeLessThanOrEqual(46)
    // Nothing kept, but an earlier fix: the header says so, and the key names only ✓.
    expect(treeHeader(view([finding('a.ts', 1, 'IMPORTANT', 'x', { state: 'fixed', fixedBy: 2 })], { kept: 0, round: 2 }), 46))
      .toEqual({ header: 'the verifier kept nothing in round 2', key: [[{ text: 'key: ', dim: true }, { text: '✓', color: 'success' }, { text: ' fixed this run', dim: true }]] })
  })

  // A files.tsv row, and the change the tree joins: step 1 built unless the test says otherwise.
  const changed = (path: string, letter: ChangedFile['letter'], added: ChangedFile['added'], removed: ChangedFile['removed'], steps: number[], extra: Partial<ChangedFile> = {}): ChangedFile =>
    ({ letter, added, removed, path, oldPath: '', steps, fix: null, ...extra })
  const change = (files: ChangedFile[], extra: Partial<TreeChange> = {}): TreeChange => ({ files, hasPlan: true, built: [1], allBuilt: false, rereview: [], ...extra })
  const keyText = (k: { text: string }[][]) => k.map(l => l.map(p => p.text).join(''))

  test('treeRows joins the recorded change with lead columns, counts, steps, unplanned, and ↻', () => {
    const files = [
      changed('src/a.ts', 'M', 86, 3, [1]),
      changed('src/b.ts', 'A', 12, 0, [2]),
      changed('src/c.ts', 'A', null, null, [2]),
      changed('src/d.ts', 'M', 1, 1, []),
      changed('src/logo.png', 'M', 'bin', 'bin', [1]),
      changed('src/two.ts', 'M', 5, 0, [1, 2]),
      changed('new.ts', 'R', 2, 2, [1], { oldPath: 'old.ts' }),
    ]
    const row = (rows: TreeRow[], path: string) => rows.find(r => r.key === `s:tree:${path}`) as TreeRow
    // Build: no findings view, so no mark block.
    const build = treeRows(null, opts({ change: change(files) }))
    expect(build.map(r => r.key)).toEqual(['s:tree:src/', ...['a.ts', 'b.ts', 'c.ts', 'd.ts', 'logo.png', 'two.ts'].map(n => `s:tree:src/${n}`), 's:tree:new.ts'])
    for (const r of build) expect(width(rowText(r))).toBe(46)
    expect(rowText(row(build, 'src/'))).toMatch(/^ {4}▾ src\/ +6 files {3}$/)
    expect(row(build, 'src/').label).toBe('src/ folder, 6 files, open')
    expect(rowText(row(build, 'src/a.ts'))).toMatch(/^✓ M {5}a\.ts + \+86 −3 s1$/)
    expect(rowText(row(build, 'src/b.ts'))).toMatch(/^○ A {5}b\.ts + {3}\+12 s2$/)
    expect(rowText(row(build, 'src/c.ts'))).toMatch(/^○ A {5}c\.ts + {8}s2$/)
    expect(rowText(row(build, 'src/d.ts'))).toMatch(/^\* M {5}d\.ts +unplanned {3}\+1 −1 {3}$/)
    expect(rowText(row(build, 'src/logo.png'))).toMatch(/ {5}bin s1$/)
    // Steps 1 and 2 name it, and only step 1 is built.
    expect(rowText(row(build, 'src/two.ts'))).toMatch(/^○ M /)
    // Colours: ✓ success, ○ * and the unplanned word dim, the letter dim only while planned, +N success, −N error.
    const part = (r: TreeRow, text: string) => r.parts.find(p => p.text === text)
    expect(part(row(build, 'src/a.ts'), '✓')?.color).toBe('success')
    expect(part(row(build, 'src/a.ts'), 'M')?.dim).toBeUndefined()
    expect(part(row(build, 'src/a.ts'), '+86')?.color).toBe('success')
    expect(part(row(build, 'src/a.ts'), '−3')?.color).toBe('error')
    expect(part(row(build, 'src/b.ts'), '○')?.dim).toBe(true)
    expect(part(row(build, 'src/c.ts'), 'A')?.dim).toBe(true)
    expect(part(row(build, 'src/d.ts'), '*')?.dim).toBe(true)
    expect(part(row(build, 'src/d.ts'), 'unplanned')?.dim).toBe(true)
    // A file row with no findings has nothing to fold: no ▸, even folded, and no state word.
    const folded = treeRows(null, opts({ change: change(files), folds: { 's:tree:src/a.ts': false } }))
    for (const r of folded.filter(r => r.kind === 'file')) expect(rowText(r)).not.toContain('▸')
    expect(row(build, 'src/a.ts').label).toBe('src/a.ts, step 1 built, modified, 86 lines added, 3 removed')
    expect(row(build, 'src/b.ts').label).toBe('src/b.ts, step 2 not built yet, added, 12 lines added')
    expect(row(build, 'src/c.ts').label).toBe('src/c.ts, step 2 not built yet, added, not changed yet')
    expect(row(build, 'src/d.ts').label).toBe('src/d.ts, unplanned, modified, 1 line added, 1 removed')
    expect(row(build, 'src/logo.png').label).toBe('src/logo.png, step 1 built, modified, binary')
    expect(row(build, 'src/two.ts').label).toBe('src/two.ts, step 1 built, step 2 not built yet, modified, 5 lines added')
    expect(row(build, 'new.ts').label).toBe('new.ts, step 1 built, renamed from old.ts, 2 lines added, 2 removed')
    // An unsliced build with its proof: every planned file is built. With no plan the progress column is gone.
    const unsliced = treeRows(null, opts({ change: change(files, { built: [], allBuilt: true }) }))
    expect(rowText(row(unsliced, 'src/b.ts'))).toMatch(/^✓ A /)
    // A planned file its built step hasn't changed yet stays ○, sliced or not: ✓ needs the change too.
    for (const rows of [unsliced, treeRows(null, opts({ change: change(files, { built: [1, 2] }) }))]) {
      expect(rowText(row(rows, 'src/c.ts'))).toMatch(/^○ A /)
      expect(part(row(rows, 'src/c.ts'), '○')?.dim).toBe(true)
      expect(row(rows, 'src/c.ts').label).toBe('src/c.ts, step 2 built, not changed yet, added')
    }
    const noPlan = treeRows(null, opts({ change: change(files.map(f => ({ ...f, steps: [] })), { hasPlan: false }) }))
    expect(rowText(row(noPlan, 'src/a.ts'))).toMatch(/^M {5}a\.ts + \+86 −3 {3}$/)
    expect(row(noPlan, 'src/d.ts').label).toBe('src/d.ts, modified, 1 line added, 1 removed')
    // The headers, and the lead key: only the marks shown.
    expect(changeHeader('build', change(files), 2)).toBe('5 of 6 planned files changed · 1 unplanned')
    expect(changeHeader('build', change(files.slice(0, 1)), 2)).toBe('1 of 1 planned file changed')
    expect(changeHeader('build', change(files, { hasPlan: false }), 0)).toBe('6 files changed')
    const planned = [changed('app/report.py', 'M', null, null, [1]), changed('app/util.py', 'A', null, null, [2]), changed('README.md', 'M', null, null, [4])]
    expect(changeHeader('plan', change(planned), 4)).toBe('4 steps · 3 files, 1 new')
    const plan = treeRows(null, opts({ change: change(planned, { built: [] }) }))
    for (const r of plan.filter(r => r.kind === 'file')) expect(r.parts.find(p => /^[MA]$/.test(p.text))?.dim).toBe(true)
    expect(treeHeader(null, 46, change(files))).toEqual({ header: '', key: [[
      { text: 'key: ', dim: true }, { text: '✓', color: 'success' }, { text: ' built', dim: true }, { text: '  ' },
      { text: '○', dim: true }, { text: ' not yet', dim: true }, { text: '  ' }, { text: '*', dim: true }, { text: ' unplanned', dim: true },
    ]] })
    expect(keyText(treeHeader(null, 46, change(planned, { built: [] }))?.key ?? [])).toEqual(['key: ○ not yet'])
    expect(treeHeader(null, 46, change(files, { hasPlan: false }))).toEqual({ header: '', key: [] })

    // Review: a kept IMPORTANT on a file the fix changed is ↻, beside a fixed one and a nit, each its own term.
    const findings = [
      finding('src/a.ts', 41, 'IMPORTANT', 'Ignored argument'),
      finding('src/a.ts', 9, 'IMPORTANT', 'Header row twice', { state: 'fixed', fixedBy: 2 }),
      finding('src/d.ts', 7, 'NIT', 'Magic number'),
    ]
    const v = view(findings, { kept: 2 })
    const review = treeRows(v, opts({ change: change(files, { rereview: ['src/a.ts'] }) }))
    for (const r of review.filter(r => r.kind !== 'finding')) expect(width(rowText(r))).toBe(46)
    expect(rowText(row(review, 'src/a.ts'))).toMatch(/^✓ M {5}a\.ts + \+86 −3 s1  ↻1  ✓1 {4}$/)
    expect(part(row(review, 'src/a.ts'), '↻1')?.color).toBe('warning')
    expect(row(review, 'src/a.ts').label).toBe('src/a.ts, step 1 built, modified, 86 lines added, 3 removed, 1 awaiting re-review, 1 fixed, open')
    expect(row(review, 'src/a.ts').label).not.toContain('fixed, awaiting')
    expect(row(review, 'src/').label).toBe('src/ folder, 6 files, 1 awaiting re-review, 1 fixed, 1 nit, open')
    const awaiting = row(review, 'src/a.ts:41#0')
    expect(rowText(awaiting)).toBe(`${' '.repeat(10)}↻ :41 Ignored argument`)
    expect(awaiting.parts.find(p => p.text === '↻')?.color).toBe('warning')
    expect(awaiting.label).toBe('important at src/a.ts:41: Ignored argument, awaiting re-review, folded')
    // A file with no findings in the review still has no state word.
    expect(row(review, 'src/b.ts').label).toBe('src/b.ts, step 2 not built yet, added, 12 lines added')
    expect(keyText(treeHeader(v, 46, change(files, { rereview: ['src/a.ts'] }))?.key ?? []))
      .toEqual(['key: ↻ awaiting re-review  ✓ fixed this run', '     n nit', 'key: ✓ built  ○ not yet  * unplanned'])
    // Not changed since the round: ✗, as today.
    expect(rowText(row(treeRows(v, opts({ change: change(files) })), 'src/a.ts'))).toMatch(/✗1  ✓1 {4}$/)
    expect(awaitingOf(v, ['src/a.ts'])).toBe(1)
    expect(awaitingOf(v, [])).toBe(0)
    expect(awaitingOf(null, ['src/a.ts'])).toBe(0)
    const reply = '[IMPORTANT] /repo/src/a.ts:40 — Pattern Category: ignored  Argument\n[IMPORTANT] src/d.ts:7 — Pattern Category: Magic number\n[NIT] src/a.ts:41 — Pattern Category: Ignored argument\n'
    expect(awaitingFrom(reply, v, ['src/a.ts'], ['/repo'])).toBe(1)
    expect(awaitingFrom(reply, v, [], ['/repo'])).toBe(0)
    // A finding on a file the list doesn't hold keeps blank lead columns.
    const elsewhere = treeRows(view([finding('lib/z.py', 5, 'NIT', 'x')]), opts({ change: change(files) }))
    expect(rowText(row(elsewhere, 'lib/z.py'))).toMatch(/^ {8}z\.py +n1$/)

    // Past 15 files, clean folders start folded; a folder with an open or ↻ finding, or an unplanned file, stays open.
    const many = (n: number) => [
      ...Array.from({ length: n }, (_, i) => changed(`clean/f${String(i).padStart(2, '0')}.ts`, 'M', 1, 0, [1])),
      changed('bad/x.ts', 'M', 1, 0, [1]), changed('odd/u.ts', 'M', 1, 0, []), changed('fix/r.ts', 'M', 1, 0, [1]),
    ]
    const v2 = view([finding('bad/x.ts', 1, 'NIT', 'x'), finding('fix/r.ts', 2, 'IMPORTANT', 'y')])
    const big = change(many(13), { rereview: ['fix/r.ts'] })
    expect(isBigTree(v2, big)).toBe(true)
    expect(isBigTree(v2, change(many(12)))).toBe(false)
    expect(isBigTree(v2, null)).toBe(false)
    const bigRows = treeRows(v2, opts({ change: big }))
    expect(['bad/', 'clean/', 'fix/', 'odd/'].map(p => row(bigRows, p).isOpen)).toEqual([true, false, true, true])
    expect(bigRows.some(r => r.key.startsWith('s:tree:clean/f'))).toBe(false)
    expect(treeRows(v2, opts({ change: big, folds: { 's:tree:clean/': true } })).some(r => r.key === 's:tree:clean/f00.ts')).toBe(true)
    expect(treeRows(v2, opts({ change: change(many(12), { rereview: ['fix/r.ts'] }) })).filter(r => r.kind === 'folder').every(r => r.isOpen)).toBe(true)
  })

  test("the change's columns give way in order: name, unplanned, step, then counts", () => {
    const files = [changed('src/a-really-long-file-name.ts', 'M', 12345, 6789, []), changed('src/b.ts', 'M', 1, 0, [12])]
    const v = view([finding('src/b.ts', 1, 'NIT', 'x')])
    const at = (w: number) => treeRows(v, opts({ width: w, change: change(files) }))
    const text = (rows: TreeRow[], path: string) => rowText(rows.find(r => r.key === `s:tree:${path}`) as TreeRow)
    const long = 'src/a-really-long-file-name.ts'
    // 60: the name is cut first, and everything else shows.
    const wide = at(60)
    expect(text(wide, long)).toMatch(/^\* M {5}a-r\S*…\S*\.ts unplanned \+12345 −6789 {12}$/)
    expect(text(wide, 'src/b.ts')).toMatch(/ s12 {6}n1$/)
    // 46: the unplanned word goes; the * and the label keep it.
    const no = at(46)
    expect(text(no, long)).not.toContain('unplanned')
    expect(text(no, long)).toMatch(/^\* M /)
    expect(no.find(r => r.key === `s:tree:${long}`)?.label).toContain('unplanned')
    expect(text(no, 'src/b.ts')).toMatch(/ s12 {6}n1$/)
    // 36: the step column goes.
    const noStep = at(36)
    expect(text(noStep, 'src/b.ts')).not.toContain('s12')
    expect(text(noStep, 'src/b.ts')).toMatch(/\+1 {6}n1$/)
    expect(text(noStep, 'src/')).toContain('2 files')
    // 30: the line counts go, and the folder's file count with them.
    const noCounts = at(30)
    expect(text(noCounts, long)).not.toContain('+12345')
    expect(text(noCounts, 'src/')).not.toContain('files')
    expect(text(noCounts, 'src/b.ts')).toMatch(/b\.ts +n1$/)
    for (const [w, rows] of [[60, wide], [46, no], [36, noStep], [30, noCounts]] as const) {
      for (const r of rows.filter(r => r.kind !== 'finding')) expect(width(rowText(r))).toBe(w)
      // The name keeps at least 4 columns.
      expect(text(rows, long).slice(8).replace(/ .*$/, '').length).toBeGreaterThanOrEqual(4)
    }
  })

  test("footprint names the latest voted round's severities, not reviewed yet, and as of", () => {
    const head = `abc1234${'0'.repeat(33)}`
    const list = (files: ChangedFile[], extra: Partial<FileList> = {}): FileList => ({ head, base: 'f'.repeat(40), since: '', recorded: 1763300000, files, ...extra })
    const files = [changed('a.ts', 'M', 86, 3, [1]), changed('b.ts', 'A', 12, 0, [2]), changed('c.png', 'M', 'bin', 'bin', []), changed('d.ts', 'M', null, null, [3])]
    const items = (fp: ReturnType<typeof footprint>) => fp?.parts.map(item => item.map(p => p.text).join(''))
    const fresh = footprint(list(files), [], head)
    // The planned-only d.ts isn't counted, and bin adds no lines.
    expect(fresh?.files).toBe(3)
    expect(items(fresh)).toEqual(['3 files', '+98 −3', 'not reviewed yet'])
    expect(fresh?.words).toEqual(['3 files', '98 lines added, 3 removed', 'not reviewed yet'])
    expect(fresh?.parts[1]?.find(p => p.text === '+98')?.color).toBe('success')
    expect(fresh?.parts[1]?.find(p => p.text === '−3')?.color).toBe('error')
    expect(fresh?.parts[2]?.[0]?.dim).toBe(true)
    // The latest voted round, not a later one still reviewing.
    const voted = footprint(list(files), [{ n: 1, findings: { important: 1, nit: 2, preExisting: 1 }, candidates: 4 }, { n: 2, findings: null, candidates: null }], head)
    expect(items(voted)).toEqual(['3 files', '+98 −3', '1 important', '2 nits', '1 pre'])
    expect(voted?.words).toEqual(['3 files', '98 lines added, 3 removed', '1 important', '2 nits', '1 pre-existing'])
    expect(voted?.parts[2]?.[0]?.color).toBe('error')
    expect(voted?.parts[3]?.[0]?.dim).toBe(true)
    const clean = footprint(list(files), [{ n: 1, findings: { important: 1, nit: 0, preExisting: 0 }, candidates: 1 }, { n: 2, findings: { important: 0, nit: 0, preExisting: 0 }, candidates: 0 }], head)
    expect(items(clean)?.at(-1)).toBe('no findings')
    // A kept IMPORTANT awaiting re-review is counted as that, as the tree and key count it, not as important.
    const rounds1 = [{ n: 1, findings: { important: 2, nit: 1, preExisting: 0 }, candidates: 3 }]
    const awaits = footprint(list(files), rounds1, head, 1)
    expect(items(awaits)).toEqual(['3 files', '+98 −3', '1 important', '1 awaiting re-review', '1 nit'])
    expect(awaits?.words).toEqual(['3 files', '98 lines added, 3 removed', '1 important', '1 awaiting re-review', '1 nit'])
    expect(awaits?.parts[3]?.[0]?.color).toBe('warning')
    expect(items(footprint(list(files), rounds1, head, 2))).toEqual(['3 files', '+98 −3', '2 awaiting re-review', '1 nit'])
    expect(clean?.parts.at(-1)?.[0]?.color).toBe('success')
    // An old list says when it was recorded.
    const old = footprint(list(files), [], `def5678${'0'.repeat(33)}`)
    expect(items(old)?.at(-1)).toBe('as of abc1234')
    expect(old?.parts.at(-1)?.[0]?.dim).toBe(true)
    expect(old?.words.at(-1)).toBe('as of abc1234')
    // Only planned rows: no files and no lines yet. Before the build (base '-'), no footprint.
    expect(items(footprint(list([files[3] as ChangedFile]), [], head))).toEqual(['0 files', 'not reviewed yet'])
    expect(footprint(list(files, { base: '' }), [], head)).toBeNull()
    expect(items(footprint(list([changed('x.ts', 'D', 0, 7, [1])]), [], head))).toEqual(['1 file', '−7', 'not reviewed yet'])
  })

  test('keptFindings keeps a finding with no location', () => {
    expect(keptFindings('[NIT] Summary wording\n[IMPORTANT] app/x.py:3 — Pattern Category: Real\n')).toEqual([
      { tag: 'NIT', loc: '', title: 'Summary wording', confidence: null, security: null },
      { tag: 'IMPORTANT', loc: 'app/x.py:3', title: 'Real', confidence: null, security: null },
    ])
    expect(keptFindings('[NIT] Summary wording\n').length).toBe(countFindings('[NIT] Summary wording\n').nit)
  })

  test('markWords spells out the counts', () => {
    expect(markWords({ important: 1, nit: 1, preExisting: 0 })).toBe('1 important, 1 nit')
    expect(markWords({ important: 0, nit: 2, preExisting: 1 })).toBe('2 nits, 1 pre-existing')
    expect(markWords({ important: 0, nit: 0, preExisting: 0 })).toBe('clean')
    expect(markText({ important: 1, nit: 1, preExisting: 1 })).toBe('✗1 n1 p1')
    expect(markText({ important: 0, nit: 3, preExisting: 0 })).toBe('n3')
    expect(plural(1, 'file')).toBe('1 file')
    expect(plural(4, 'file')).toBe('4 files')
  })
})

// ---- The findings tree on the Now card

// A survivors.md, from `[TAG] loc — Pattern Category: title` lines (a line may add `Confidence: N` after it).
const survivorsMd = (...lines: string[]) => `Summary: ${lines.length} kept\n\n${lines.map(l => `${l}\n`).join('')}`
const impAt = (loc: string, title = 'Unescaped CSV fields') => `[IMPORTANT] ${loc} — Pattern Category: ${title}`
const nitAt = (loc: string, title = 'Naming') => `[NIT] ${loc} — Pattern Category: ${title}`
const preAt = (loc: string, title = 'Old debt') => `[PRE-EXISTING] ${loc} — Pattern Category: ${title}`
const NOTHING_KEPT = 'Summary: 0 issues found. Ready to land.\n'

// A task whose review rounds kept these survivors.md texts, in order; null is a round still reviewing (its first
// reviewer replied, its vote isn't in). `dir: 'plan-review'` makes them plan review rounds, during planning.
type TreeFixture = { risk?: string; status?: string; dir?: 'review' | 'plan-review'; disputes?: Record<number, string>; extra?: string }
function inRounds(rounds: (string | null)[], o: TreeFixture = {}): Record<string, string> {
  const dir = o.dir ?? 'review'
  const status = o.status ?? (dir === 'plan-review' ? 'PLANNING' : 'IN_REVIEW')
  const files: Record<string, string> = {
    '.git/HEAD': 'ref: refs/heads/feat/export-csv\n',
    '.tasks/export-csv/state.md': state(status, o.extra ?? '')
      .replace(/^risk: \w+$/m, `risk: ${o.risk ?? 'MEDIUM'}`)
      .replace(/^round: \d+$/m, `round: ${dir === 'review' ? rounds.length : 0}`)
      .replace(/^plan_rounds: \d+$/m, `plan_rounds: ${dir === 'plan-review' ? rounds.length : 0}`),
    '.tasks/export-csv/rd.md': RD,
  }
  rounds.forEach((text, i) => {
    files[`.tasks/export-csv/${dir}/round-${i + 1}/logic.md`] = 'Summary: 0 issues found.\n'
    if (text !== null) files[`.tasks/export-csv/${dir}/round-${i + 1}/survivors.md`] = text
  })
  for (const [n, text] of Object.entries(o.disputes ?? {})) files[`.tasks/export-csv/${dir}/round-${n}/disputes.md`] = text
  return files
}

type Drawn = { find: (q: ElementQuery) => Promise<FoundElement | undefined>; findAll: (q: ElementQuery) => Promise<FoundElement[]> }
const ON_TERMINAL = { ...PANE, surface: 'terminal' } as const
const TREE = 'export-csv:tree:'
// The tree's rows (folders, files, `other`, and findings): each is a Button, whose text is the row as drawn.
const treeButtons = async (pane: Drawn) => (await pane.findAll({ type: 'Button' })).filter(b => b.key?.includes(':tree:') && !b.key.endsWith(':copy'))
const treeKeys = async (pane: Drawn) => (await treeButtons(pane)).map(b => b.key ?? '')
const rowOf = async (pane: Drawn, key: string) => (await pane.find({ type: 'Button', key }))?.text
const allRows = async (pane: Drawn) => (await treeButtons(pane)).map(b => b.text)
// Width as the card draws it: code points, a Private Use Area icon as 2.
const cols = (text: string) => [...text].reduce((n, c) => n + (/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u.test(c) ? 2 : 1), 0)
// A Nerd Font icon (a Private Use Area code point), and a row with its icons and their spaces taken out.
const PUA = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u
const bare = (text: string) => text.replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}] /gu, '')

// Swaps the project's files for `next` and saves a task file, which re-reads the task.
async function reload($: Engine, files: Record<string, string>, next: Record<string, string>) {
  for (const k of Object.keys(files)) delete files[k]
  Object.assign(files, next)
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/state.md', content: '' })
}

// Two plan rounds (round 1 kept an IMPORTANT, round 2 nothing) and two code rounds: round 1 kept SURVIVORS, and
// round 2 is reviewing, with Logic's reply at 1 IMPORTANT and 1 NIT, Architecture's clean, and Patterns' a NIT.
function inBothReviews(): Record<string, string> {
  const files: Record<string, string> = {
    ...repo('IN_REVIEW'),
    '.tasks/export-csv/plan-review/round-1/survivors.md': survivorsMd(impAt('.tasks/export-csv/plan.md:14')),
    '.tasks/export-csv/plan-review/round-2/survivors.md': NOTHING_KEPT,
    '.tasks/export-csv/review/round-2/logic.md': SURVIVORS,
    '.tasks/export-csv/review/round-2/architecture.md': NOTHING_KEPT,
    '.tasks/export-csv/review/round-2/patterns.md': survivorsMd(nitAt('app/report.py:7')),
  }
  delete files['.tasks/export-csv/review/round-2/candidates.md']
  return files
}

test('kept findings show as a tree of their files, from the project root, with single-child folders merged', async ($, on) => {
  const C = 'app/frontend/src/components'
  const survivors = survivorsMd(nitAt('README.md:1'), nitAt('src/export/csv.ts:8'), impAt(`${C}/Table.tsx:20`), nitAt(`${C}/Table.tsx:5`), nitAt(`${C}/Button.tsx:10`, 'Spacing'), nitAt(`${C}/Button.tsx:3`))
  world(on, inRounds([survivors]))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(ON_TERMINAL)
  expect(await treeKeys(pane)).toEqual([
    `${TREE}${C}/`, `${TREE}${C}/Button.tsx`, `${TREE}${C}/Button.tsx:3#0`, `${TREE}${C}/Button.tsx:10#0`,
    `${TREE}${C}/Table.tsx`, `${TREE}${C}/Table.tsx:5#0`, `${TREE}${C}/Table.tsx:20#0`,
    `${TREE}src/export/`, `${TREE}src/export/csv.ts`, `${TREE}src/export/csv.ts:8#0`,
    `${TREE}README.md`, `${TREE}README.md:1#0`,
  ])
  for (const partial of ['app/', 'app/frontend/', 'app/frontend/src/', 'src/']) expect(await pane.find({ type: 'Button', key: `${TREE}${partial}` })).toBeUndefined()
  expect(await rowOf(pane, `${TREE}${C}/`)).toBe('▾ app/frontend/src/components/ 2 files  ✗1  n3')
  // Every kept finding, the 5 NITs included.
  const findings = (await treeKeys(pane)).filter(k => /#\d+$/.test(k))
  expect(findings.length).toBe(6)
  const { important, nit, preExisting } = countFindings(survivors)
  expect(findings.length).toBe(important + nit + preExisting)
  await pane.unmount()
})

test("a finding's path is read repo-relative, so ./, the roots, and the task's worktree join the same file", async ($, on) => {
  const survivors = survivorsMd(impAt('./app/x.py:3'), nitAt('app/x.py:5', 'b'), preAt('/repo/app/x.py:9', 'c'),
    nitAt('/repo/.claude/worktrees/export-csv/app/x.py:11', 'd'), nitAt('C:\\repo\\app\\x.py:13', 'e'), nitAt('/repo2/app/x.py:1', 'f'))
  // The session runs in the task's linked worktree, whose main working tree, where .tasks/ is, is /repo. The test
  // engine reads a `C:/` path against its own folder, so the Windows root is state.md's `worktree`, the one root
  // the dashboard never reads through.
  const task = inRounds([survivors], { extra: 'worktree: C:/repo\n' })
  const files: Record<string, string> = {
    '.git': 'gitdir: /repo/.git/worktrees/export-csv\n',
    '/repo/.git/worktrees/export-csv/HEAD': 'ref: refs/heads/feat/export-csv\n',
    '/repo/.git/worktrees/export-csv/commondir': '../..\n',
  }
  for (const [k, v] of Object.entries(task)) if (k.startsWith('.tasks/')) files[`/repo/${k}`] = v
  world(on, files, '/repo/.claude/worktrees/export-csv')
  await $.session.start({ cwd: '/repo/.claude/worktrees/export-csv', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(ON_TERMINAL)
  const keys = await treeKeys(pane)
  expect(keys.filter(k => k.startsWith(`${TREE}app/x.py:`))).toHaveLength(5)
  expect(keys).toContain(`${TREE}app/x.py`)
  expect(keys).toContain(`${TREE}/repo2/app/x.py`)
  expect(keys.filter(k => k.startsWith(`${TREE}/repo2/app/x.py:`))).toHaveLength(1)
  await pane.unmount()
})

test('while the next round reviews, the tree keeps the last voted round and says which', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in round 1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^○ Verifier vote\s+waiting$/ })).toBeDefined()
  expect(await treeKeys(pane)).toContain(`${TREE}app/report.py:42#0`)
  await pane.unmount()

  files['.tasks/export-csv/review/round-1/survivors.md'] = NOTHING_KEPT
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/review/round-1/survivors.md', content: NOTHING_KEPT })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept nothing in round 1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^key:/ })).toBeUndefined()
  expect(await treeKeys(pane)).toEqual([])
  await pane.unmount()
})

test('a folder rolls up its findings by mark beside its file count, and the key names only the marks shown', async ($, on) => {
  const files = inRounds([survivorsMd(impAt('src/a.ts:1'), nitAt('src/b.ts:2'))])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/`)).toMatch(/ 2 files {2}✗1 {2}n1$/)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/ ✗1 {4}$/)
  expect(await pane.find({ type: 'Text', text: /^key: ✗ important {2}n nit$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^key:.*(✓|p pre)/ })).toBeUndefined()
  await pane.unmount()

  // Right-aligned: a two-digit count widens its column for every row.
  const tenNits = Array.from({ length: 10 }, (_, i) => nitAt(`src/a.ts:${i + 2}`, `Naming ${i}`))
  await reload($, files, inRounds([survivorsMd(impAt('src/a.ts:1'), ...tenNits, nitAt('src/b.ts:1'))]))
  pane = await $.ui.mount(ON_TERMINAL)
  const folder = await rowOf(pane, `${TREE}src/`) ?? ''
  const a = await rowOf(pane, `${TREE}src/a.ts`) ?? ''
  const b = await rowOf(pane, `${TREE}src/b.ts`) ?? ''
  expect(folder).toMatch(/ 2 files {2}✗1 {2}n11$/)
  expect(a).toMatch(/ ✗1 {2}n10$/)
  expect(b).toMatch(/b\.ts +n1$/)
  expect(b).toMatch(/ {5}n1$/)
  expect(new Set([cols(folder), cols(a), cols(b)]).size).toBe(1)
  await pane.unmount()
})

test('a finding fixed since an earlier round shows ✓ under its file, folded unless the task is HIGH', async ($, on) => {
  const r1 = survivorsMd(impAt('app/x.py:3'))
  const elsewhere = survivorsMd(nitAt('lib/z.py:5'))
  const files = inRounds([r1, elsewhere])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const fixedRow = `${TREE}app/x.py:3#0`
  // MEDIUM: the folder is open, and the file shows ✓1, folded.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/`)).toMatch(/^▾ app\//)
  expect(await rowOf(pane, `${TREE}app/x.py`)).toMatch(/^ {2}▸ x\.py +✓1 {4}$/)
  expect((await treeKeys(pane)).filter(k => k.startsWith(`${TREE}app/x.py:`))).toEqual([])
  await pane.unmount()

  // HIGH: the fixed row shows without a press.
  await reload($, files, inRounds([r1, elsewhere], { risk: 'HIGH' }))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, fixedRow)).toMatch(/✓ :3 round 1 → fixed by round 2$/)
  await pane.unmount()

  // Kept in rounds 1 and 2, gone in round 3.
  await reload($, files, inRounds([r1, r1, elsewhere], { risk: 'HIGH' }))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, fixedRow)).toMatch(/✓ :3 round 2 → fixed by round 3$/)
  await pane.unmount()

  // IMPORTANT in round 1, a NIT in round 2, gone in round 3: the round is the last that kept it as IMPORTANT.
  await reload($, files, inRounds([r1, survivorsMd(nitAt('app/x.py:3', 'Unescaped CSV fields')), elsewhere], { risk: 'HIGH' }))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, fixedRow)).toMatch(/✓ :3 round 1 → fixed by round 3$/)
  await pane.unmount()

  // Fixed by round 2, shown under round 3.
  await reload($, files, inRounds([survivorsMd(impAt('app/x.py:3'), nitAt('lib/z.py:5')), elsewhere, elsewhere], { risk: 'HIGH' }))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in round 3$/ })).toBeDefined()
  expect(await rowOf(pane, fixedRow)).toMatch(/✓ :3 round 1 → fixed by round 2$/)
  await pane.unmount()

  // Round 2 kept nothing: the fix still shows, and the key names only ✓.
  await reload($, files, inRounds([r1, NOTHING_KEPT]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept nothing in round 2$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^key: ✓ fixed this run$/ })).toBeDefined()
  expect(await rowOf(pane, `${TREE}app/x.py`)).toMatch(/x\.py +✓1$/)
  // On MEDIUM a press opens the file to its fixed row.
  expect(await rowOf(pane, fixedRow)).toBeUndefined()
  await pane.press({ key: `${TREE}app/x.py` })
  expect(await rowOf(pane, fixedRow)).toMatch(/✓ :3 round 1 → fixed by round 2$/)
  await pane.unmount()
})

test('a finding whose line moved, or whose severity changed, is not shown as fixed', async ($, on) => {
  const files = inRounds([survivorsMd(impAt('app/x.py:3')), survivorsMd(impAt('app/x.py:6'))])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const noFix = async (pane: Drawn) => expect((await allRows(pane)).some(t => t.includes('✓'))).toBe(false)
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/x.py`)).toMatch(/x\.py +✗1 *$/)
  expect(await rowOf(pane, `${TREE}app/x.py:6#0`)).toMatch(/✗ :6 Unescaped CSV fields$/)
  await noFix(pane)
  await pane.unmount()

  await reload($, files, inRounds([survivorsMd(impAt('app/x.py:3')), survivorsMd(nitAt('app/x.py:3', 'Unescaped CSV fields'))]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/x.py`)).toMatch(/x\.py +n1 *$/)
  await noFix(pane)
  await pane.unmount()

  // Two kept, one left: the one kept pairs with the nearest line, so :3 is the fixed one.
  await reload($, files, inRounds([survivorsMd(impAt('app/x.py:3'), impAt('app/x.py:9')), survivorsMd(impAt('app/x.py:8'))]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/x.py`)).toMatch(/x\.py +✗1 {2}✓1$/)
  expect(await rowOf(pane, `${TREE}app/x.py:3#0`)).toMatch(/✓ :3 round 1 → fixed by round 2$/)
  expect(await rowOf(pane, `${TREE}app/x.py:8#0`)).toMatch(/✗ :8 /)
  await pane.unmount()

  // Kept in round 1, gone in round 2, back in round 3: open again.
  await reload($, files, inRounds([survivorsMd(impAt('app/x.py:3')), survivorsMd(nitAt('lib/z.py:5')), survivorsMd(impAt('app/x.py:3'))]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/x.py`)).toMatch(/x\.py +✗1$/)
  await noFix(pane)
  await pane.unmount()
})

test('a finding dropped on dispute reads as dropped, not fixed', async ($, on) => {
  const drop = { 1: 'DROP [IMPORTANT] ./app/x.py:3 — (b) handled by the caller\n' }
  // Dropped in round 1, written another way than the survivors.md line; round 2 keeps a finding elsewhere.
  const files = inRounds([survivorsMd(impAt('app/x.py:3')), survivorsMd(nitAt('lib/z.py:5'))], { disputes: drop })
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  const dropped = await pane.find({ type: 'Button', key: `${TREE}app/x.py:3#0` })
  expect(dropped?.text).toBe('      · :3 dropped on dispute in round 1')
  // Dim throughout: the row's Text, and every part of it.
  const row = dropped?.children[0] as { props: { dimColor?: boolean }; children: { props?: { dimColor?: boolean } }[] }
  expect(row.props.dimColor).toBe(true)
  expect(row.children.every(c => c.props?.dimColor === true)).toBe(true)
  expect((await allRows(pane)).some(t => t.includes('✓'))).toBe(false)
  await pane.unmount()

  // Dropped in the round on show, while the builder fixes the rest: dim at once, and out of the counts.
  const survivors = survivorsMd(impAt('app/x.py:3'), nitAt('lib/z.py:5'))
  await reload($, files, inRounds([survivors], { disputes: drop, status: 'FIXING' }))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/x.py:3#0`)).toBe('      · :3 dropped on dispute in round 1')
  const rows = await allRows(pane)
  expect(rows.some(t => t.includes('✗'))).toBe(false)
  expect(await pane.find({ type: 'Text', text: /^key: n nit$/ })).toBeDefined()
  // The files' mark totals plus the dropped rows are what the voter kept.
  const fileKeys = (await treeKeys(pane)).filter(k => !k.endsWith('/') && !/#\d+$/.test(k))
  let marks = 0
  for (const k of fileKeys) for (const m of (await rowOf(pane, k) ?? '').matchAll(/ [✗np](\d+)/g)) marks += Number(m[1])
  const droppedRows = rows.filter(t => t.includes('dropped on dispute')).length
  const { important, nit, preExisting } = countFindings(survivors)
  expect(await rowOf(pane, `${TREE}lib/z.py`)).toMatch(/z\.py +n1$/)
  expect(droppedRows).toBe(1)
  expect(marks + droppedRows).toBe(important + nit + preExisting)
  // The voter row says what it dropped, so its counts reconcile with the tree's.
  expect(await pane.find({ type: 'Text', text: /^✗ Verifier vote\s+kept ✗1 n1 · 1 dropped on dispute → fix round$/ })).toBeDefined()
  await pane.unmount()
})

test('a finding is one line, cut at the end; a press shows it in full with a copy path button', async ($, on) => {
  const title = Array.from({ length: 22 }, (_, i) => `quoting${i}`).join(' ')
  expect(title.length).toBeGreaterThanOrEqual(120)
  const seen = world(on, inRounds([`${survivorsMd(impAt('app/x.py:22', title))}Confidence: 92\n`]))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const key = `${TREE}app/x.py:22#0`
  const pane = await $.ui.mount(ON_TERMINAL)
  const cut = await rowOf(pane, key) ?? ''
  expect(cut).toEndWith('…')
  expect(cols(cut)).toBeLessThanOrEqual(46)
  expect(await pane.find({ type: 'Button', key: `${key}:copy` })).toBeUndefined()

  await pane.press({ key })
  const first = /^\s*✗ :22 (.*)$/.exec(await rowOf(pane, key) ?? '')?.[1] ?? ''
  const more = (await pane.findAll({ type: 'Box' })).filter(b => b.key?.startsWith(`${key}:more-`)).map(b => b.text.trim())
  expect(more.length).toBeGreaterThan(0)
  expect([first, ...more].join(' ')).toBe(title)
  expect((await pane.find({ type: 'Box', key: `${key}:detail` }))?.text).toMatch(/^ +confidence 92 {2}copy path$/)
  const copyButton = await pane.find({ type: 'Button', key: `${key}:copy` })
  expect(copyButton?.props.label).toBe('copy path')
  await pane.press({ key: `${key}:copy` })
  expect(seen.copied).toEqual(['app/x.py:22'])

  await pane.press({ key })
  expect(await pane.find({ type: 'Button', key: `${key}:copy` })).toBeUndefined()
  expect(await rowOf(pane, key)).toEndWith('…')
  await pane.unmount()
})

test('a press folds or opens a folder or file, and the choice survives a new round', async ($, on) => {
  const files = inRounds([survivorsMd(nitAt('src/export/csv.ts:8'), impAt('src/export/json.ts:3'), nitAt('app/x.py:1')), null])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const folder = `${TREE}src/export/`
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Button', key: `${folder}csv.ts` })).toBeDefined()
  await pane.press({ key: folder })
  expect(await pane.find({ type: 'Button', key: `${folder}csv.ts` })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: `${folder}json.ts` })).toBeUndefined()
  expect(await rowOf(pane, folder)).toMatch(/^▸ src\/export\//)
  await pane.unmount()

  // Round 2's vote lands, still with a finding under src/export/: the folder stays folded.
  const r2 = survivorsMd(nitAt('src/export/csv.ts:8'))
  files['.tasks/export-csv/review/round-2/survivors.md'] = r2
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/review/round-2/survivors.md', content: r2 })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in round 2$/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: folder })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: `${folder}csv.ts` })).toBeUndefined()

  await pane.press({ key: folder })
  expect(await pane.find({ type: 'Button', key: `${folder}csv.ts` })).toBeDefined()
  await pane.unmount()
})

test("plan-review findings sit under the task's plan.md", async ($, on) => {
  world(on, inRounds([survivorsMd(impAt('.tasks/export-csv/plan.md:14', 'Plan skips the docs step'))], { dir: 'plan-review' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /Plan review, round 1 of 2/ })).toBeDefined()
  expect(await treeKeys(pane)).toEqual([`${TREE}.tasks/export-csv/`, `${TREE}.tasks/export-csv/plan.md`, `${TREE}.tasks/export-csv/plan.md:14#0`])
  expect(await rowOf(pane, `${TREE}.tasks/export-csv/plan.md:14#0`)).toMatch(/✗ :14 Plan skips the docs step$/)
  await pane.unmount()
})

test('with file_icons set to nerd, the terminal shows file type icons, and other surfaces and off show none', { options: { file_icons: 'nerd' } }, async ($, on) => {
  world(on, inRounds([survivorsMd(impAt('src/a.ts:1'), nitAt('src/a.test.ts:2'), nitAt('README.md:3'))]))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  // Each icon is its own Text, in its file type's colour.
  const icon = await pane.find({ type: 'Text', text: /^$/ })
  expect(icon?.props.color).toBe('#519aba')
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toContain(' a.ts')
  expect(await rowOf(pane, `${TREE}src/a.test.ts`)).toContain('\u{F0668} a.test.ts')
  expect(await rowOf(pane, `${TREE}README.md`)).toContain('\u{F0219} README.md')
  expect((await allRows(pane)).some(r => r.includes(''))).toBe(false)
  await pane.unmount()
  // Another surface draws no icon, even with nerd set.
  pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toBeDefined()
  for (const t of await pane.findAll({ type: 'Text' })) expect(t.text).not.toMatch(PUA)
  for (const r of await allRows(pane)) expect(r).not.toMatch(PUA)
  await pane.unmount()
  expect(iconsOn('off', 'terminal')).toBe(false)
  expect(iconsOn('yes', 'terminal')).toBe(false)
})

test('no tree row is wider than the card, with or without icons', { options: { file_icons: 'nerd' } }, async ($, on) => {
  const long = `${'n'.repeat(67)}.ts`
  const chain = 'first/alpha/bravo/charlie/delta/echo/foxtrot/golf/hotel/last'
  expect(long.length).toBe(70)
  expect(chain.length).toBe(60)
  const title = 'A very long Pattern Category that cannot possibly fit on one row of the docked pane'
  const r2 = survivorsMd(`${impAt(`${chain}/${long}:12`, title)}\nConfidence: 92`, nitAt(`${chain}/b.ts:1`), preAt('lib/old.py:4'))
  world(on, inRounds([survivorsMd(impAt('app/x.py:3')), r2]))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const key = `${TREE}${chain}/${long}:12#0`
  // With nerd on the terminal (icons on), then on vscode (icons off). The open finding stays open across mounts.
  for (const surface of ['terminal', 'vscode'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    if (!(await pane.find({ type: 'Box', key: `${key}:detail` }))) {
      expect(await rowOf(pane, key)).toEndWith('…')
      await pane.press({ key })
    }
    // The rows, an open finding's further lines, the key's lines, and its confidence with the copy button.
    const boxes = await pane.findAll({ type: 'Box' })
    const rows = await allRows(pane)
    const lines = [...rows, ...boxes.filter(b => /:more-\d+$|:tree-key-\d+$|:detail$/.test(b.key ?? '')).map(b => b.text)]
    expect(rows.some(r => PUA.test(r))).toBe(surface === 'terminal')
    expect(boxes.find(b => b.key === `${key}:detail`)?.text).toMatch(/confidence 92 +copy path$/)
    expect(lines.length).toBeGreaterThan(8)
    for (const l of lines) expect(cols(l)).toBeLessThanOrEqual(46)
    // All four marks: the key wraps onto a second line.
    expect(boxes.filter(b => /:tree-key-\d+$/.test(b.key ?? '')).map(b => b.text)).toEqual(['key: ✗ important  ✓ fixed this run  n nit', '     p pre-existing'])
    expect(bare(await rowOf(pane, `${TREE}${chain}/`) ?? '')).toMatch(/^▾ first\/…\/last\/ /)
    expect(bare(await rowOf(pane, `${TREE}${chain}/${long}`) ?? '')).toMatch(/…n+\.ts +✗1/)
    await pane.unmount()
  }
})

test('every tree row is a labelled button, and the copy button reads copy path', async ($, on) => {
  const files = inRounds([survivorsMd(impAt('app/x.py:3')), `${survivorsMd(nitAt('src/a.ts:1'), impAt('src/b.ts:2'))}`])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(ON_TERMINAL)
  const buttons = (await pane.findAll({ type: 'Button' })).filter(b => b.key?.includes(':tree:'))
  expect(buttons.length).toBeGreaterThan(4)
  for (const b of buttons) {
    expect(typeof b.props.label).toBe('string')
    expect(b.props.label).toMatch(/\S.*, (open|folded)$/)
  }
  const label = async (key: string) => (await pane.find({ type: 'Button', key }))?.props.label
  expect(await label(`${TREE}src/`)).toBe('src/ folder, 2 files, 1 important, 1 nit, open')
  expect(await label(`${TREE}app/x.py`)).toBe('app/x.py, 1 fixed, folded')
  const finding = `${TREE}src/a.ts:1#0`
  expect(await label(finding)).toBe('nit at src/a.ts:1: Naming, folded')
  await pane.press({ key: finding })
  expect(await label(finding)).toBe('nit at src/a.ts:1: Naming, open')
  expect(await label(`${finding}:copy`)).toBe('copy path')
  // A key press reaches folder and file rows too.
  await pane.press({ key: `${TREE}app/x.py` })
  expect(await label(`${TREE}app/x.py`)).toBe('app/x.py, 1 fixed, open')
  await pane.press({ key: `${TREE}src/` })
  expect(await label(`${TREE}src/`)).toBe('src/ folder, 2 files, 1 important, 1 nit, folded')
  await pane.unmount()

  // The two toggles whose on-screen text is now marks keep their names in words, with their state last.
  await reload($, files, inBothReviews())
  let rounds = await $.ui.mount(ON_TERMINAL)
  const name = 'Review rounds, plan round 1: 1 important, round 2: clean; code round 1: 1 important, round 2: reviewing'
  expect((await rounds.find({ type: 'Button', key: 'toggle-rounds' }))?.props.label).toBe(`${name}, folded`)
  await rounds.press({ key: 'toggle-rounds' })
  expect((await rounds.find({ type: 'Button', key: 'toggle-rounds' }))?.props.label).toBe(`${name}, open`)
  await rounds.unmount()

  files['.tasks/review-pr-12/state.md'] = reviewState('REVIEWED')
  files['.tasks/review-pr-12/run-1/survivors.md'] = SURVIVORS
  await $.tool.call({ tool: 'Bash', command: 'quorum-state --task review-pr-12 set status REVIEWED' })
  rounds = await $.ui.mount(ON_TERMINAL)
  // Beside a task, Reviews starts folded.
  await rounds.press({ key: 'toggle-reviews' })
  const past = (await rounds.find({ type: 'Button', key: 'past-toggle-review-pr-12' }))?.props.label
  expect(past).toMatch(/^review-pr-12, 1 important, 1 nit, MEDIUM, 1 run, .+, folded$/)
  await rounds.unmount()
})

test('tree edge cases: no vote yet, a root file, an outside path, no location, many findings, unicode, an unknown file_icons value', { options: { file_icons: 'yes' } }, async ($, on) => {
  // No round voted yet: no tree and no key, and the reviewer rows as before.
  const files = inRounds([null])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await treeKeys(pane)).toEqual([])
  expect(await pane.find({ type: 'Text', text: /^key:|^the verifier kept/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^✓ Logic & edge cases\s+clean$/ })).toBeDefined()
  await pane.unmount()

  // A round counter ahead of the folders on disk: round 1's tree, and nothing throws.
  const ahead = inRounds([survivorsMd(impAt('app/x.py:3'))])
  ahead['.tasks/export-csv/state.md'] = (ahead['.tasks/export-csv/state.md'] ?? '').replace(/^round: \d+$/m, 'round: 2').replace(/^plan_rounds: \d+$/m, 'plan_rounds: 2')
  ahead['.tasks/export-csv/plan-review/round-1/survivors.md'] = NOTHING_KEPT
  await reload($, files, ahead)
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in round 1$/ })).toBeDefined()
  expect(await treeKeys(pane)).toContain(`${TREE}app/x.py:3#0`)
  expect(await pane.find({ type: 'Text', text: /^plan r1 clean  code r1 ✗1 · r2 reviewing$/ })).toBeDefined()
  await pane.unmount()

  // A root file, a path outside the roots, no location, 12 findings on one file, and unicode names.
  const astral = `${'😀'.repeat(40)}.md`
  const many = Array.from({ length: 12 }, (_, i) => nitAt(`lib/many.py:${i + 1}`, `Naming ${i}`))
  const survivors = survivorsMd(nitAt('README.md:3'), nitAt('/repo2/app/x.py:1'), '[NIT] Summary wording', ...many, nitAt('docs/café/naïve.md:2'), nitAt(`docs/${astral}:1`))
  await reload($, files, inRounds([survivors]))
  pane = await $.ui.mount(ON_TERMINAL)
  const keys = await treeKeys(pane)
  expect(keys).toContain(`${TREE}README.md`)
  expect(await rowOf(pane, `${TREE}README.md`)).toMatch(/^ {2}README\.md /)
  expect(keys).toContain(`${TREE}/repo2/app/x.py`)
  // No location: under `other`, after every file.
  const other = keys.indexOf(`${TREE}:other`)
  expect(other).toBeGreaterThan(-1)
  expect(keys.slice(other)).toEqual([`${TREE}:other`, `${TREE}:other:#0`])
  expect(await rowOf(pane, `${TREE}:other:#0`)).toMatch(/n \(no location\) Summary wording$/)
  const { important, nit, preExisting } = countFindings(survivors)
  expect(keys.filter(k => /#\d+$/.test(k))).toHaveLength(important + nit + preExisting)
  expect(keys.filter(k => k.startsWith(`${TREE}lib/many.py:`))).toHaveLength(12)
  expect(await rowOf(pane, `${TREE}lib/many.py`)).toMatch(/many\.py +n12$/)
  expect(keys).toContain(`${TREE}docs/café/naïve.md`)
  const rows = await allRows(pane)
  // An unknown file_icons value draws no icons.
  for (const t of await pane.findAll({ type: 'Text' })) expect(t.text).not.toMatch(PUA)
  for (const r of rows) {
    expect(r).not.toMatch(PUA)
    expect(cols(r)).toBeLessThanOrEqual(46)
    expect(r).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  }
  expect(await rowOf(pane, `${TREE}docs/${astral}`)).toMatch(/😀…😀+\.md /u)
  await pane.unmount()
})

// ---- The findings tree for standalone reviews

// A standalone review this session runs, with no task: each run's survivors.md, and the range end its state.md log
// line records (`## Run <N> (A..<end>, <tier>)`); the frontmatter's range is the latest run's.
function inRuns(id: string, status: string, runs: { end: string; survivors: string }[], risk = 'MEDIUM'): Record<string, string> {
  const files: Record<string, string> = {
    '.git/HEAD': 'ref: refs/heads/main\n',
    [`.tasks/${id}/state.md`]: `---\nslug: ${id}\nkind: review\nrange: 1a2b3c4..${runs.at(-1)?.end ?? ''}\nsession: sess-a\nrisk: ${risk}\nstatus: ${status}\nround: 0\n---\n${runs.map((r, i) => `## Run ${i + 1} (1a2b3c4..${r.end}, ${risk})\n`).join('')}`,
  }
  runs.forEach((r, i) => {
    files[`.tasks/${id}/run-${i + 1}/logic.md`] = 'Summary: 0 issues found.\n'
    files[`.tasks/${id}/run-${i + 1}/survivors.md`] = r.survivors
  })
  return files
}

test('a standalone review shows a fix only when a later run reviewed a different range end', async ($, on) => {
  const id = 'review-abc1234'
  const scope = `${id}:tree:`
  const once = survivorsMd(impAt('app/x.py:3'))
  const elsewhere = survivorsMd(nitAt('lib/z.py:5'))
  const files = inRuns(id, 'REVIEWING', [{ end: 'b2b2b2b', survivors: once }, { end: 'b2b2b2b', survivors: elsewhere }])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const swap = async (next: Record<string, string>) => {
    for (const k of Object.keys(files)) delete files[k]
    Object.assign(files, next)
    await $.tool.call({ tool: 'Write', file_path: `/repo/.tasks/${id}/state.md`, content: '' })
  }

  // Two runs over the same end reviewed the same code: no ✓.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in run 2$/ })).toBeDefined()
  expect(await rowOf(pane, `${scope}lib/z.py`)).toMatch(/z\.py +n1$/)
  expect(await pane.find({ type: 'Button', key: `${scope}app/x.py` })).toBeUndefined()
  expect((await allRows(pane)).join('\n')).not.toContain('✓')
  await pane.unmount()

  // Run 2 over a different end: the finding only run 1 kept is fixed.
  await swap(inRuns(id, 'REVIEWING', [{ end: 'b2b2b2b', survivors: once }, { end: 'c3c3c3c', survivors: elsewhere }]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${scope}app/x.py`)).toMatch(/x\.py +✓1/)
  await pane.press({ key: `${scope}app/x.py` })
  expect(await rowOf(pane, `${scope}app/x.py:3#0`)).toMatch(/✓ :3 run 1 → fixed by run 2$/)
  await pane.unmount()

  // Ends B, B, C: the run over a new end shows the fix.
  await swap(inRuns(id, 'REVIEWING', [{ end: 'b2b2b2b', survivors: once }, { end: 'b2b2b2b', survivors: elsewhere }, { end: 'c3c3c3c', survivors: elsewhere }]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in run 3$/ })).toBeDefined()
  expect(await rowOf(pane, `${scope}app/x.py`)).toMatch(/x\.py +✓1/)
  // Still open from the press above: the fold choice is kept per review id.
  expect(await rowOf(pane, `${scope}app/x.py:3#0`)).toMatch(/✓ :3 run 1 → fixed by run 3$/)
  await pane.unmount()
})

test('a /quorum:review card and a past review show their kept findings as the same tree, with fixes from earlier runs', async ($, on) => {
  const id = 'review-pr-12'
  const scope = `${id}:tree:`
  const runs = [
    { end: 'b2b2b2b', survivors: survivorsMd(impAt('app/x.py:3'), nitAt('lib/z.py:5')) },
    { end: 'c3c3c3c', survivors: survivorsMd(impAt('lib/z.py:9', 'Wrong env var'), nitAt('lib/z.py:5')) },
  ]
  const files = inRuns(id, 'REVIEWING', runs)
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  // The live card: the latest run's findings as a tree, and run 1's fix as ✓.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in run 2$/ })).toBeDefined()
  const live = await treeKeys(pane)
  expect(live).toEqual([`${scope}app/`, `${scope}app/x.py`, `${scope}lib/`, `${scope}lib/z.py`, `${scope}lib/z.py:5#0`, `${scope}lib/z.py:9#0`])
  expect(await rowOf(pane, `${scope}app/x.py`)).toMatch(/x\.py +✓1/)
  expect(await rowOf(pane, `${scope}lib/z.py:9#0`)).toMatch(/✗ :9 Wrong env var$/)
  await pane.unmount()

  // Finished, it's history: its row opens to the same tree.
  files[`.tasks/${id}/state.md`] = (files[`.tasks/${id}/state.md`] ?? '').replace(/^status: \w+$/m, 'status: REVIEWED')
  await $.tool.call({ tool: 'Bash', command: `quorum-state --task ${id} set status REVIEWED` })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await treeKeys(pane)).toEqual([])
  await pane.press({ key: `past-toggle-${id}` })
  expect(await treeKeys(pane)).toEqual(live)
  expect(await rowOf(pane, `${scope}app/x.py`)).toMatch(/x\.py +✓1/)
  await pane.unmount()
})

// ---- One vocabulary on the rows around the tree

test('reviewer, voter, builder, and round rows use the tree marks, and the verdict sits on the voter row', async ($, on) => {
  const files = inBothReviews()
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  // Round 2 is reviewing: each reviewer's counts in marks, ✗ only with an IMPORTANT, ✓ only when clean.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^✗ Logic & edge cases\s+✗1 n1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✓ Architecture & drift\s+clean$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^• Patterns\s+n1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^○ Verifier vote\s+waiting$/ })).toBeDefined()
  // Review rounds groups the plan and code rounds; opened, a round reads its counts in marks.
  expect(await pane.find({ type: 'Text', text: /^plan r1 ✗1 · r2 clean  code r1 ✗1 · r2 reviewing$/ })).toBeDefined()
  await pane.press({ key: 'toggle-rounds' })
  expect(await pane.find({ type: 'Text', text: /^plan r1  ✗1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^plan r2  clean$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^code r1  ✗1 n1  \(voter kept 2 of 4\)$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✗1 n1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^code r2  reviewing…$/ })).toBeDefined()
  await pane.unmount()

  // The vote is in: the voter row carries the verdict, and no separate verdict line renders.
  files['.tasks/export-csv/review/round-2/votes.md'] = SURVIVORS
  files['.tasks/export-csv/review/round-2/survivors.md'] = SURVIVORS
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/review/round-2/survivors.md', content: SURVIVORS })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^✗ Verifier vote\s+kept ✗1 n1 → fix round$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /survives?\b/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^plan r1 ✗1 · r2 clean  code r1 ✗1 · r2 ✗1$/ })).toBeDefined()
  await pane.unmount()

  // A standalone review the builder fixes: its builder row in marks.
  files['.tasks/review-pr-12/state.md'] = reviewState('FIXING')
  files['.tasks/review-pr-12/run-1/survivors.md'] = survivorsMd(impAt('app/report.py:42'))
  await $.tool.call({ tool: 'Bash', command: 'quorum-state --task review-pr-12 set status FIXING' })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^✗ Verifier vote\s+kept ✗1 → fix$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^○ Builder\s+fixes ✗1$/ })).toBeDefined()
  await pane.unmount()
})

test("the voter row's next step follows the pipeline: fix round, halts, converges, revise, your call, ready, fix, done", async ($, on) => {
  // A REVIEWED review has no card, but its next step is still done.
  expect(voterNext('standalone', 1, 1, 1, 'REVIEWED')).toBe('done')

  const imp = survivorsMd(impAt('app/x.py:3'))
  const nit = survivorsMd(nitAt('app/x.py:3'))
  const files = inRounds([imp])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const voter = async () => {
    const pane = await $.ui.mount(ON_TERMINAL)
    const text = (await pane.find({ type: 'Text', text: /^[✓✗] Verifier vote/ }))?.text
    await pane.unmount()
    return text
  }

  // Code review, of max_rounds 3.
  expect(await voter()).toMatch(/^✗ Verifier vote\s+kept ✗1 → fix round$/)
  await reload($, files, inRounds([imp, imp, imp]))
  expect(await voter()).toMatch(/^✗ Verifier vote\s+kept ✗1 → halts$/)
  await reload($, files, inRounds([nit]))
  expect(await voter()).toMatch(/^✓ Verifier vote\s+kept n1 → converges$/)
  await reload($, files, inRounds([NOTHING_KEPT]))
  expect(await voter()).toMatch(/^✓ Verifier vote\s+kept nothing → converges$/)

  // Plan review: revised once, then the person's call.
  await reload($, files, inRounds([imp], { dir: 'plan-review' }))
  expect(await voter()).toMatch(/^✗ Verifier vote\s+kept ✗1 → revise the plan$/)
  await reload($, files, inRounds([imp, imp], { dir: 'plan-review' }))
  expect(await voter()).toMatch(/^✗ Verifier vote\s+kept ✗1 → your call$/)
  await reload($, files, inRounds([nit], { dir: 'plan-review' }))
  expect(await voter()).toMatch(/^✓ Verifier vote\s+kept n1 → ready for you$/)

  // The counts are survivors.md's, after the nit cap, not votes.md's.
  const capped = inRounds([survivorsMd(nitAt('app/x.py:3'), nitAt('app/x.py:5'))])
  capped['.tasks/export-csv/review/round-1/votes.md'] = survivorsMd(nitAt('app/x.py:3'), nitAt('app/x.py:5'), nitAt('app/x.py:7'))
  await reload($, files, capped)
  expect(await voter()).toMatch(/^✓ Verifier vote\s+kept n2 → converges$/)

  // A standalone review: fix while FIXING, else done.
  const id = 'review-abc1234'
  for (const [status, next] of [['FIXING', 'fix'], ['REVIEWING', 'done']]) {
    for (const k of Object.keys(files)) delete files[k]
    Object.assign(files, inRuns(id, status, [{ end: 'b2b2b2b', survivors: imp }]))
    await $.tool.call({ tool: 'Write', file_path: `/repo/.tasks/${id}/state.md`, content: '' })
    expect(await voter()).toMatch(new RegExp(`^✗ Verifier vote\\s+kept ✗1 → ${next}$`))
  }
})

// ---- The recorded change on the Now card

// When a list was recorded, in unix seconds as `date +%s` gives it, and a survivors.md written 5 seconds before
// that, in milliseconds as fs.stat gives it: a real pair, so a gate that forgets the `× 1000` fails.
const RECORDED = 1763300000
const VOTED_BEFORE = 1763299995000
const LIST = '.tasks/export-csv/files.tsv'
const PLAN = '.tasks/export-csv/plan.md'
// A files.tsv as bin/quorum-files record writes it: the header, then `LETTER ADDED REMOVED PATH OLD_PATH STEPS FIX`.
const fileRow = (letter: string, added: string, removed: string, path: string, steps = '-', fix = '-', old = '-') =>
  [letter, added, removed, path, old, steps, fix].join('\t')
const filesTsv = (rows: string[], o: { base?: string; since?: string; recorded?: number } = {}) =>
  `# quorum-files 1 head=${'c'.repeat(40)} base=${o.base ?? 'b'.repeat(40)} since=${o.since ?? '-'} recorded=${o.recorded ?? RECORDED}\n${rows.map(r => `${r}\n`).join('')}`
const planMd = (steps: number) => `# Plan\n\n## Steps\n${Array.from({ length: steps }, (_, i) => `${i + 1}. **Step ${i + 1}** — \`x\`\n`).join('')}`
// state.md's built_steps, as quorum-state push writes them.
const builtSteps = (...ns: number[]) => `built_steps:\n${ns.map(n => `  - "${n}"\n`).join('')}`
// The Text a tree row draws `text` in: one of the parts inside its Button's Text, each holding its string.
type Part = { props?: Record<string, unknown>; children: unknown[] }
async function partOf(pane: Drawn, key: string, text: string): Promise<Part | undefined> {
  const inner = ((await pane.find({ type: 'Button', key }))?.children[0] as Part | undefined)?.children ?? []
  return inner.find((c): c is Part => typeof c === 'object' && c !== null && (c as Part).children.join('') === text)
}

test('a quorum-files command refreshes the dashboard', async ($, on) => {
  const files = { ...inRounds([], { status: 'BUILDING', extra: builtSteps(1) }), [PLAN]: planMd(1), [LIST]: filesTsv([fileRow('A', '-', '-', 'src/a.ts', '1')]) }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  // Step 1 is built but a.ts isn't changed yet: ○, not ✓.
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/^○ A {5}a\.ts +s1$/)
  expect(await pane.find({ type: 'Button', key: `${TREE}src/b.ts` })).toBeUndefined()
  await pane.unmount()

  files[LIST] = filesTsv([fileRow('A', '12', '0', 'src/a.ts', '1'), fileRow('M', '1', '1', 'src/b.ts')])
  await $.tool.call({ tool: 'Bash', command: 'quorum-files record' })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/^✓ A {5}a\.ts +\+12 s1$/)
  expect(await rowOf(pane, `${TREE}src/b.ts`)).toMatch(/^\* M {5}b\.ts +unplanned +\+1 −1 {3}$/)
  await pane.unmount()
})

test('a file row reads progress, git letter, name, line counts, step, and marks, and folders show their file count', async ($, on) => {
  const rows = [
    fileRow('M', '86', '3', 'src/a.ts', '1'),
    fileRow('A', '12', '0', 'src/b.ts', '2'),
    fileRow('A', '-', '-', 'src/c.ts', '2'),
    fileRow('M', '1', '1', 'src/d.ts'),
    fileRow('M', 'bin', 'bin', 'img/logo.png', '1'),
  ]
  const task = (o: TreeFixture, rounds: string[] = [], list = rows) => ({ ...inRounds(rounds, o), [LIST]: filesTsv(list) })
  // Step 1 is built and step 2 isn't.
  const files: Record<string, string> = { ...task({ status: 'BUILDING', extra: builtSteps(1) }), [PLAN]: planMd(2) }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/`)).toMatch(/^ {4}▾ src\/ +4 files {3}$/)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/^✓ M {5}a\.ts +\+86 −3 s1$/)
  expect(await rowOf(pane, `${TREE}src/b.ts`)).toMatch(/^○ A {5}b\.ts +\+12 s2$/)
  expect(await rowOf(pane, `${TREE}src/c.ts`)).toMatch(/^○ A {5}c\.ts +s2$/)
  // Unplanned: the word before the counts, and no step.
  expect(await rowOf(pane, `${TREE}src/d.ts`)).toMatch(/^\* M {5}d\.ts +unplanned +\+1 −1 {3}$/)
  expect(await rowOf(pane, `${TREE}img/logo.png`)).toMatch(/^✓ M {5}logo\.png +bin s1$/)
  // Colours: ✓ success; ○, *, and the word dim; the letter dim only while planned; +N success and −N error.
  expect((await partOf(pane, `${TREE}src/a.ts`, '✓'))?.props?.color).toBe('success')
  expect((await partOf(pane, `${TREE}src/b.ts`, '○'))?.props?.dimColor).toBe(true)
  expect((await partOf(pane, `${TREE}src/d.ts`, '*'))?.props?.dimColor).toBe(true)
  expect((await partOf(pane, `${TREE}src/d.ts`, 'unplanned'))?.props?.dimColor).toBe(true)
  expect((await partOf(pane, `${TREE}src/c.ts`, 'A'))?.props?.dimColor).toBe(true)
  expect(await partOf(pane, `${TREE}src/b.ts`, 'A')).toBeDefined()
  expect((await partOf(pane, `${TREE}src/b.ts`, 'A'))?.props?.dimColor).toBeFalsy()
  expect((await partOf(pane, `${TREE}src/a.ts`, '+86'))?.props?.color).toBe('success')
  expect((await partOf(pane, `${TREE}src/a.ts`, '−3'))?.props?.color).toBe('error')
  await pane.unmount()

  // In review, a finding on a.ts adds its marks after the step, and the folder rolls it up.
  await reload($, files, { ...task({ extra: builtSteps(1, 2) }, [survivorsMd(impAt('src/a.ts:3'))]), [PLAN]: planMd(2) })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/^✓ M {5}a\.ts +\+86 −3 s1 {6}✗1$/)
  expect(await rowOf(pane, `${TREE}src/a.ts:3#0`)).toMatch(/✗ :3 Unescaped CSV fields$/)
  expect(await rowOf(pane, `${TREE}src/`)).toMatch(/ 4 files {9}✗1$/)
  await pane.unmount()

  // With no plan the progress column is gone.
  const noSteps = rows.map(r => r.split('\t').map((f, i) => (i === 5 ? '-' : f)).join('\t'))
  await reload($, files, task({ status: 'BUILDING' }, [], noSteps))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/^M {5}a\.ts +\+86 −3 {3}$/)
  expect(await rowOf(pane, `${TREE}src/d.ts`)).toMatch(/^M {5}d\.ts +\+1 −1 {3}$/)
  await pane.unmount()

  // A 3-step plan is built in one go: with no built_steps, its proof-build.md marks every planned file built, and
  // every changed one ✓. The planned-only c.ts stays ○.
  await reload($, files, { ...task({ status: 'BUILDING' }), [PLAN]: planMd(3), '.tasks/export-csv/proof-build.md': PROOF })
  pane = await $.ui.mount(ON_TERMINAL)
  for (const f of ['src/a.ts', 'src/b.ts', 'img/logo.png']) expect(await rowOf(pane, `${TREE}${f}`)).toMatch(/^✓ /)
  expect(await rowOf(pane, `${TREE}src/c.ts`)).toMatch(/^○ /)
  expect((await pane.find({ type: 'Button', key: `${TREE}src/c.ts` }))?.props.label).toBe('src/c.ts, step 2 built, not changed yet, added')
  expect(await rowOf(pane, `${TREE}src/d.ts`)).toMatch(/^\* /)
  await pane.unmount()
  // A 4-step plan is sliced: its steps are built only once built_steps names them.
  await reload($, files, { ...task({ status: 'BUILDING' }), [PLAN]: planMd(4), '.tasks/export-csv/proof-build.md': PROOF })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/^○ /)
  await pane.unmount()
})

test('the line-count, step, and mark columns keep their minimum widths and line up when folders open or close', async ($, on) => {
  // Where a row's line counts, step, and marks end, in columns. Each column is right-aligned, so a column that ends
  // at the same column on every row starts at the same column too.
  const ends = (text: string) => ({
    count: /^.*(?:[+−]\d+|bin|\d+ files?)/.exec(text)?.[0].length ?? -1,
    step: /^.*\bs\d+/.exec(text)?.[0].length ?? -1,
    marks: /^.*[✗↻✓np]\d+/.exec(text)?.[0].length ?? -1,
  })
  // The narrowest values (+1, no step, one n1): the long name is cut to fill its room and is followed by one space,
  // so what's left is the minimum widths: the line counts 7 (`     +1`), a space, the step 2, two spaces, the marks 6.
  const long = `${'l'.repeat(40)}.ts`
  const files: Record<string, string> = { ...inRounds([survivorsMd(nitAt('src/b.ts:1'))]), [LIST]: filesTsv([fileRow('M', '1', '0', `src/${long}`), fileRow('M', '1', '0', 'src/b.ts')]) }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/${long}`)).toMatch(/^M {5}l+…l+\.ts {6}\+1 {11}$/)
  expect(await rowOf(pane, `${TREE}src/b.ts`)).toMatch(/^M {5}b\.ts +\+1 {9}n1$/)
  expect(cols(await rowOf(pane, `${TREE}src/${long}`) ?? '')).toBe(46)
  await pane.unmount()

  // The widest values, all in deep/: `+12345 −6789`, `s12`, and a two-mark block. Folding deep/ moves no column.
  await reload($, files, {
    ...inRounds([survivorsMd(impAt('deep/w.ts:3'), nitAt('deep/w.ts:5'), nitAt('top.ts:1'))], { extra: builtSteps(1) }),
    [PLAN]: planMd(12),
    [LIST]: filesTsv([fileRow('M', '12345', '6789', 'deep/w.ts', '12'), fileRow('M', '1', '0', 'top.ts', '1')]),
  })
  pane = await $.ui.mount(ON_TERMINAL)
  const [folder = '', w = '', top = ''] = await Promise.all([`${TREE}deep/`, `${TREE}deep/w.ts`, `${TREE}top.ts`].map(async k => (await rowOf(pane, k)) ?? ''))
  expect(w).toMatch(/ \+12345 −6789 s12  ✗1  n1$/)
  expect(top).toMatch(/ {11}\+1  s1 {6}n1$/)
  expect(folder).toMatch(/^ {4}▾ deep\/ +1 file {6}✗1  n1$/)
  for (const row of [folder, w, top]) {
    expect(ends(row).count).toBe(ends(w).count)
    expect(ends(row).marks).toBe(46)
  }
  expect(ends(top).step).toBe(ends(w).step)
  await pane.press({ key: `${TREE}deep/` })
  expect(await pane.find({ type: 'Button', key: `${TREE}deep/w.ts` })).toBeUndefined()
  expect(await rowOf(pane, `${TREE}top.ts`)).toBe(top)
  expect(await rowOf(pane, `${TREE}deep/`)).toBe(folder.replace('▾', '▸'))
  await pane.unmount()
})

test('the tree shows the planned files during Plan and the change so far during Build', async ($, on) => {
  // Plan: the list holds only the planned rows, recorded before the build (`base=-`).
  const planned = [fileRow('M', '-', '-', 'app/report.py', '1'), fileRow('A', '-', '-', 'app/util.py', '2'), fileRow('M', '-', '-', 'README.md', '2')]
  const files: Record<string, string> = {
    ...inRounds([survivorsMd(impAt('.tasks/export-csv/plan.md:14', 'Plan skips the docs step'))], { dir: 'plan-review' }),
    [PLAN]: planMd(2),
    [LIST]: filesTsv(planned, { base: '-' }),
  }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /Plan review, round 1 of 2/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^2 steps · 3 files, 1 new$/ })).toBeDefined()
  expect(await treeKeys(pane)).toEqual([
    `${TREE}.tasks/export-csv/`, `${TREE}.tasks/export-csv/plan.md`, `${TREE}.tasks/export-csv/plan.md:14#0`,
    `${TREE}app/`, `${TREE}app/report.py`, `${TREE}app/util.py`, `${TREE}README.md`,
  ])
  expect(await rowOf(pane, `${TREE}.tasks/export-csv/plan.md:14#0`)).toMatch(/✗ :14 Plan skips the docs step$/)
  expect(await rowOf(pane, `${TREE}app/report.py`)).toMatch(/^○ M {5}report\.py +s1 {8}$/)
  expect(await rowOf(pane, `${TREE}app/util.py`)).toMatch(/^○ A {5}util\.py +s2 {8}$/)
  expect((await partOf(pane, `${TREE}app/report.py`, 'M'))?.props?.dimColor).toBe(true)
  await pane.unmount()

  // Build: the change so far against the plan, with no findings.
  const change = [fileRow('M', '40', '2', 'app/report.py', '1'), fileRow('A', '5', '0', 'app/util.py'), fileRow('M', '-', '-', 'README.md', '2'), fileRow('A', '-', '-', 'tests/test_report.py', '2')]
  await reload($, files, { ...inRounds([], { status: 'BUILDING', extra: builtSteps(1) }), [PLAN]: planMd(2), [LIST]: filesTsv(change) })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^1 of 3 planned files changed · 1 unplanned$/ })).toBeDefined()
  expect(await treeKeys(pane)).toEqual([`${TREE}app/`, `${TREE}app/report.py`, `${TREE}app/util.py`, `${TREE}tests/`, `${TREE}tests/test_report.py`, `${TREE}README.md`])
  expect(await rowOf(pane, `${TREE}app/report.py`)).toMatch(/^✓ M {5}report\.py +\+40 −2 s1$/)
  expect(await rowOf(pane, `${TREE}app/util.py`)).toMatch(/^\* A {5}util\.py +unplanned +\+5 {3}$/)
  expect(await rowOf(pane, `${TREE}README.md`)).toMatch(/^○ M {3}README\.md +s2$/)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept/ })).toBeUndefined()
  await pane.unmount()

  // Spec has no tree, even with a list.
  await reload($, files, { ...inRounds([], { status: 'DRAFT-AWAITING-VISUAL-SIGNOFF' }), [PLAN]: planMd(2), [LIST]: filesTsv(change) })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await treeKeys(pane)).toEqual([])
  await pane.unmount()
})

test('during review the tree joins the recorded change with the findings of the round on show', async ($, on) => {
  const list = filesTsv([fileRow('M', '40', '2', 'app/report.py', '1'), fileRow('A', '5', '0', 'app/util.py')])
  const task = (rounds: (string | null)[], o: TreeFixture = {}) => ({ ...inRounds(rounds, { extra: builtSteps(1), ...o }), [PLAN]: planMd(1), [LIST]: list })
  const kept = survivorsMd(impAt('app/report.py:42'), nitAt('app/cli.py:3'))
  const files: Record<string, string> = task([kept])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in round 1$/ })).toBeDefined()
  // The finding on a recorded file sits under its row; the one on a file the list doesn't hold still shows.
  expect(await treeKeys(pane)).toEqual([`${TREE}app/`, `${TREE}app/cli.py`, `${TREE}app/cli.py:3#0`, `${TREE}app/report.py`, `${TREE}app/report.py:42#0`, `${TREE}app/util.py`])
  expect(await rowOf(pane, `${TREE}app/`)).toMatch(/ 3 files {5}✗1  n1$/)
  expect(await rowOf(pane, `${TREE}app/report.py`)).toMatch(/^✓ M {5}report\.py +\+40 −2 s1  ✗1 {4}$/)
  expect(await rowOf(pane, `${TREE}app/report.py:42#0`)).toMatch(/✗ :42 Unescaped CSV fields$/)
  expect(await rowOf(pane, `${TREE}app/cli.py`)).toMatch(/^ {8}cli\.py +n1$/)
  expect(await rowOf(pane, `${TREE}app/util.py`)).toMatch(/^\* A {5}util\.py +unplanned +\+5 {11}$/)
  await pane.unmount()

  // Before any round has voted, the header is the Build one.
  await reload($, files, task([null]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^1 of 1 planned file changed · 1 unplanned$/ })).toBeDefined()
  expect(await treeKeys(pane)).toEqual([`${TREE}app/`, `${TREE}app/report.py`, `${TREE}app/util.py`])
  await pane.unmount()

  // HALTED during blind test: the Review tree, under the blind-test rows.
  await reload($, files, task([kept], { status: 'HALTED', extra: `${builtSteps(1)}blind_runs: 1\n` }))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /Blind test, run 1/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in round 1$/ })).toBeDefined()
  expect(await rowOf(pane, `${TREE}app/report.py`)).toMatch(/^✓ M {5}report\.py +\+40 −2 s1  ✗1 {4}$/)
  await pane.unmount()
})

test('past 15 files clean folders start folded and folders with problems stay open', async ($, on) => {
  const SURVIVORS_AT = '.tasks/export-csv/review/round-1/survivors.md'
  const mtimes: Record<string, number> = { [SURVIVORS_AT]: VOTED_BEFORE }
  // bad/ holds an open nit, fix/ an IMPORTANT whose file the fix changed (↻), odd/ an unplanned file; clean/ nothing.
  const task = (clean: number) => ({
    ...inRounds([survivorsMd(nitAt('bad/x.ts:1'), impAt('fix/r.ts:2'))], { extra: builtSteps(1) }),
    [PLAN]: planMd(1),
    [LIST]: filesTsv([
      fileRow('M', '1', '0', 'bad/x.ts', '1', '0'),
      ...Array.from({ length: clean }, (_, i) => fileRow('M', '1', '0', `clean/f${String(i).padStart(2, '0')}.ts`, '1', '0')),
      fileRow('M', '1', '0', 'fix/r.ts', '1', '1'),
      fileRow('M', '1', '0', 'odd/u.ts', '-', '0'),
    ], { since: 'def456' }),
  })
  const leads = async (pane: Drawn) => Promise.all(['bad/', 'clean/', 'fix/', 'odd/'].map(async f => /^ *([▾▸])/.exec((await rowOf(pane, `${TREE}${f}`)) ?? '')?.[1]))
  // 15 files: every folder starts open, as today.
  const files: Record<string, string> = task(12)
  world(on, files, '/repo', mtimes)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await leads(pane)).toEqual(['▾', '▾', '▾', '▾'])
  expect(await pane.find({ type: 'Box', key: 'export-csv:tree-big' })).toBeUndefined()
  await pane.unmount()

  // 16 files: only clean/ starts folded, and the header says why.
  await reload($, files, task(13))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await leads(pane)).toEqual(['▾', '▸', '▾', '▾'])
  expect((await pane.find({ type: 'Box', key: 'export-csv:tree-big' }))?.text).toBe('clean folders folded (15+ files)')
  expect(await rowOf(pane, `${TREE}fix/`)).toMatch(/↻1/)
  expect(await pane.find({ type: 'Button', key: `${TREE}clean/f00.ts` })).toBeUndefined()
  // A press opens it, and the choice is kept across a refresh.
  await pane.press({ key: `${TREE}clean/` })
  expect(await pane.find({ type: 'Button', key: `${TREE}clean/f00.ts` })).toBeDefined()
  await pane.unmount()
  await reload($, files, task(13))
  pane = await $.ui.mount(ON_TERMINAL)
  expect((await leads(pane))[1]).toBe('▾')
  expect(await pane.find({ type: 'Button', key: `${TREE}clean/f00.ts` })).toBeDefined()
  await pane.unmount()

  // Recorded in the second round 1 voted, but before its survivors.md: no ↻, and fix/ stays open for its ✗.
  mtimes[SURVIVORS_AT] = RECORDED * 1000 + 500
  await reload($, files, task(13))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}fix/`)).toMatch(/✗1/)
  expect(await rowOf(pane, `${TREE}fix/`)).not.toMatch(/↻/)
  expect((await leads(pane))[2]).toBe('▾')
  await pane.unmount()
})

test('no file row is wider than the card with every column and icons', { options: { file_icons: 'nerd' } }, async ($, on) => {
  const long = `${'n'.repeat(67)}.ts`
  const chain = 'first/alpha/bravo/charlie/delta/echo/foxtrot/golf/hotel/last'
  // Round 1's IMPORTANT on app/x.py is fixed in round 2 (✓); round 2 keeps an IMPORTANT (✗), one on a file the fix
  // changed (↻), a NIT, and a PRE-EXISTING.
  const r2 = survivorsMd(impAt(`${chain}/${long}:12`), nitAt(`${chain}/b.png:1`), preAt('lib/old.py:4'), impAt('app/r.ts:5', 'Ignored argument'))
  const files = {
    ...inRounds([survivorsMd(impAt('app/x.py:3')), r2], { extra: builtSteps(1, 2, 3) }),
    [PLAN]: planMd(12),
    [LIST]: filesTsv([
      fileRow('M', '3', '1', 'app/r.ts', '2', '1'),
      fileRow('M', '2', '0', 'app/x.py', '1', '0'),
      fileRow('M', 'bin', 'bin', `${chain}/b.png`, '3', '0'),
      fileRow('M', '12345', '6789', `${chain}/${long}`, '12', '0'),
      fileRow('M', '1', '1', 'lib/old.py', '-', '0'),
    ], { since: 'def456' }),
  }
  world(on, files, '/repo', { '.tasks/export-csv/review/round-2/survivors.md': VOTED_BEFORE })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'vscode'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    const buttons = await treeButtons(pane)
    const boxes = (await pane.findAll({ type: 'Box' })).filter(b => /:tree-(header|big|key-\d+)$/.test(b.key ?? ''))
    expect(buttons.some(b => PUA.test(b.text))).toBe(surface === 'terminal')
    for (const l of [...buttons.map(b => b.text), ...boxes.map(b => b.text)]) expect(cols(l)).toBeLessThanOrEqual(46)
    const fileRows = buttons.filter(b => /\.(ts|py|png)$/.test(b.key ?? ''))
    expect(fileRows).toHaveLength(5)
    for (const m of ['✗1', '↻1', '✓1', 'n1', 'p1']) expect(fileRows.some(b => b.text.includes(m))).toBe(true)
    // Each ends with its marks, and keeps at least 4 columns of its name.
    for (const b of fileRows) {
      expect(b.text).toMatch(/[✗↻✓np]\d+ *$/)
      const key = b.key ?? ''
      const name = bare(b.text).slice(4).replace(/^[\s▸▾]+/, '').split(' ')[0] ?? ''
      expect(cols(name)).toBeGreaterThanOrEqual(4)
      expect(name === key.slice(key.lastIndexOf('/') + 1) || name.includes('…')).toBe(true)
    }
    await pane.unmount()
  }
})

// Three recorded files, `+99 −4` in all: a.ts and the unplanned d.ts modified, b.ts added.
const THREE = [fileRow('M', '86', '3', 'src/a.ts', '1'), fileRow('A', '12', '0', 'src/b.ts', '1'), fileRow('M', '1', '1', 'src/d.ts')]
const FILES_ROW = 'export-csv:files'
const footprintOf = async (pane: Drawn) => (await pane.find({ type: 'Box', key: 'footprint' }))?.text

test('the dashboard reads files.tsv from .tasks only, and a missing or malformed list is no list', async ($, on) => {
  const good = filesTsv([fileRow('M', '2', '1', 'src/a.ts', '1'), fileRow('A', '5', '0', 'src/b.ts', '1')])
  const task = (list: string | null) => ({ ...inRounds([survivorsMd(nitAt('src/a.ts:1'))], { extra: builtSteps(1) }), [PLAN]: planMd(1), ...(list === null ? {} : { [LIST]: list }) })
  const files: Record<string, string> = task(good)
  const seen = world(on, files)
  const calls: string[][] = []
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/b.ts`)).toMatch(/^✓ A {5}b\.ts +\+5 s1 {8}$/)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/^✓ M /)
  expect(await footprintOf(pane)).toBe('2 files · +7 −1 · 1 nit')
  await pane.unmount()

  // Missing, a bad header, or a row with 3 fields: no file rows, no footprint, and bundle 13's findings tree.
  for (const list of [null, good.replace('# quorum-files 1 ', '# quorum-files 2 '), `${good}M\t1\tsrc/c.ts\n`]) {
    await reload($, files, task(list))
    pane = await $.ui.mount(ON_TERMINAL)
    expect(await pane.find({ type: 'Button', key: `${TREE}src/b.ts` })).toBeUndefined()
    expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/^ +a\.ts +n1$/)
    expect(await footprintOf(pane)).toBeUndefined()
    await pane.unmount()
  }
  // Every read is under .tasks/ or git's own files, the list was one of them, and no git ran.
  expect(seen.reads).toContain('/repo/.tasks/export-csv/files.tsv')
  expect(seen.reads.filter(p => !/^\/repo\/\.(tasks|git)(\/|$)/.test(p))).toEqual([])
  expect(calls.filter(argv => argv[0] === 'git')).toEqual([])
})

test('after the review converges the files fold to one row that a press opens', async ($, on) => {
  const task = (status: string, extra = '') => ({ ...inRounds([survivorsMd(nitAt('src/a.ts:1'))], { status, extra: `${builtSteps(1)}${extra}` }), [PLAN]: planMd(1), [LIST]: filesTsv(THREE) })
  const files: Record<string, string> = task('AWAITING-HUMAN')
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Every stage is done: the Files row, folded, after the done text; no file rows.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^Every stage is done/ })).toBeDefined()
  expect(await rowOf(pane, FILES_ROW)).toBe('▸ Files  3 files · +99 −4 · 1 nit')
  expect(await treeKeys(pane)).toEqual([])
  await pane.unmount()

  // CONVERGED: the Files row replaces the Review tree, under the round's rows.
  await reload($, files, task('CONVERGED'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^✓ Verifier vote\s+kept n1 → converges$/ })).toBeDefined()
  expect(await rowOf(pane, FILES_ROW)).toBe('▸ Files  3 files · +99 −4 · 1 nit')
  expect(await treeKeys(pane)).toEqual([])
  expect(await pane.find({ type: 'Text', text: /^the verifier kept/ })).toBeUndefined()
  await pane.unmount()

  // BLIND-TEST, after the blind run's rows: a press opens the Review tree, and the choice survives a refresh.
  await reload($, files, task('BLIND-TEST', 'blind_runs: 1\n'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /Blind test, run 1/ })).toBeDefined()
  expect(await rowOf(pane, FILES_ROW)).toBe('▸ Files  3 files · +99 −4 · 1 nit')
  expect(await treeKeys(pane)).toEqual([])
  await pane.press({ key: FILES_ROW })
  expect(await rowOf(pane, FILES_ROW)).toBe('▾ Files  3 files · +99 −4 · 1 nit')
  expect(await pane.find({ type: 'Text', text: /^the verifier kept these in round 1$/ })).toBeDefined()
  expect(await treeKeys(pane)).toEqual([`${TREE}src/`, `${TREE}src/a.ts`, `${TREE}src/a.ts:1#0`, `${TREE}src/b.ts`, `${TREE}src/d.ts`])
  await pane.unmount()
  await reload($, files, task('BLIND-TEST', 'blind_runs: 1\n'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, FILES_ROW)).toMatch(/^▾ Files/)
  expect(await treeKeys(pane)).toContain(`${TREE}src/a.ts`)
  await pane.press({ key: FILES_ROW })
  expect(await treeKeys(pane)).toEqual([])
  await pane.unmount()

  // HALTED: the full tree, and no Files row.
  await reload($, files, task('HALTED'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Button', key: FILES_ROW })).toBeUndefined()
  expect(await treeKeys(pane)).toContain(`${TREE}src/a.ts:1#0`)
  await pane.unmount()

  // Spec: no tree, and no Files row.
  await reload($, files, task('DRAFT-AWAITING-VISUAL-SIGNOFF'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Button', key: FILES_ROW })).toBeUndefined()
  expect(await treeKeys(pane)).toEqual([])
  await pane.unmount()
})

test('file tree edge cases: an empty list, only planned files, a deleted file with a finding, and a path with a space', async ($, on) => {
  // An empty list: no file rows; with base set and no vote, 0 files; before the build, no footprint.
  const files: Record<string, string> = { ...inRounds([], { status: 'BUILDING' }), [LIST]: filesTsv([]) }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await treeKeys(pane)).toEqual([])
  expect(await footprintOf(pane)).toBe('0 files · not reviewed yet')
  await pane.unmount()
  await reload($, files, { ...inRounds([], { status: 'BUILDING' }), [LIST]: filesTsv([], { base: '-' }) })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await treeKeys(pane)).toEqual([])
  expect(await footprintOf(pane)).toBeUndefined()
  await pane.unmount()

  // Only planned files, before any change: every row ○, its letter dim, and no counts.
  await reload($, files, {
    ...inRounds([], { status: 'BUILDING' }),
    [PLAN]: planMd(2),
    [LIST]: filesTsv([fileRow('M', '-', '-', 'app/report.py', '1'), fileRow('A', '-', '-', 'app/new.py', '2')]),
  })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/report.py`)).toMatch(/^○ M {5}report\.py +s1$/)
  expect(await rowOf(pane, `${TREE}app/new.py`)).toMatch(/^○ A {5}new\.py +s2$/)
  expect((await partOf(pane, `${TREE}app/report.py`, 'M'))?.props?.dimColor).toBe(true)
  expect((await partOf(pane, `${TREE}app/new.py`, 'A'))?.props?.dimColor).toBe(true)
  expect(await footprintOf(pane)).toBe('0 files · not reviewed yet')
  await pane.unmount()

  // A deleted file with a finding: D with its removed count, and the finding under it.
  await reload($, files, {
    ...inRounds([survivorsMd(impAt('app/gone.py:4'))], { extra: builtSteps(1) }),
    [PLAN]: planMd(1),
    [LIST]: filesTsv([fileRow('D', '0', '5', 'app/gone.py', '1')]),
  })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await treeKeys(pane)).toEqual([`${TREE}app/`, `${TREE}app/gone.py`, `${TREE}app/gone.py:4#0`])
  expect(await rowOf(pane, `${TREE}app/gone.py`)).toMatch(/^✓ D {5}gone\.py +−5 s1 {6}✗1$/)
  expect(await rowOf(pane, `${TREE}app/gone.py:4#0`)).toMatch(/✗ :4 Unescaped CSV fields$/)
  await pane.unmount()

  // A path with a space and unicode renders as written.
  await reload($, files, { ...inRounds([], { status: 'BUILDING', extra: builtSteps(1) }), [PLAN]: planMd(1), [LIST]: filesTsv([fileRow('A', '3', '0', 'docs/café notes.md', '1')]) })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}docs/café notes.md`)).toMatch(/^✓ A {5}café notes\.md +\+3 s1$/)
  expect(await footprintOf(pane)).toBe('1 file · +3 · not reviewed yet')
  await pane.unmount()
})

test('a kept important finding whose file changed since the round shows as awaiting re-review', async ($, on) => {
  const R1 = '.tasks/export-csv/review/round-1/survivors.md'
  const R2 = '.tasks/export-csv/review/round-2/survivors.md'
  // round 1's survivors.md was written 5 seconds before the list was recorded.
  const mtimes: Record<string, number> = { [R1]: VOTED_BEFORE, [R2]: VOTED_BEFORE }
  const kept = survivorsMd(impAt('src/a.ts:3'))
  const task = (rounds: (string | null)[], fix: string, status?: string) => {
    const t: Record<string, string> = {
      ...inRounds(rounds, { status, extra: builtSteps(1) }),
      [PLAN]: planMd(1),
      [LIST]: filesTsv([fileRow('M', '4', '1', 'src/a.ts', '1', fix), fileRow('M', '1', '0', 'src/b.ts', '1', '0')], { since: 'def456' }),
    }
    // Logic raised round 1's IMPORTANT.
    t['.tasks/export-csv/review/round-1/logic.md'] = kept
    return t
  }
  const label = async (pane: Drawn, key: string) => (await pane.find({ type: 'Button', key }))?.props.label as string | undefined
  const voter = async (pane: Drawn) => (await pane.find({ type: 'Text', text: /^\S Verifier vote/ }))?.text
  const logic = async (pane: Drawn) => (await pane.find({ type: 'Text', text: /^\S Logic & edge cases/ }))?.text
  const files: Record<string, string> = task([kept], '1')
  world(on, files, '/repo', mtimes)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  // Round 1's fix changed a.ts after the vote: ↻, in the finding row, the key, the labels, and the voter's verdict.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts:3#0`)).toMatch(/^\s*↻ :3 Unescaped CSV fields$/)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/ s1 {6}↻1$/)
  expect((await pane.find({ type: 'Box', key: 'export-csv:tree-key-0' }))?.text).toBe('key: ↻ awaiting re-review')
  expect(await label(pane, `${TREE}src/a.ts`)).toContain('1 awaiting re-review')
  expect(await label(pane, `${TREE}src/`)).toContain('1 awaiting re-review')
  expect(await label(pane, `${TREE}src/a.ts:3#0`)).toContain('awaiting re-review')
  expect(await voter(pane)).toMatch(/^↻ Verifier vote\s+kept ↻1 → re-review$/)
  expect((await pane.find({ type: 'Text', text: /^↻1$/ }))?.props.color).toBe('warning')
  // During round 1's fix, the reviewer that raised it says so, with the • glyph.
  expect(await logic(pane)).toMatch(/^• Logic & edge cases\s+↻1 found ✗1$/)
  // The footprint counts it as awaiting re-review too, not as important.
  expect(await footprintOf(pane)).toBe('2 files · +5 −1 · 1 awaiting re-review')
  expect((await pane.find({ type: 'Text', text: /^1 awaiting re-review$/ }))?.props.color).toBe('warning')
  await pane.unmount()

  // So does the folded Files row from Blind test on.
  await reload($, files, task([kept], '1', 'CONVERGED'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await label(pane, FILES_ROW)).toBe('Files, 2 files, 5 lines added, 1 removed, 1 awaiting re-review, folded')
  await pane.unmount()

  // Round 2 starts reviewing with no vote yet: the voter row keeps round 1's verdict, labelled, and the reviewer
  // rows are round 2's own.
  await reload($, files, task([kept, null], '1'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await voter(pane)).toMatch(/^↻ Verifier vote\s+round 1: kept ↻1 → re-review$/)
  expect(await logic(pane)).toMatch(/^✓ Logic & edge cases\s+clean$/)
  await pane.unmount()

  // FIX 0: the fix didn't touch a.ts, so it's ✗ and a fix round; in round 2 with no vote, the voter waits.
  await reload($, files, task([kept], '0'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts:3#0`)).toMatch(/^\s*✗ :3 /)
  expect(await voter(pane)).toMatch(/^✗ Verifier vote\s+kept ✗1 → fix round$/)
  expect(await logic(pane)).toMatch(/^✗ Logic & edge cases\s+✗1$/)
  expect(await footprintOf(pane)).toBe('2 files · +5 −1 · 1 important')
  expect(await pane.find({ type: 'Text', text: /awaiting re-review/ })).toBeUndefined()
  await pane.unmount()
  await reload($, files, task([kept, null], '0'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await voter(pane)).toMatch(/^○ Verifier vote\s+waiting$/)
  await pane.unmount()

  // Recorded in the second round 1 voted, but before its survivors.md was written: no ↻ (a gate that compares
  // seconds with milliseconds would say there is).
  mtimes[R1] = RECORDED * 1000 + 500
  await reload($, files, task([kept], '1'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts:3#0`)).toMatch(/^\s*✗ :3 /)
  expect(await voter(pane)).toMatch(/^✗ Verifier vote\s+kept ✗1 → fix round$/)
  await pane.unmount()

  // Round 2 kept the IMPORTANT again after the list was recorded: ✗ and a fix round, though FIX is 1.
  mtimes[R1] = VOTED_BEFORE
  mtimes[R2] = RECORDED * 1000 + 5000
  await reload($, files, task([kept, kept], '1'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts:3#0`)).toMatch(/^\s*✗ :3 /)
  expect(await voter(pane)).toMatch(/^✗ Verifier vote\s+kept ✗1 → fix round$/)
  await pane.unmount()

  // One fixed (✓, round 1's :9) and one awaiting re-review (↻, round 2's :3) on the same file.
  mtimes[R2] = VOTED_BEFORE
  await reload($, files, task([survivorsMd(impAt('src/a.ts:3'), impAt('src/a.ts:9', 'Wrong env var')), kept], '1'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}src/a.ts`)).toMatch(/↻1  ✓1$/)
  expect(await label(pane, `${TREE}src/a.ts`)).toContain('1 awaiting re-review, 1 fixed')
  expect((await pane.find({ type: 'Box', key: 'export-csv:tree-key-0' }))?.text).toBe('key: ↻ awaiting re-review  ✓ fixed this run')
  expect(await voter(pane)).toMatch(/^↻ Verifier vote\s+kept ↻1 → re-review$/)
  await pane.unmount()
})

// ---- Security findings in the tree

// A kept IMPORTANT with a `Security: <kind>` line under its header.
const secAt = (loc: string, title: string, kind = 'injection') => `${impAt(loc, title)}\nSecurity: ${kind}`
// A tree row's drawn parts, each a Text inside its Button's Text: its text and its props.
type Part = { children?: unknown[]; props?: Record<string, unknown> }
const partsAt = async (pane: Drawn, key: string) =>
  (((await pane.find({ type: 'Button', key }))?.children[0] as Part | undefined)?.children ?? [] as unknown[])
    .map(c => ({ text: ((c as Part).children ?? []).join(''), props: (c as Part).props ?? {} }))
const labelAt = async (pane: Drawn, key: string) => (await pane.find({ type: 'Button', key }))?.props.label as string | undefined
const treeKeyLine = async (pane: Drawn, id = 'export-csv') => (await pane.find({ type: 'Box', key: `${id}:tree-key-0` }))?.text

test('a security finding shows its word, a ! on the counts above it, and the key', async ($, on) => {
  const R1 = '.tasks/export-csv/review/round-1/survivors.md'
  const two = survivorsMd(impAt('app/report.py:42'), secAt('app/report.py:44', 'CSV formula injection'))
  const files = inRounds([two])
  world(on, files, '/repo', { [R1]: VOTED_BEFORE })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  // The finding row: `security` in error before its title, and its kind in the label.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/report.py:44#0`)).toMatch(/✗ :44 security CSV formula injection$/)
  expect((await partsAt(pane, `${TREE}app/report.py:44#0`)).find(p => p.text === 'security ')?.props.color).toBe('error')
  expect(await labelAt(pane, `${TREE}app/report.py:44#0`)).toContain('CSV formula injection, security: injection')
  expect(await rowOf(pane, `${TREE}app/report.py:42#0`)).toMatch(/✗ :42 Unescaped CSV fields$/)
  // The file and folder above it: `✗2!`, the ! in error, and the count in words.
  expect(await rowOf(pane, `${TREE}app/report.py`)).toMatch(/ ✗2!$/)
  expect(await rowOf(pane, `${TREE}app/`)).toMatch(/ ✗2!$/)
  expect((await partsAt(pane, `${TREE}app/report.py`)).find(p => p.text === '!')?.props.color).toBe('error')
  expect(await labelAt(pane, `${TREE}app/report.py`)).toContain('2 important, 1 of them security')
  expect(await labelAt(pane, `${TREE}app/`)).toContain('2 important, 1 of them security')
  expect(await treeKeyLine(pane)).toBe('key: ✗ important  ! security')
  await pane.unmount()

  // The builder's fix is awaiting re-review (the list is newer than the round's survivors): `↻2!`.
  const awaiting = {
    ...inRounds([two], { extra: builtSteps(1) }),
    [PLAN]: planMd(1),
    [LIST]: filesTsv([fileRow('M', '4', '1', 'app/report.py', '1', '1')], { since: 'def456' }),
  }
  await reload($, files, awaiting)
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/report.py`)).toMatch(/ ↻2!$/)
  expect(await rowOf(pane, `${TREE}app/`)).toMatch(/ ↻2!$/)
  expect(await labelAt(pane, `${TREE}app/report.py`)).toContain('2 awaiting re-review, 1 of them security')
  expect(await treeKeyLine(pane)).toBe('key: ↻ awaiting re-review  ! security')
  await pane.unmount()

  // Without the Security: line, no ! and no word, and the key has no `! security`.
  const plain = survivorsMd(impAt('app/report.py:42'), impAt('app/report.py:44', 'CSV formula injection'))
  await reload($, files, inRounds([plain]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect((await allRows(pane)).some(t => t.includes('!') || t.includes('security'))).toBe(false)
  expect(await treeKeyLine(pane)).toBe('key: ✗ important')
  await pane.unmount()

  // A Unicode kind is read verbatim into the label.
  await reload($, files, inRounds([survivorsMd(secAt('app/report.py:44', 'CSV formula injection', 'injection — “quoted”'))]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await labelAt(pane, `${TREE}app/report.py:44#0`)).toContain('security: injection — “quoted”')
  await pane.unmount()

  // A NIT with a Security: line shows the word, but only IMPORTANT counts get a !, so no key entry either.
  await reload($, files, inRounds([survivorsMd(`${nitAt('app/report.py:7')}\nSecurity: injection`)]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/report.py:7#0`)).toMatch(/n :7 security Naming$/)
  expect(await rowOf(pane, `${TREE}app/report.py`)).not.toContain('!')
  expect(await rowOf(pane, `${TREE}app/`)).not.toContain('!')
  expect(await treeKeyLine(pane)).toBe('key: n nit')
  await pane.unmount()

  // An IMPORTANT with no file:line goes under `other`, with the word and `✗1!`.
  await reload($, files, inRounds([survivorsMd('[IMPORTANT] Pattern Category: No auth\nSecurity: auth bypass')]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}:other`)).toMatch(/other +✗1!$/)
  expect(await rowOf(pane, `${TREE}:other:#0`)).toMatch(/✗ \(no location\) security No auth$/)
  expect(await labelAt(pane, `${TREE}:other:#0`)).toContain('with no location: No auth, security: auth bypass')
  await pane.unmount()

  // A Security: line after a blank line and a prose line belongs to no finding.
  await reload($, files, inRounds([survivorsMd(`${impAt('app/report.py:44', 'CSV formula injection')}\n\nThe export is fine otherwise.\nSecurity: injection`)]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect((await allRows(pane)).some(t => t.includes('!') || t.includes('security'))).toBe(false)
  await pane.unmount()

  // Read as quorum-findings reads it: a key line after a blank line still belongs to the finding; an empty kind is
  // no kind, and the first kind stands.
  expect(keptFindings('[IMPORTANT] a.py:1 — Pattern Category: X\nConfidence: 90\n\nSecurity: xss\nSecurity: other\n').map(f => f.security)).toEqual(['xss'])
  expect(keptFindings('[IMPORTANT] a.py:1 — Pattern Category: X\nSecurity:   \n').map(f => f.security)).toEqual([null])
  expect(keptFindings('[IMPORTANT] a.py:1 — Pattern Category: X\n## Dropped\nSecurity: xss\n').map(f => f.security)).toEqual([null])
})

test('a fixed or dropped security finding keeps its word muted and adds no !', async ($, on) => {
  // Round 2 no longer keeps round 1's security finding: fixed.
  const files = inRounds([survivorsMd(impAt('app/report.py:42'), secAt('app/report.py:44', 'CSV formula injection')), survivorsMd(impAt('app/report.py:42'))])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/report.py:44#0`)).toMatch(/✓ :44 security round 1 → fixed by round/)
  const fixed = (await partsAt(pane, `${TREE}app/report.py:44#0`)).find(p => p.text === 'security ')
  expect(fixed?.props.dimColor).toBe(true)
  expect(fixed?.props.color).toBeUndefined()
  expect(await rowOf(pane, `${TREE}app/report.py`)).toMatch(/ ✗1 {2}✓1$/)
  expect(await rowOf(pane, `${TREE}app/`)).not.toContain('!')
  expect(await labelAt(pane, `${TREE}app/report.py`)).not.toContain('security')
  expect(await treeKeyLine(pane)).toBe('key: ✗ important  ✓ fixed this run')
  await pane.unmount()

  // Dropped on dispute in round 1: dim throughout, the word included, and no !.
  const drop = { 1: 'DROP [IMPORTANT] app/x.py:3 — (b) handled by the caller\n' }
  await reload($, files, inRounds([survivorsMd(secAt('app/x.py:3', 'SQL injection')), survivorsMd(nitAt('lib/z.py:5'))], { disputes: drop }))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}app/x.py:3#0`)).toMatch(/^ {6}· :3 security dropped on dispute in/)
  const parts = await partsAt(pane, `${TREE}app/x.py:3#0`)
  expect(parts.find(p => p.text === 'security ')?.props.dimColor).toBe(true)
  expect(parts.every(p => p.props.dimColor === true)).toBe(true)
  expect((await allRows(pane)).some(t => t.includes('!'))).toBe(false)
  expect(await treeKeyLine(pane)).toBe('key: n nit')
  await pane.unmount()
})

test('the security marks fit at 50 columns and line up', { options: { file_icons: 'nerd' } }, async ($, on) => {
  const kept = survivorsMd(secAt('app/export/report.py:44', 'CSV formula injection in every exported cell'), impAt('lib/util.py:9', 'Unescaped CSV fields in the header row'))
  const files = inRounds([kept])
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const check = async () => {
    const pane = await $.ui.mount(ON_TERMINAL)
    for (const t of await allRows(pane)) expect(cols(t)).toBeLessThanOrEqual(46)
    const a = [...(await rowOf(pane, `${TREE}app/export/report.py`) ?? '')]
    const b = [...(await rowOf(pane, `${TREE}lib/util.py`) ?? '')]
    // Measured in columns: an icon is two.
    const at = (cs: string[]) => cols(cs.slice(0, cs.indexOf('✗')).join(''))
    expect(at(a)).toBeGreaterThan(0)
    expect(at(a)).toBe(at(b))
    expect(a[a.indexOf('✗') + 2]).toBe('!')
    expect(b[b.indexOf('✗') + 2]).toBe(' ')
    expect(cols(a.join(''))).toBe(cols(b.join('')))
    await pane.unmount()
  }
  await check()
  // With the recorded change's columns too.
  await reload($, files, {
    ...inRounds([kept]),
    [LIST]: filesTsv([fileRow('M', '120', '45', 'app/export/report.py'), fileRow('A', '300', '0', 'lib/util.py')]),
  })
  await check()
})

test('the review card shows security findings the same way', async ($, on) => {
  const id = 'review-pr-12'
  const scope = `${id}:tree:`
  world(on, inRuns(id, 'REVIEWING', [{ end: 'b2b2b2b', survivors: survivorsMd(`${impAt('app/log.py:8', 'Token written to the log')}\nSecurity: secret in log`) }]))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${scope}app/log.py:8#0`)).toMatch(/✗ :8 security Token written to the log$/)
  expect(await labelAt(pane, `${scope}app/log.py:8#0`)).toContain('security: secret in log')
  expect(await rowOf(pane, `${scope}app/log.py`)).toMatch(/ ✗1!$/)
  expect(await treeKeyLine(pane, id)).toBe('key: ✗ important  ! security')
  await pane.unmount()
})

test('a plan-review security finding shows under the task folder', async ($, on) => {
  world(on, inRounds([survivorsMd('[IMPORTANT] .tasks/export-csv/plan.md:12 — Pattern Category: Auth bypass\nSecurity: auth bypass')], { dir: 'plan-review' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, `${TREE}.tasks/export-csv/`)).toMatch(/ ✗1!$/)
  expect(await rowOf(pane, `${TREE}.tasks/export-csv/plan.md`)).toMatch(/ ✗1!$/)
  expect(await rowOf(pane, `${TREE}.tasks/export-csv/plan.md:12#0`)).toMatch(/✗ :12 security Auth bypass$/)
  expect(await treeKeyLine(pane)).toBe('key: ✗ important  ! security')
  await pane.unmount()
})

test('the task card shows the footprint line, not reviewed yet before a vote, and as of when the list is old', async ($, on) => {
  const HEAD_REF = '.git/refs/heads/feat/export-csv'
  // README.md is planned and not changed yet, so it isn't counted.
  const rows = [...THREE, fileRow('M', '-', '-', 'README.md', '2')]
  const task = (rounds: string[], o: TreeFixture = {}, list: string | null = filesTsv(rows), head = 'c'.repeat(40)) => ({
    ...inRounds(rounds, o), [PLAN]: planMd(2), [HEAD_REF]: `${head}\n`, ...(list === null ? {} : { [LIST]: list }),
  })
  const files: Record<string, string> = task([], { status: 'BUILDING' })
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await footprintOf(pane)).toBe('3 files · +99 −4 · not reviewed yet')
  expect((await pane.find({ type: 'Text', text: /^not reviewed yet$/ }))?.props.dimColor).toBe(true)
  await pane.unmount()

  // A code round voted, keeping an IMPORTANT and a NIT.
  await reload($, files, task([survivorsMd(impAt('src/a.ts:3'), nitAt('src/b.ts:1'))]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await footprintOf(pane)).toBe('3 files · +99 −4 · 1 important · 1 nit')
  expect((await pane.find({ type: 'Text', text: /^1 important$/ }))?.props.color).toBe('error')
  expect((await pane.find({ type: 'Text', text: /^1 nit$/ }))?.props.dimColor).toBe(true)
  await pane.unmount()

  // One that kept nothing.
  await reload($, files, task([NOTHING_KEPT]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await footprintOf(pane)).toBe('3 files · +99 −4 · no findings')
  expect((await pane.find({ type: 'Text', text: /^no findings$/ }))?.props.color).toBe('success')
  await pane.unmount()

  // HEAD moved on since the list was recorded.
  await reload($, files, task([NOTHING_KEPT], {}, filesTsv(rows), 'd'.repeat(40)))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await footprintOf(pane)).toBe('3 files · +99 −4 · no findings · as of ccccccc')
  await pane.unmount()

  // A list with base set whose rows are all planned-only.
  await reload($, files, task([], { status: 'BUILDING' }, filesTsv([fileRow('M', '-', '-', 'README.md', '2')])))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await footprintOf(pane)).toBe('0 files · not reviewed yet')
  await pane.unmount()

  // No list, or the Plan stage's list with base=-: no footprint line.
  await reload($, files, task([], { status: 'BUILDING' }, null))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await footprintOf(pane)).toBeUndefined()
  await pane.unmount()
  await reload($, files, task([NOTHING_KEPT], { dir: 'plan-review' }, filesTsv(rows.map(r => r.replace(/^(\w)\t\w+\t\w+\t/, '$1\t-\t-\t')), { base: '-' })))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /Plan review, round 1 of 2/ })).toBeDefined()
  expect(await footprintOf(pane)).toBeUndefined()
  await pane.unmount()
})

test('the band shows the file count at 110 columns or more', async ($, on) => {
  const files: Record<string, string> = { ...inRounds([], { status: 'BUILDING' }), [LIST]: filesTsv(THREE) }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const band = async (bodyColumns: number) => {
    const b = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'terminal' })
    const count = await b.find({ type: 'Text', text: /^3 files$/ })
    await b.unmount()
    return count
  }
  expect((await band(120))?.props.dimColor).toBe(true)
  expect(await band(110)).toBeDefined()
  expect(await band(100)).toBeUndefined()
  // No list, no count.
  await reload($, files, inRounds([], { status: 'BUILDING' }))
  expect(await band(120)).toBeUndefined()
})

test('file rows and the files row are labelled in words and the key names the lead marks', async ($, on) => {
  const rows = [fileRow('M', '86', '3', 'src/a.ts', '1'), fileRow('R', '12', '0', 'b.ts', '1', '-', 'old.ts'), fileRow('M', '1', '1', 'src/d.ts')]
  const task = (status?: string) => ({ ...inRounds([survivorsMd(nitAt('src/a.ts:1'))], { status, extra: builtSteps(1) }), [PLAN]: planMd(1), [LIST]: filesTsv(rows) })
  const files: Record<string, string> = task()
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const label = async (pane: Drawn, key: string) => (await pane.find({ type: 'Button', key }))?.props.label as string | undefined
  let pane = await $.ui.mount(ON_TERMINAL)
  const a = await label(pane, `${TREE}src/a.ts`) ?? ''
  for (const w of ['step 1 built', 'modified', '86 lines added, 3 removed', '1 nit']) expect(a).toContain(w)
  expect(await label(pane, `${TREE}b.ts`)).toContain('renamed from old.ts')
  expect(await label(pane, `${TREE}src/d.ts`)).toContain('unplanned')
  // The lead marks' key, on its own line after the finding marks', names only the marks shown (no ○ here).
  const keys = (await pane.findAll({ type: 'Box' })).filter(b => /:tree-key-\d+$/.test(b.key ?? '')).map(b => b.text)
  expect(keys).toEqual(['key: n nit', 'key: ✓ built  * unplanned'])
  expect((await partOf(pane, `${TREE}src/a.ts`, '✓'))?.props?.color).toBe('success')
  expect((await partOf(pane, `${TREE}src/a.ts`, '+86'))?.props?.color).toBe('success')
  await pane.unmount()

  // The folded Files row spells out its footprint and its state.
  await reload($, files, task('CONVERGED'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await label(pane, FILES_ROW)).toBe('Files, 3 files, 99 lines added, 4 removed, 1 nit, folded')
  await pane.press({ key: FILES_ROW })
  expect(await label(pane, FILES_ROW)).toBe('Files, 3 files, 99 lines added, 4 removed, 1 nit, open')
  await pane.unmount()
})

test('every file row and the files row is a button a key press reaches', async ($, on) => {
  const task = (status?: string) => ({ ...inRounds([survivorsMd(nitAt('src/a.ts:1'))], { status, extra: builtSteps(1) }), [PLAN]: planMd(1), [LIST]: filesTsv(THREE) })
  const files: Record<string, string> = task()
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const reach = async (pane: Drawn & { press: (q: { key: string }) => Promise<unknown> }, key: string) => {
    const before = await pane.find({ type: 'Button', key })
    expect(typeof before?.props.label).toBe('string')
    expect((before?.props.label as string).trim()).not.toBe('')
    await pane.press({ key })
  }
  let pane = await $.ui.mount(ON_TERMINAL)
  // A clean file row, a file row with a finding, and a folder row.
  for (const key of [`${TREE}src/b.ts`, `${TREE}src/a.ts`, `${TREE}src/`]) await reach(pane, key)
  await pane.unmount()
  await reload($, files, task('CONVERGED'))
  pane = await $.ui.mount(ON_TERMINAL)
  await reach(pane, FILES_ROW)
  // Open, it shows the tree (src/ as the press above left it, folded).
  expect(await treeKeys(pane)).toEqual([`${TREE}src/`])
  await pane.unmount()
})

// ---- Plan steps in the Now card

// A plan whose steps name requirements and files, with indented lines and blank lines between steps. Step 1 spans
// lines 4-6, step 2 lines 8-9, step 3 lines 11-12; line 2 is before `## Steps`, and line 10 is between steps 2 and 3.
const STEPS_PLAN = [
  '# Plan',
  '',
  '## Steps',
  '1. **Read the rows** — `app/report.py` · requirements: 1, 2',
  '   - read each customer',
  '   - keep their order',
  '',
  '2. **Quote commas** — `app/util.py`, `README.md` · requirements: 2',
  '   - wrap a field with a comma in quotes',
  '',
  '3. **Docs** — `README.md`',
  '   - name export in README.md',
  '',
  '## Tests',
  '',
].join('\n')
// The planned files: step 1 names one, step 2 two, step 3 one.
const STEPS_FILES = [fileRow('M', '-', '-', 'app/report.py', '1'), fileRow('A', '-', '-', 'app/util.py', '2'), fileRow('M', '-', '-', 'README.md', '2,3')]
const STEP = 'export-csv:step:'
// A step row as drawn, found by its key only.
const stepRow = async (pane: Drawn, n: number) => (await pane.find({ key: `${STEP}${n}` }))?.text
const stepLabel = async (pane: Drawn, n: number) => ((await pane.find({ key: `${STEP}${n}` }))?.props?.label as string | undefined) ?? ''
const texts = async (pane: Drawn) => (await pane.findAll({ type: 'Text' })).map(x => x.text)

test('during Plan the Now card lists the steps with their files and requirements above the tree', async ($, on) => {
  const planning = (rounds: string[], extra: Record<string, string> = {}) =>
    ({ ...inRounds(rounds, { dir: 'plan-review' }), [PLAN]: STEPS_PLAN, ...extra })
  const files: Record<string, string> = planning([survivorsMd(impAt('.tasks/export-csv/plan.md:14', 'Plan skips the docs step'))], { [LIST]: filesTsv(STEPS_FILES, { base: '-' }) })
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  // Round 1: directly under the Now title and before the reviewer rows, a row per step and the hint; the tree's
  // header follows the voter row, so it doesn't read as the steps' header.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await stepRow(pane, 1)).toMatch(/^○ 1 Read the rows +1 file · req 1, 2$/)
  expect(await stepRow(pane, 2)).toMatch(/^○ 2 Quote commas +2 files · req 2 {3}$/)
  expect(await stepRow(pane, 3)).toMatch(/^○ 3 Docs +1 file {11}$/)
  for (const n of [1, 2, 3]) expect(cols((await stepRow(pane, n)) ?? '')).toBe(46)
  let all = await texts(pane)
  const title = all.findIndex(x => x.startsWith('Now · '))
  const header = all.indexOf('Plan steps')
  const hint = all.indexOf('press a step to highlight its files')
  const replied = all.findIndex(x => / replied$/.test(x))
  const voter = all.findIndex(x => /Verifier vote/.test(x))
  const tree = all.indexOf('3 steps · 3 files, 1 new')
  expect(title).toBeGreaterThan(-1)
  expect(all.slice(title + 1, header).every(x => all[title]?.includes(x))).toBe(true)
  expect(header).toBeGreaterThan(title)
  expect(hint).toBe(header + 1)
  expect(all.findIndex(x => /^○ 1 Read the rows/.test(x))).toBeGreaterThan(hint)
  expect(replied).toBeGreaterThan(all.findIndex(x => /^○ 3 Docs/.test(x)))
  expect(voter).toBeGreaterThan(replied)
  // The tree's header is the first row after the voter row's own texts.
  expect(tree).toBeGreaterThan(voter)
  expect(all.slice(voter + 1, tree).every(x => all[voter]?.includes(x))).toBe(true)
  await pane.unmount()

  // Before the first round: directly under the Now title, with no hint.
  await reload($, files, planning([], { [LIST]: filesTsv(STEPS_FILES, { base: '-' }) }))
  pane = await $.ui.mount(ON_TERMINAL)
  all = await texts(pane)
  const now = all.findIndex(x => x.startsWith('Now · '))
  expect(now).toBeGreaterThan(-1)
  expect(all.slice(now + 1, all.indexOf('Plan steps')).every(x => all[now]?.includes(x))).toBe(true)
  expect(all.indexOf('Plan steps')).toBeGreaterThan(now)
  expect(await pane.find({ type: 'Text', text: 'press a step to highlight its files' })).toBeUndefined()
  expect(await stepRow(pane, 1)).toMatch(/^○ 1 Read the rows +1 file · req 1, 2$/)
  await pane.unmount()

  // Without files.tsv: no files part; a step with no requirements has no req part.
  await reload($, files, planning([survivorsMd(impAt('.tasks/export-csv/plan.md:14', 'Plan skips the docs step'))]))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await stepRow(pane, 1)).toMatch(/^○ 1 Read the rows +req 1, 2$/)
  expect(await stepRow(pane, 2)).toMatch(/^○ 2 Quote commas +req 2 {3}$/)
  expect(await stepRow(pane, 3)).toMatch(/^○ 3 Docs *$/)
  await pane.unmount()

  // Spec has no plan yet, so no list, even with a plan.md on disk.
  await reload($, files, { ...inRounds([], { status: 'DRAFT-AWAITING-VISUAL-SIGNOFF' }), [PLAN]: STEPS_PLAN, [LIST]: filesTsv(STEPS_FILES, { base: '-' }) })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: 'Plan steps' })).toBeUndefined()
  expect(await stepRow(pane, 1)).toBeUndefined()
  await pane.unmount()
})

test('a plan finding is counted on the step whose lines include it', async ($, on) => {
  const at = (line: number) => `.tasks/export-csv/plan.md:${line}`
  world(on, {
    ...inRounds([survivorsMd(impAt(at(8), 'Quote rule'), nitAt(at(6), 'Order'), nitAt(at(10), 'Blank line'), nitAt(at(2), 'Title'))], { dir: 'plan-review' }),
    [PLAN]: STEPS_PLAN,
    [LIST]: filesTsv(STEPS_FILES, { base: '-' }),
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(ON_TERMINAL)
  // The IMPORTANT on step 2's number line, and the NIT on step 1's last indented line; the NITs on the blank line
  // between steps 2 and 3 and before ## Steps are on no step.
  expect(await stepRow(pane, 1)).toMatch(/^○ 1 Read the rows +n1 {3}1 file · req 1, 2$/)
  expect(await stepRow(pane, 2)).toMatch(/^○ 2 Quote commas +✗1  2 files · req 2 {3}$/)
  expect(await stepRow(pane, 3)).toMatch(/^○ 3 Docs +1 file {11}$/)
  expect(await stepRow(pane, 3)).not.toMatch(/✗|↻|n\d|p\d/)
  // The labels say the same in words.
  expect(await stepLabel(pane, 1)).toMatch(/^step 1, Read the rows, .*, 1 nit$/)
  expect(await stepLabel(pane, 2)).toMatch(/^step 2, Quote commas, .*, 1 important$/)
  expect(await stepLabel(pane, 3)).toMatch(/^step 3, Docs, /)
  expect(await stepLabel(pane, 3)).not.toMatch(/important|nit|awaiting|pre-existing/)
  // Every finding still shows under plan.md in the tree.
  for (const line of [2, 6, 8, 10]) expect(await rowOf(pane, `${TREE}.tasks/export-csv/plan.md:${line}#0`)).toBeDefined()
  await pane.unmount()

  // Both ends of step 2's span count, and the lines just outside it don't.
  const step2 = parsePlanSteps(STEPS_PLAN)[1]
  expect(step2).toMatchObject({ n: 2, from: 8, to: 9 })
  const countAt = (line: number) => stepFindings(trackFindings([roundKept(1, survivorsMd(impAt(at(line))), '', null)], ['/repo'], 'round'), '.tasks/export-csv/plan.md', step2 ?? { from: 0, to: 0 }, [])
  expect([7, 8, 9, 10].map(line => countAt(line).important)).toEqual([0, 1, 1, 0])
})

test('during Build each step shows built, being built, or not yet', async ($, on) => {
  // Four steps, step 1 built; plan review kept an IMPORTANT and a NIT on step 2's line, which Build never shows.
  const building = (plan: string, extra = builtSteps(1), more: Record<string, string> = {}) => {
    const files = inRounds([], { status: 'BUILDING', extra })
    files['.tasks/export-csv/state.md'] = (files['.tasks/export-csv/state.md'] ?? '').replace(/^plan_rounds: \d+$/m, 'plan_rounds: 1')
    return {
      ...files,
      '.tasks/export-csv/plan-review/round-1/logic.md': NOTHING_KEPT,
      '.tasks/export-csv/plan-review/round-1/survivors.md': survivorsMd(impAt(`${PLAN}:5`), nitAt(`${PLAN}:5`)),
      [PLAN]: plan,
      ...more,
    }
  }
  // One planned file in every step, so the rows are pressable Buttons with their labels.
  const files: Record<string, string> = building(planMd(4), builtSteps(1), { [LIST]: filesTsv([fileRow('M', '-', '-', 'x', '1,2,3,4')], { base: '-' }) })
  world(on, files)
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.description }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const marks = async (pane: Drawn, ns: number[]) => Promise.all(ns.map(async n => (await stepRow(pane, n))?.slice(0, 3)))

  // No builder running: step 2 isn't being built.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await marks(pane, [1, 2, 3, 4])).toEqual(['✓ 1', '○ 2', '○ 3', '○ 4'])
  await pane.unmount()

  // A running builder: the first unbuilt step is being built. No step shows plan-review findings.
  await $.agent.spawn({ tool_use_id: 'b1', prompt: 'Build step 2', description: 'b1', subagentType: 'quorum:builder', parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await marks(pane, [1, 2, 3, 4])).toEqual(['✓ 1', '● 2', '○ 3', '○ 4'])
  for (const n of [1, 2, 3, 4]) {
    expect(await stepRow(pane, n)).toMatch(/^[✓●○] \d Step \d +1 file$/)
    expect(await stepLabel(pane, n)).toBe(`step ${n}, Step ${n}, ${['built', 'being built', 'not built yet', 'not built yet'][n - 1]}, 1 file`)
    expect(await stepLabel(pane, n)).not.toMatch(/important|nit|awaiting/)
  }
  await pane.unmount()

  // This session's standalone review is FIXING: the running builder is its fixer, so no step is being built.
  files['.tasks/review-pr-12/state.md'] = reviewState('FIXING')
  await $.tool.call({ tool: 'Bash', command: 'quorum-state --task review-pr-12 set status FIXING' })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await marks(pane, [1, 2])).toEqual(['✓ 1', '○ 2'])
  await pane.unmount()

  // Another session's FIXING review doesn't count.
  files['.tasks/review-pr-12/state.md'] = reviewState('FIXING', 'MEDIUM', 'sess-b')
  await $.tool.call({ tool: 'Bash', command: 'quorum-state --task review-pr-12 set status FIXING' })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await marks(pane, [1, 2])).toEqual(['✓ 1', '● 2'])
  await pane.unmount()

  // Steps numbered 1, 3, 2 with only 1 built: plan order puts ● on step 3.
  await reload($, files, building('# Plan\n\n## Steps\n1. **One**\n3. **Three**\n2. **Two**\n'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await marks(pane, [1, 3, 2])).toEqual(['✓ 1', '● 3', '○ 2'])
  await pane.unmount()

  // An unsliced plan with a passing build proof: every step is built.
  await reload($, files, building(planMd(2), '', { '.tasks/export-csv/proof-build.md': PROOF }))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await marks(pane, [1, 2])).toEqual(['✓ 1', '✓ 2'])
  await pane.unmount()
})

test('no step row is wider than the card and long titles are cut at the end', async ($, on) => {
  const LONG = 'Long title for a step '.repeat(5).slice(0, 90)
  const plan = `# Plan\n\n## Steps\n1. **${LONG}** — \`app/report.py\` · requirements: 1, 2, 3, 4, 5, 6, 7, 8\n2. **Quote commas** — \`app/util.py\` · requirements: 2\n3. **Docs** — \`README.md\`\n`
  const files: Record<string, string> = {
    ...inRounds([survivorsMd(impAt('.tasks/export-csv/plan.md:4'))], { dir: 'plan-review' }),
    [PLAN]: plan,
    [LIST]: filesTsv(STEPS_FILES, { base: '-' }),
  }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  const rows = await Promise.all([1, 2, 3].map(async n => (await stepRow(pane, n)) ?? ''))
  for (const row of rows) expect(cols(row)).toBeLessThanOrEqual(46)
  // The title is cut at its end, before the marks; the requirements list is cut before the file count.
  expect(rows[0]).toMatch(/^○ 1 Long[^…]*… +✗1 {3}1 file · req 1, 2[^·]*…$/)
  expect(rows[0]).not.toContain(LONG)
  // The files column ends at the same offset on every row, and the marks sit at a fixed place before it.
  const filesEnd = rows.map(r => { const m = /\d+ files?/.exec(r); return m ? m.index + m[0].length : -1 })
  expect(new Set(filesEnd).size).toBe(1)
  expect(rows[0]?.indexOf('✗1')).toBe((filesEnd[0] ?? 0) - 7 - 4)
  expect(rows[1]).toMatch(/^○ 2 Quote commas +2 files · req 2 +$/)
  await pane.unmount()

  // In review the fold row fits too, folded and opened, and so do the step rows it opens.
  await reload($, files, { ...inRounds([survivorsMd(nitAt('app/report.py:1'))], { extra: builtSteps(1) }), [PLAN]: plan, [LIST]: filesTsv(STEPS_FILES) })
  pane = await $.ui.mount(ON_TERMINAL)
  const folded = (await rowOf(pane, STEPS_FOLD)) ?? ''
  expect(folded).toMatch(/^▸ Plan steps/)
  expect(cols(folded)).toBeLessThanOrEqual(46)
  await pane.press({ key: STEPS_FOLD })
  const opened = (await rowOf(pane, STEPS_FOLD)) ?? ''
  expect(opened).toMatch(/^▾ Plan steps/)
  expect(cols(opened)).toBeLessThanOrEqual(46)
  for (const n of [1, 2, 3]) {
    const row = (await stepRow(pane, n)) ?? ''
    expect(row).toMatch(new RegExp(`^[✓○] ${n} `))
    expect(cols(row)).toBeLessThanOrEqual(46)
  }
  await pane.unmount()

  // Narrower still, the requirements go once fewer than 6 columns are left for them; the files stay.
  const narrow = stepRows([{ n: 1, title: LONG, requirements: [1, 2, 3], mark: '○', files: 2, findings: null, isSelected: false }], 28)
  expect(narrow[0]?.parts.map(p => p.text).join('')).toMatch(/^○ 1 Long title for… +2 files$/)
})

const STEPS_FOLD = 'export-csv:steps'
// The fold row's count, as its own Text inside the Button.
const foldCount = async (pane: Drawn, text: string) => (await partOf(pane, STEPS_FOLD, text))?.props?.color

test('from review on the steps fold to one row that a press opens', async ($, on) => {
  const changed = [fileRow('M', '5', '1', 'app/report.py', '1'), fileRow('A', '9', '0', 'app/util.py', '2'), fileRow('M', '2', '0', 'README.md', '2,3')]
  const task = (status: string, extra = '') =>
    ({ ...inRounds([survivorsMd(nitAt('app/report.py:1'))], { status, extra: `${builtSteps(1, 2)}${extra}` }), [PLAN]: STEPS_PLAN, [LIST]: filesTsv(changed) })
  const files: Record<string, string> = task('IN_REVIEW')
  world(on, files)
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.description }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const buttonKeys = async (pane: Drawn) => (await pane.findAll({ type: 'Button' })).map(b => b.key ?? '')

  // IN_REVIEW: one folded Button row, after the voter row and directly above the tree; no step rows.
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, STEPS_FOLD)).toBe('▸ Plan steps  2 of 3 built')
  expect((await pane.find({ type: 'Button', key: STEPS_FOLD }))?.props.label).toBe('Plan steps, 2 of 3 steps built, folded')
  expect(await foldCount(pane, '2 of 3 built')).not.toBe('success')
  for (const n of [1, 2, 3]) expect(await stepRow(pane, n)).toBeUndefined()
  let keys = await buttonKeys(pane)
  expect(keys[keys.indexOf(STEPS_FOLD) + 1]).toBe((await treeKeys(pane))[0])
  const all = await texts(pane)
  const fold = all.indexOf('▸ Plan steps  2 of 3 built')
  expect(fold).toBeGreaterThan(all.findIndex(x => /Verifier vote/.test(x)))
  const after = all.slice(fold + 1).filter(x => !['▸ ', 'Plan steps', '  ', '2 of 3 built'].includes(x))
  expect(after[0]).toBe('the verifier kept these in round 1')
  expect(await pane.find({ type: 'Text', text: 'press a step to highlight its files' })).toBeUndefined()

  // A press opens the list: the hint, then each step with its built mark.
  await pane.press({ key: STEPS_FOLD })
  expect(await rowOf(pane, STEPS_FOLD)).toBe('▾ Plan steps  2 of 3 built')
  expect((await pane.find({ type: 'Button', key: STEPS_FOLD }))?.props.label).toBe('Plan steps, 2 of 3 steps built, open')
  expect(await pane.find({ type: 'Text', text: 'press a step to highlight its files' })).toBeDefined()
  expect(await stepRow(pane, 1)).toMatch(/^✓ 1 Read the rows +1 file · req 1, 2$/)
  expect(await stepRow(pane, 2)).toMatch(/^✓ 2 Quote commas +2 files · req 2 +$/)
  expect(await stepRow(pane, 3)).toMatch(/^○ 3 Docs +1 file +$/)
  await pane.unmount()

  // The open state is kept under export-csv:steps across a reload; a second press folds it again.
  await reload($, files, task('IN_REVIEW'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, STEPS_FOLD)).toBe('▾ Plan steps  2 of 3 built')
  expect(await stepRow(pane, 1)).toBeDefined()
  await pane.press({ key: STEPS_FOLD })
  expect(await stepRow(pane, 1)).toBeUndefined()
  await pane.unmount()

  // AWAITING-HUMAN: directly above the folded Files row.
  await reload($, files, task('AWAITING-HUMAN'))
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, STEPS_FOLD)).toBe('▸ Plan steps  2 of 3 built')
  keys = await buttonKeys(pane)
  expect(keys[keys.indexOf(STEPS_FOLD) + 1]).toBe(FILES_ROW)
  for (const n of [1, 2, 3]) expect(await stepRow(pane, n)).toBeUndefined()
  await pane.unmount()

  // inBothReviews keeps a plan-review IMPORTANT at plan.md:14, inside step 2, and a builder runs: opened, the
  // rows show only built and not-yet marks, with no findings.
  const plan14 = ['# Plan', '', 'Context', '', '', '', '', '', '', '', '## Steps', '1. **Read the rows** · requirements: 1', '2. **Quote commas** · requirements: 2', '   - wrap a field', '   - in quotes', '3. **Docs**', ''].join('\n')
  expect(parsePlanSteps(plan14)[1]).toMatchObject({ n: 2, from: 13, to: 15 })
  await reload($, files, { ...inBothReviews(), [PLAN]: plan14, [LIST]: filesTsv(changed) })
  await $.agent.spawn({ tool_use_id: 'b1', prompt: 'Fix round 1', description: 'b1', subagentType: 'quorum:builder', parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  pane = await $.ui.mount(ON_TERMINAL)
  await pane.press({ key: STEPS_FOLD })
  for (const n of [1, 2, 3]) {
    expect(await stepRow(pane, n)).toMatch(/^○ \d \S/)
    expect(await stepRow(pane, n)).not.toMatch(/[●✗↻]|(^|\s)[np]\d/)
    expect(await stepLabel(pane, n)).toMatch(new RegExp(`^step ${n}, .+, not built yet, \\d files?`))
    expect(await stepLabel(pane, n)).not.toMatch(/important|nit|awaiting|being built/)
  }
  await pane.press({ key: STEPS_FOLD })
  await pane.unmount()

  // A fast-path task, and a task with no plan.md, show neither the row nor the list.
  const fast = task('IN_REVIEW')
  fast['.tasks/export-csv/state.md'] = (fast['.tasks/export-csv/state.md'] ?? '').replace('risk: MEDIUM', 'risk: LOW\nfast: true')
  await reload($, files, fast)
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Button', key: STEPS_FOLD })).toBeUndefined()
  expect(await stepRow(pane, 1)).toBeUndefined()
  await pane.unmount()
  const noPlan = task('IN_REVIEW')
  delete noPlan[PLAN]
  await reload($, files, noPlan)
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Button', key: STEPS_FOLD })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Plan steps/ })).toBeUndefined()
  await pane.unmount()
})

// The Text a tree row draws its name in, found among the Button's parts.
const isBoldName = async (pane: Drawn, key: string) => (await partOf(pane, key, key.split(':tree:')[1]?.split('/').at(-1) ?? ''))?.props?.bold === true
const isLit = async (pane: Drawn, key: string) => ((await rowOf(pane, key)) ?? '').includes('▎') && (await isBoldName(pane, key))

test('pressing a step highlights its files and opens their folders, and a second press clears it', async ($, on) => {
  // Build with 16 files, so every clean folder starts folded: a/ holds step 1's 13 files, b/ and b/deep/ step 2's,
  // c/ step 3's; step 4 names no file.
  const plan = '# Plan\n\n## Steps\n1. **One** — `a`\n2. **Two** — `b`\n3. **Three** — `c`\n4. **Four** — `d`\n'
  const sixteen = [
    ...Array.from({ length: 13 }, (_, i) => fileRow('M', '1', '0', `a/f${String(i).padStart(2, '0')}.ts`, '1')),
    fileRow('M', '1', '0', 'b/x.ts', '2'),
    fileRow('A', '1', '0', 'b/deep/y.ts', '2'),
    fileRow('M', '1', '0', 'c/z.ts', '3'),
  ]
  const files: Record<string, string> = { ...inRounds([], { status: 'BUILDING', extra: builtSteps(1) }), [PLAN]: plan, [LIST]: filesTsv(sixteen) }
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const B = `${TREE}b/`
  // In the tree's order: b/deep/ before b/'s own files.
  const STEP2 = [`${TREE}b/deep/y.ts`, `${TREE}b/x.ts`]
  const indexOf = async (pane: Drawn, key: string) => (await treeKeys(pane)).indexOf(key)
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Button', key: `${STEP}2` })).toBeDefined()
  expect(await rowOf(pane, B)).toMatch(/▸ b\//)
  for (const key of STEP2) expect(await pane.find({ type: 'Button', key })).toBeUndefined()
  const before = await indexOf(pane, B)
  expect(before).toBeGreaterThan(-1)
  const stepBefore = (await stepRow(pane, 2)) ?? ''
  expect(stepBefore).toMatch(/^○ 2 Two /)

  // Step 2: its files are lit, and the folders above them are held open, in place.
  await pane.press({ key: `${STEP}2` })
  // The step's own row is marked as its files are, in place: a `▎` in the space before its bold title.
  expect(await stepRow(pane, 2)).toBe(stepBefore.replace('2 Two', '2▎Two'))
  expect((await partOf(pane, `${STEP}2`, 'Two'))?.props?.bold).toBe(true)
  for (const n of [1, 3, 4]) expect(await stepRow(pane, n)).not.toContain('▎')
  expect(await rowOf(pane, B)).toMatch(/▾ b\//)
  expect(await indexOf(pane, B)).toBe(before)
  expect((await pane.find({ type: 'Button', key: B }))?.props.label).toContain('held open for step 2')
  expect((await pane.find({ type: 'Button', key: `${TREE}b/deep/` }))?.props.label).toContain('held open for step 2')
  for (const key of STEP2) expect(await isLit(pane, key)).toBe(true)
  expect(await pane.find({ type: 'Text', text: "step 2's files are highlighted" })).toBeDefined()
  expect((await treeButtons(pane)).filter(b => b.text.includes('▎')).map(b => b.key)).toEqual(STEP2)
  // The lit row's columns don't move: the bar takes the lead's last space.
  expect(((await rowOf(pane, `${TREE}b/x.ts`)) ?? '').replace('▎', ' ')).toMatch(/^○ M {5}x\.ts/)

  // A second press clears both.
  await pane.press({ key: `${STEP}2` })
  expect(await stepRow(pane, 2)).toBe(stepBefore)
  expect((await partOf(pane, `${STEP}2`, 'Two'))?.props?.bold).not.toBe(true)
  expect(await rowOf(pane, B)).toMatch(/▸ b\//)
  expect(await indexOf(pane, B)).toBe(before)
  expect((await pane.find({ type: 'Button', key: B }))?.props.label).not.toContain('held open')
  for (const key of STEP2) expect(await pane.find({ type: 'Button', key })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'press a step to highlight its files' })).toBeDefined()

  // Step 1 then step 3 moves the highlight.
  await pane.press({ key: `${STEP}1` })
  expect(await isLit(pane, `${TREE}a/f00.ts`)).toBe(true)
  expect(await rowOf(pane, `${TREE}c/`)).toMatch(/▸ c\//)
  await pane.press({ key: `${STEP}3` })
  expect(await pane.find({ type: 'Button', key: `${TREE}a/f00.ts` })).toBeUndefined()
  expect(await rowOf(pane, `${TREE}a/`)).toMatch(/▸ a\//)
  expect(await isLit(pane, `${TREE}c/z.ts`)).toBe(true)
  expect(await pane.find({ type: 'Text', text: "step 3's files are highlighted" })).toBeDefined()

  // A step with no files selects nothing, and doesn't throw.
  await pane.press({ key: `${STEP}4` })
  expect((await treeButtons(pane)).some(b => b.text.includes('▎'))).toBe(false)
  expect(await rowOf(pane, `${TREE}c/`)).toMatch(/▸ c\//)
  expect(await pane.find({ type: 'Text', text: 'press a step to highlight its files' })).toBeDefined()
  await pane.unmount()

  // READY with the Files row folded and the steps fold opened: a step press opens Files to show its lit files.
  const changed = [fileRow('M', '5', '1', 'app/report.py', '1'), fileRow('A', '9', '0', 'app/util.py', '2'), fileRow('M', '2', '0', 'README.md', '2,3')]
  await reload($, files, { ...inRounds([survivorsMd(nitAt('app/report.py:1'))], { status: 'READY', extra: builtSteps(1, 2, 3) }), [PLAN]: STEPS_PLAN, [LIST]: filesTsv(changed) })
  pane = await $.ui.mount(ON_TERMINAL)
  await pane.press({ key: STEPS_FOLD })
  expect((await pane.find({ type: 'Button', key: FILES_ROW }))?.props.label).toMatch(/folded$/)
  expect(await treeKeys(pane)).toEqual([])
  await pane.press({ key: `${STEP}2` })
  expect((await pane.find({ type: 'Button', key: FILES_ROW }))?.props.label).toMatch(/open$/)
  for (const key of [`${TREE}app/util.py`, `${TREE}README.md`]) expect(await isLit(pane, key)).toBe(true)
  expect(((await rowOf(pane, `${TREE}app/report.py`)) ?? '')).not.toContain('▎')
  await pane.press({ key: `${STEP}2` })
  expect((await treeButtons(pane)).some(b => b.text.includes('▎'))).toBe(false)
  expect((await pane.find({ type: 'Button', key: FILES_ROW }))?.props.label).toMatch(/open$/)
  await pane.unmount()

  // No tree under the rows: PLANNING before the first round, and IN_REVIEW at round 0 with the fold opened. The
  // rows are drawn, but not as Buttons, and nothing invites a press.
  for (const status of ['PLANNING', 'IN_REVIEW']) {
    await reload($, files, { ...inRounds([], { status }), [PLAN]: STEPS_PLAN, [LIST]: filesTsv(changed) })
    pane = await $.ui.mount(ON_TERMINAL)
    // The READY case above left the steps fold stored open; open it only if it isn't.
    if (status === 'IN_REVIEW' && (await rowOf(pane, STEPS_FOLD))?.startsWith('▸')) await pane.press({ key: STEPS_FOLD })
    if (status === 'IN_REVIEW') expect(await rowOf(pane, STEPS_FOLD)).toMatch(/^▾ Plan steps/)
    expect(await pane.find({ type: 'Text', text: /Quote commas/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: `${STEP}2` })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /press a step|files are highlighted/ })).toBeUndefined()
    await pane.unmount()
  }
})

test('step rows and the folded row are labelled in words', async ($, on) => {
  // Plan, round 1: an IMPORTANT on step 2's line and a NIT on step 1's.
  const files: Record<string, string> = {
    ...inRounds([survivorsMd(impAt(`${PLAN}:8`), nitAt(`${PLAN}:6`))], { dir: 'plan-review' }),
    [PLAN]: STEPS_PLAN,
    [LIST]: filesTsv(STEPS_FILES, { base: '-' }),
  }
  world(on, files)
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.description }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await stepLabel(pane, 1)).toBe('step 1, Read the rows, not built yet, 1 file, requirements 1 and 2, 1 nit')
  expect(await stepLabel(pane, 2)).toBe('step 2, Quote commas, not built yet, 2 files, requirement 2, 1 important')
  expect(await stepLabel(pane, 3)).toBe('step 3, Docs, not built yet, 1 file')
  // Selected, the row says so, and its files in the plan tree say which step lit them.
  await pane.press({ key: `${STEP}2` })
  expect(await stepLabel(pane, 2)).toBe('step 2, Quote commas, not built yet, 2 files, requirement 2, 1 important, selected')
  expect(await stepLabel(pane, 1)).not.toContain('selected')
  for (const key of [`${TREE}app/util.py`, `${TREE}README.md`]) expect((await pane.find({ type: 'Button', key }))?.props.label).toMatch(/^[^,]+, in step 2, /)
  expect((await pane.find({ type: 'Button', key: `${TREE}app/report.py` }))?.props.label).not.toContain('in step')
  await pane.press({ key: `${STEP}2` })
  await pane.unmount()

  // Build with step 1 built and a builder running: built, being built, not built yet.
  await reload($, files, { ...inRounds([], { status: 'BUILDING', extra: builtSteps(1) }), [PLAN]: STEPS_PLAN, [LIST]: filesTsv(STEPS_FILES) })
  await $.agent.spawn({ tool_use_id: 'b1', prompt: 'Build step 2', description: 'b1', subagentType: 'quorum:builder', parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await stepLabel(pane, 1)).toBe('step 1, Read the rows, built, 1 file, requirements 1 and 2')
  expect(await stepLabel(pane, 2)).toBe('step 2, Quote commas, being built, 2 files, requirement 2')
  expect(await stepLabel(pane, 3)).toBe('step 3, Docs, not built yet, 1 file')
  await pane.unmount()

  // The folded row says how many steps are built of how many.
  await reload($, files, { ...inRounds([survivorsMd(nitAt('app/report.py:1'))], { extra: builtSteps(1, 2) }), [PLAN]: STEPS_PLAN, [LIST]: filesTsv(STEPS_FILES) })
  pane = await $.ui.mount(ON_TERMINAL)
  expect((await pane.find({ type: 'Button', key: STEPS_FOLD }))?.props.label).toContain('2 of 3 steps built')
  await pane.unmount()
})

test('the demo task shows its plan steps folded in review', async ($, on) => {
  // The demo's review stage: IN_REVIEW in round 2, its three-step plan built in one go with a build proof.
  world(on, { ...repo('IN_REVIEW'), [PLAN]: DEMO_PLAN, '.tasks/export-csv/proof-build.md': PROOF })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(ON_TERMINAL)
  expect(await rowOf(pane, STEPS_FOLD)).toBe('▸ Plan steps  3 of 3 built')
  expect(await foldCount(pane, '3 of 3 built')).toBe('success')
  await pane.unmount()
})

// treeRows and treeHeader on their own, for the file being edited: a files.tsv row, its change (step 1 built), the
// options at 50 columns, and a row's text.
const editFile = (path: string, letter: ChangedFile['letter'], added: ChangedFile['added'], steps: number[]): ChangedFile =>
  ({ letter, added, removed: added === null ? null : 0, path, oldPath: '', steps, fix: null })
const editChange = (files: ChangedFile[], extra: Partial<TreeChange> = {}): TreeChange => ({ files, hasPlan: true, built: [1], allBuilt: false, rereview: [], ...extra })
const editOpts = (extra: Partial<Parameters<typeof treeRows>[1]> = {}) => ({ scope: 's', width: 50, icons: false, isHigh: false, folds: {}, ...extra })
const editText = (r: TreeRow | undefined) => (r?.parts ?? []).map(p => p.text).join('')
const keyLine = (k: { text: string }[][] | undefined) => (k ?? []).map(l => l.map(p => p.text).join(''))

test('the folders above the edited file open while it carries the dot', () => {
  // 16 files, so the clean folder deep/ (inside app/) starts folded, and the user has folded it too.
  const files = [
    ...Array.from({ length: 14 }, (_, i) => editFile(`lib/f${String(i).padStart(2, '0')}.ts`, 'M', 1, [1])),
    editFile('app/deep/a.ts', 'M', 1, [1]),
    editFile('app/b.ts', 'M', 1, [1]),
  ]
  const ch = editChange(files)
  const DEEP = 's:tree:app/deep/'
  const folds = { [DEEP]: false }
  const at = (rows: TreeRow[], key: string) => rows.find(r => r.key === key)
  const index = (rows: TreeRow[], key: string) => rows.filter(r => r.kind !== 'finding').map(r => r.key).indexOf(key)

  const held = treeRows(null, editOpts({ change: ch, folds, edit: { path: 'app/deep/a.ts', isFlash: false } }))
  expect(at(held, DEEP)?.isOpen).toBe(true)
  expect(at(held, DEEP)?.label).toContain('open, held open while editing')
  expect(at(held, 's:tree:app/')?.isOpen).toBe(true)
  expect(at(held, 's:tree:app/deep/a.ts')).toBeDefined()
  expect(editText(at(held, 's:tree:app/deep/a.ts'))).toMatch(/^● M/)
  expect(at(held, 's:tree:app/deep/a.ts')?.label).toMatch(/^app\/deep\/a\.ts, editing, /)
  // The other big-tree folder stays folded: only the edited file's folders are held.
  expect(at(held, 's:tree:lib/')?.isOpen).toBe(false)

  // The dot moves to a file outside deep/: the user's fold applies again, in the same place under the same key.
  const released = treeRows(null, editOpts({ change: ch, folds, edit: { path: 'app/b.ts', isFlash: false } }))
  expect(at(released, DEEP)?.isOpen).toBe(false)
  expect(at(released, DEEP)?.label).not.toContain('held open')
  expect(at(released, 's:tree:app/deep/a.ts')).toBeUndefined()
  expect(index(released, DEEP)).toBe(index(held, DEEP))
  expect(index(held, DEEP)).toBeGreaterThan(-1)

  // A flash: the bar and the bold name, both in the claude colour, winning over a selected step's plain bar.
  const flash = at(treeRows(null, editOpts({ change: ch, folds, selected: 1, edit: { path: 'app/b.ts', isFlash: true } })), 's:tree:app/b.ts')
  expect(editText(flash)).toContain('▎')
  expect(flash?.parts.find(p => p.text === '▎')?.color).toBe('claude')
  expect(flash?.parts.find(p => p.text === 'b.ts')).toMatchObject({ bold: true, color: 'claude' })
  const lit = at(treeRows(null, editOpts({ change: ch, folds, selected: 1, edit: { path: 'app/b.ts', isFlash: false } })), 's:tree:app/b.ts')
  expect(lit?.parts.find(p => p.text === 'b.ts')?.color).toBeUndefined()
  // The word slot: editing in the claude colour, and the row is still 50 columns.
  expect(flash?.parts.find(p => p.text === 'editing')?.color).toBe('claude')
  for (const r of held.filter(r => r.kind !== 'finding')) expect(cols(editText(r))).toBe(50)
})

test('the key line names the editing dot when one shows', () => {
  // A planned file (step 2, not built), a built one, an edited one, and an unplanned one.
  const files = [editFile('a.ts', 'M', null, [2]), editFile('b.ts', 'M', 3, [1]), editFile('c.ts', 'M', 2, [1]), editFile('d.ts', 'M', 1, [])]
  expect(keyLine(treeHeader(null, 50, editChange(files), { path: 'c.ts', isFlash: false })?.key)).toEqual(['key: ✓ built  ○ not yet  ● editing  * unplanned'])
  // The edited row gives ●, not its own mark: with only built files, editing one of two leaves ✓ for the other.
  const built = [editFile('b.ts', 'M', 3, [1]), editFile('c.ts', 'M', 2, [1])]
  expect(keyLine(treeHeader(null, 50, editChange(built), { path: 'c.ts', isFlash: false })?.key)).toEqual(['key: ✓ built  ● editing'])
  expect(keyLine(treeHeader(null, 50, editChange(built.slice(1)), { path: 'c.ts', isFlash: false })?.key)).toEqual(['key: ● editing'])
  // Every row built and the edit on a path the list doesn't hold: the live row's ● still reaches the key.
  expect(keyLine(treeHeader(null, 50, editChange(built), { path: 'app/new.ts', isFlash: false })?.key)).toEqual(['key: ✓ built  ● editing'])
  const header = treeHeader(null, 50, editChange(built), { path: 'app/new.ts', isFlash: false })
  expect(header?.key[0]?.find(p => p.text === '●')?.color).toBe('claude')
  // Without an edit, no ● editing, and the order holds.
  expect(keyLine(treeHeader(null, 50, editChange(files))?.key)).toEqual(['key: ✓ built  ○ not yet  * unplanned'])
  expect(keyLine(treeHeader(null, 50, editChange(files), null)?.key)).toEqual(['key: ✓ built  ○ not yet  * unplanned'])

  // The live row: under its folders, ● with no letter, counts or step, and the words editing unplanned.
  const rows = treeRows(null, editOpts({ change: editChange(built), edit: { path: 'app/new.ts', isFlash: false } }))
  const live = rows.find(r => r.key === 's:tree:app/new.ts')
  expect(rows.map(r => r.key)).toEqual(['s:tree:app/', 's:tree:app/new.ts', 's:tree:b.ts', 's:tree:c.ts'])
  expect(editText(live)).toMatch(/^● {7}new\.ts +editing unplanned {11}$/)
  expect(live?.label).toBe('app/new.ts, editing, unplanned')
  expect(live?.parts.find(p => p.text === 'unplanned')?.dim).toBe(true)
  for (const r of rows) expect(cols(editText(r))).toBe(50)
  // An edited unplanned file in the list shows ● and both words; its label keeps its own.
  const odd = treeRows(null, editOpts({ change: editChange(files), edit: { path: 'd.ts', isFlash: false } })).find(r => r.key === 's:tree:d.ts')
  expect(editText(odd)).toMatch(/^● M {3}d\.ts +editing unplanned +\+1 {3}$/)
  expect(odd?.label).toBe('d.ts, editing, unplanned, modified, 1 line added')
  // With no plan the progress column appears for the dot alone.
  const noPlan = treeRows(null, editOpts({ change: editChange(built.map(f => ({ ...f, steps: [] })), { hasPlan: false }), edit: { path: 'b.ts', isFlash: false } }))
  expect(editText(noPlan.find(r => r.key === 's:tree:b.ts'))).toMatch(/^● M {3}b\.ts +editing +\+3 {3}$/)
  expect(editText(noPlan.find(r => r.key === 's:tree:c.ts'))).toMatch(/^ {2}M {3}c\.ts/)
})

test('in Build the edit shows on a file only while one of its steps is unbuilt or being built', () => {
  const files = [editFile('a.ts', 'M', 1, [1]), editFile('b.ts', 'M', 1, [1, 2]), editFile('u.ts', 'M', 1, [])]
  const ch = editChange(files)
  // Step 1 built, step 2 being built: a.ts's steps are all built and none is being built.
  expect(isEditShown('a.ts', ch, true, 2)).toBe(false)
  expect(isEditShown('a.ts', ch, true, null)).toBe(false)
  expect(isEditShown('a.ts', ch, true, 1)).toBe(true)
  expect(isEditShown('b.ts', ch, true, 2)).toBe(true)
  expect(isEditShown('b.ts', editChange(files, { built: [1, 2] }), true, null)).toBe(false)
  expect(isEditShown('b.ts', editChange(files, { built: [], allBuilt: true }), true, null)).toBe(false)
  // A file no step names, and one the list doesn't hold, always show it; so does review.
  expect(isEditShown('u.ts', ch, true, null)).toBe(true)
  expect(isEditShown('app/new.ts', ch, true, null)).toBe(true)
  expect(isEditShown('a.ts', ch, false, null)).toBe(true)
})

// ---- The file being edited, from tool.call

// A Build at step 1 built: step 2 names app/a.ts, app/b.ts and the notebook, and wt.ts sits in the task's worktree.
const EDIT_PLAN = '# Plan\n\n## Steps\n1. **One** — `x`\n2. **Two** — `app`\n'
const EDIT_FILES = [fileRow('M', '1', '0', 'app/a.ts', '2'), fileRow('M', '1', '0', 'app/b.ts', '2'), fileRow('A', '1', '0', 'nb/x.ipynb', '2'), fileRow('M', '1', '0', 'wt.ts', '2')]
const editTask = (status = 'BUILDING', extra = builtSteps(1)): Record<string, string> =>
  ({ ...inRounds([], { status, extra: `${extra}worktree: /wt/export-csv\n` }), [PLAN]: EDIT_PLAN, [LIST]: filesTsv(EDIT_FILES) })
const BUILDER = { prompt: 'Build step 2', description: 'b1', subagentType: 'quorum:builder', parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' as const }, background: false, fork: false }
// The tree rows that carry the dot, by path, and whether a row is lit.
const dotted = async (pane: Drawn) => (await treeButtons(pane)).filter(b => b.text.startsWith('●')).map(b => (b.key ?? '').slice(TREE.length))
const barred = async (pane: Drawn) => (await treeButtons(pane)).filter(b => b.text.includes('▎')).map(b => (b.key ?? '').slice(TREE.length))
const edit = ($: Engine, file_path: string, agentId?: string) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', ...(agentId ? { agentId } : {}) })
const finish = ($: Engine, agentId?: string) =>
  $.turn.complete({ ...(agentId ? { agentId } : {}), turnId: 'x', answer: 'done', reason: 'answer', durationMs: 1, isAborted: false })
async function look<T>($: Engine, read: (pane: Drawn) => Promise<T>): Promise<T> {
  const pane = await $.ui.mount(ON_TERMINAL)
  const out = await read(pane)
  await pane.unmount()
  return out
}

test('an Edit, Write, or NotebookEdit in Build or review marks that file, and denied, failed, .tasks, and other-stage calls do not', async ($, on) => {
  const files = editTask()
  const o: { cwd?: string } = {}
  // The Edit tool's answer beneath the dashboard: answered (by the world's tool.call), refused, or an error.
  // Registered before world(), so it sits above the world's own tool.call hook.
  let answer: 'ok' | 'deny' | 'error' = 'ok'
  on('tool.call', { tool: 'Edit' }, (_, e, next) => (answer === 'deny' ? { deny: 'refused' } : answer === 'error' ? { isError: true as const, result: 'boom' } : next(e)))
  world(on, files, '/repo', {}, [], o)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  // Nothing marked: a denied call, a failed one, a path under .tasks/, and paths under none of the roots.
  answer = 'deny'
  await edit($, '/repo/app/a.ts')
  answer = 'error'
  await edit($, '/repo/app/a.ts')
  answer = 'ok'
  await edit($, '/repo/.tasks/export-csv/notes.md')
  await edit($, '/elsewhere/x.ts')
  await edit($, '/repo/../etc/x.ts')
  expect(await look($, dotted)).toEqual([])
  expect(await look($, async p => p.find({ type: 'Text', text: /editing/ }))).toBeUndefined()

  // An absolute path under the repo, then a Write, a relative path, a NotebookEdit, a ./ path, and the worktree.
  await edit($, '/repo/app/a.ts')
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  expect(await look($, async p => rowOf(p, `${TREE}app/a.ts`))).toContain('editing')
  expect(await look($, async p => (await p.find({ type: 'Button', key: `${TREE}app/a.ts` }))?.props.label)).toMatch(/^app\/a\.ts, editing, /)
  await $.tool.call({ tool: 'Write', file_path: '/repo/app/b.ts', content: '' })
  expect(await look($, dotted)).toEqual(['app/b.ts'])
  await edit($, 'app/a.ts')
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/nb/x.ipynb', new_source: '' })
  expect(await look($, dotted)).toEqual(['nb/x.ipynb'])
  await edit($, './app/b.ts')
  expect(await look($, dotted)).toEqual(['app/b.ts'])
  await edit($, '/wt/export-csv/wt.ts')
  expect(await look($, dotted)).toEqual(['wt.ts'])

  // The cwd isn't the root: a relative path is read against the cwd, so no live a.ts row appears at the top.
  o.cwd = '/repo/app'
  await edit($, 'a.ts')
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  expect(await look($, async p => p.find({ type: 'Button', key: `${TREE}a.ts` }))).toBeUndefined()
  expect(await look($, async p => p.find({ type: 'Text', text: /editing unplanned/ }))).toBeUndefined()
  o.cwd = undefined

  // A Write under .tasks/ still refreshes the task.
  files[LIST] = filesTsv([...EDIT_FILES, fileRow('A', '2', '0', 'app/c.ts', '2')])
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/files.tsv', content: '' })
  expect(await look($, async p => rowOf(p, `${TREE}app/c.ts`))).toMatch(/c\.ts/)

  // In PLANNING an Edit records nothing, even once the task is back in Build.
  await reload($, files, editTask('PLANNING', ''))
  await edit($, '/repo/app/b.ts')
  await reload($, files, editTask())
  expect(await look($, dotted)).toEqual([])

  // editPath on its own: either slash, `.` and `..` resolved, and nothing outside the roots or under .tasks/.
  expect(editPath('a.ts', '/repo/app', ['/repo'])).toBe('app/a.ts')
  expect(editPath('a.ts', 'C:\\repo\\app', ['C:\\repo'])).toBe('app/a.ts')
  expect(editPath('C:\\repo\\.\\app\\a.ts', 'C:\\repo', ['C:\\repo'])).toBe('app/a.ts')
  expect(editPath('.\\app\\a.ts', 'C:\\repo', ['C:\\repo'])).toBe('app/a.ts')
  expect(editPath('C:\\repo\\..\\other\\x.ts', 'C:\\repo', ['C:\\repo'])).toBeNull()
  expect(editPath('C:\\repo\\app\\..\\.tasks\\s\\plan.md', 'C:\\repo', ['C:\\repo'])).toBeNull()
  expect(editPath('/repo/app/../../etc/x', '/repo', ['/repo'])).toBeNull()
  expect(editPath('/repo', '/repo', ['/repo'])).toBeNull()
})

test('the edited file flashes for 2.5 s then keeps its dot until another file is edited or its agent finishes', async ($, on) => {
  const files = editTask()
  world(on, files, '/repo', {}, [], { clock: false })
  const clock = mock.clock(on)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const words = async (p: Drawn) => (await p.findAll({ type: 'Text' })).some(t => /\bediting\b/.test(t.text))

  // A builder's edit: the dot, the word, and the lit row.
  await edit($, '/repo/app/a.ts', 'b1')
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  expect(await look($, words)).toBe(true)
  expect(await look($, barred)).toEqual(['app/a.ts'])
  expect(await look($, async p => isLit(p, `${TREE}app/a.ts`))).toBe(true)
  // 2.5 s on: the highlight is gone, the dot and the word stay.
  await clock.advance(2500)
  expect(await look($, barred)).toEqual([])
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  expect(await look($, words)).toBe(true)
  // Another agent finishing leaves them; another file edited moves them; the editing agent finishing clears them.
  await finish($, 'b2')
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  await edit($, '/repo/app/b.ts', 'b1')
  expect(await look($, dotted)).toEqual(['app/b.ts'])
  await finish($, 'b1')
  expect(await look($, dotted)).toEqual([])
  expect(await look($, words)).toBe(false)

  // A main-session edit clears on a turn.complete with no agentId.
  await edit($, '/repo/app/a.ts')
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  await finish($)
  expect(await look($, dotted)).toEqual([])

  // Crossed pairs: a subagent's edit outlives the main session's turn, and a main-session edit outlives a subagent's.
  await edit($, '/repo/app/a.ts', 'b1')
  await finish($)
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  expect(await look($, words)).toBe(true)
  await edit($, '/repo/app/b.ts')
  await finish($, 'b1')
  expect(await look($, dotted)).toEqual(['app/b.ts'])
  expect(await look($, words)).toBe(true)

  // Leaving Build and review clears them, and coming back to review shows no old edit.
  await reload($, files, editTask('CONVERGED'))
  expect(await look($, dotted)).toEqual([])
  expect(await look($, words)).toBe(false)
  await reload($, files, { ...inRounds([survivorsMd(nitAt('app/a.ts:1'))], { extra: builtSteps(1) }), [PLAN]: EDIT_PLAN, [LIST]: filesTsv(EDIT_FILES) })
  expect(await look($, async p => rowOf(p, `${TREE}app/b.ts`))).toBeDefined()
  expect(await look($, dotted)).toEqual([])
  expect(await look($, words)).toBe(false)
})

test('the flash schedules one redraw and leaves no timer running', async ($, on) => {
  const files = editTask()
  world(on, files, '/repo', {}, [], { clock: false })
  // The engine takes one unmatched hook per event, so a counting hook can't sit beside mock.clock's own: mock.clock
  // registers through this `on`, which counts each clock.after (its ms) and clock.every before mock.clock answers it.
  const afters: number[] = []
  let everies = 0
  const register = on as unknown as (event: string, ...rest: unknown[]) => void
  const counting = ((event: string, ...rest: unknown[]) => {
    const answer = rest.pop() as (_: unknown, e: { ms: number }, ...more: unknown[]) => unknown
    register(event, ...rest, (_: unknown, e: { ms: number }, ...more: unknown[]) => {
      if (event === 'clock.after') afters.push(e.ms)
      if (event === 'clock.every') everies++
      return answer(_, e, ...more)
    })
  }) as unknown as typeof on
  const clock = mock.clock(counting)
  let redraws = 0
  on('ui.invalidate', (_, e, next) => { redraws++; return next(e) })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ticks = everies

  // 1. An edit at 0 ms: one redraw timer, no interval.
  await edit($, '/repo/app/a.ts')
  expect(afters).toEqual([2500])
  expect(everies).toBe(ticks)
  // 2. A second edit at 1000 ms schedules its own.
  await clock.set(1000)
  await edit($, '/repo/app/b.ts')
  expect(afters).toEqual([2500, 2500])
  const before = redraws
  // 3. The first edit's deadline: its timer was cancelled, so nothing redraws and b.ts still flashes.
  await clock.set(2500)
  expect(redraws).toBe(before)
  expect(await look($, barred)).toEqual(['app/b.ts'])
  // 4. The second's: exactly one redraw, and the flash is over while the dot stays.
  await clock.set(3500)
  expect(redraws).toBe(before + 1)
  expect(await look($, barred)).toEqual([])
  expect(await look($, dotted)).toEqual(['app/b.ts'])
  // 5. No timer left.
  const after = redraws
  await clock.advance(10000)
  expect(redraws).toBe(after)
  expect(everies).toBe(ticks)
})

test('in Build a file whose steps are all built and not being built shows its progress mark, not editing', async ($, on) => {
  // app/a.ts is step 1's only; app/b.ts is step 2's.
  const plan = '# Plan\n\n## Steps\n1. **One** — `a`\n2. **Two** — `b`\n'
  const rows = [fileRow('M', '1', '0', 'app/a.ts', '1'), fileRow('M', '1', '0', 'app/b.ts', '2')]
  const at = (extra: string) => ({ ...inRounds([], { status: 'BUILDING', extra }), [PLAN]: plan, [LIST]: filesTsv(rows) })
  const files: Record<string, string> = at('')
  world(on, files)
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.description }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ tool_use_id: 'b1', ...BUILDER })

  // Step 1 is being built: its file shows the dot.
  await edit($, '/repo/app/a.ts', 'b1')
  expect(await look($, dotted)).toEqual(['app/a.ts'])
  // Step 1 built, step 2 being built: a.ts shows ✓, no dot and no editing.
  files['.tasks/export-csv/state.md'] = at(builtSteps(1))['.tasks/export-csv/state.md'] ?? ''
  await $.tool.call({ tool: 'Bash', command: 'quorum-state --task export-csv push built_steps 1' })
  const row = await look($, async p => rowOf(p, `${TREE}app/a.ts`))
  expect(row).toMatch(/^✓ M/)
  expect(row).not.toContain('editing')
  expect(await look($, dotted)).toEqual([])
  // A file of step 2, the one being built, keeps the dot.
  await edit($, '/repo/app/b.ts', 'b1')
  expect(await look($, dotted)).toEqual(['app/b.ts'])
  expect(await look($, async p => rowOf(p, `${TREE}app/b.ts`))).toContain('editing')
})

test('in review an edited planned file shows the dot and editing even though its steps are built', async ($, on) => {
  // An unsliced plan with a passing build proof: every step is built.
  const counted = STEPS_FILES.map(r => r.replace('\t-\t-\t', '\t1\t0\t'))
  world(on, { ...inRounds([survivorsMd(nitAt('app/report.py:1'))]), [PLAN]: STEPS_PLAN, [LIST]: filesTsv(counted), '.tasks/export-csv/proof-build.md': PROOF })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await look($, async p => rowOf(p, `${TREE}README.md`))).toMatch(/^✓/)
  await edit($, '/repo/README.md')
  expect(await look($, dotted)).toEqual(['README.md'])
  expect(await look($, async p => rowOf(p, `${TREE}README.md`))).toContain('editing')
  expect(await look($, async p => (await p.find({ type: 'Button', key: `${TREE}README.md` }))?.props.label)).toMatch(/^README\.md, editing, /)
})

test('an edited file missing from the list shows as a live unplanned row until the next record', async ($, on) => {
  const files: Record<string, string> = { ...inRounds([], { status: 'BUILDING', extra: builtSteps(1, 2, 3) }), [PLAN]: STEPS_PLAN, [LIST]: filesTsv(STEPS_FILES) }
  const seen = world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const before = JSON.stringify(files)
  const written = seen.writes.length
  await edit($, '/repo/app/new.ts')
  // Under app/, ● with no letter, the name, and editing unplanned, with no counts or step.
  const live = await look($, async p => rowOf(p, `${TREE}app/new.ts`))
  // The fixed clock keeps the flash on, so the lead's last column may hold its bar.
  expect(live).toMatch(/^● {6}[ ▎]new\.ts +editing unplanned *$/)
  expect(await look($, treeKeys)).toContain(`${TREE}app/new.ts`)
  // The edit wrote nothing: no fs.write reached the engine, and no file changed.
  expect(seen.writes.slice(written)).toEqual([])
  expect(JSON.stringify(files)).toBe(before)
  // The next record replaces it with the recorded row: its letter and counts.
  files[LIST] = filesTsv([...STEPS_FILES, fileRow('A', '7', '0', 'app/new.ts', '-')])
  await $.tool.call({ tool: 'Bash', command: 'quorum-files record' })
  const recorded = await look($, async p => rowOf(p, `${TREE}app/new.ts`))
  expect(recorded).toMatch(/^● A +[ ▎]new\.ts +editing unplanned +\+7/)
})

test('the current edit and step selection are not stored', async ($, on) => {
  const files = editTask()
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await edit($, '/repo/app/a.ts')
  let pane = await $.ui.mount(ON_TERMINAL)
  await pane.press({ key: `${STEP}2` })
  expect(await stepLabel(pane, 2)).toContain('selected')
  expect(await dotted(pane)).toEqual(['app/a.ts'])
  expect((await barred(pane)).length).toBeGreaterThan(0)
  await pane.unmount()

  // A new session on the same stored atoms: no dot, no highlight, no selection.
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await dotted(pane)).toEqual([])
  expect(await barred(pane)).toEqual([])
  expect(await stepLabel(pane, 2)).not.toContain('selected')
  expect(await stepLabel(pane, 2)).toMatch(/^step 2, /)
  await pane.unmount()
})

test('a Write or Edit under .tasks given with backslashes refreshes the task', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  world(on, files)
  await $.session.start({ cwd: 'C:\\repo', surface: 'terminal', isInteractive: true })
  files['.tasks/export-csv/proof-build.md'] = PROOF
  await $.tool.call({ tool: 'Write', file_path: 'C:\\repo\\.tasks\\export-csv\\proof-build.md', content: PROOF })
  let pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^2\/3 met$/ })).toBeDefined()
  await pane.unmount()

  // Round 2's vote lands as an Edit of its survivors file.
  expect(await look($, async p => p.find({ type: 'Text', text: /^✗ Verifier vote\s+kept ✗1 n1/ }))).toBeUndefined()
  files['.tasks/export-csv/review/round-2/survivors.md'] = SURVIVORS
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\repo\\.tasks\\export-csv\\review\\round-2\\survivors.md', old_string: 'a', new_string: 'b' })
  pane = await $.ui.mount(ON_TERMINAL)
  expect(await pane.find({ type: 'Text', text: /^✗ Verifier vote\s+kept ✗1 n1/ })).toBeDefined()
  await pane.unmount()
})

test('a value stored by the previous shape is dropped, not misread', async ($, on) => {
  // Each state.get for one key answers what the engine holds, but as the previous shape's code stored it: wrapped
  // under its old tag. Every read sees that, the band's included, and a write still lands at the engine's version.
  const old: { task: unknown; reviews: unknown } = { task: undefined, reviews: undefined }
  const latest: { task: unknown; reviews: unknown } = { task: undefined, reviews: undefined }
  type Read = { value: { value: unknown; version: number } }
  const stand = (key: 'task' | 'reviews', tag: string) => async (_: unknown, e: unknown, next: (e: unknown) => Promise<Read>) => {
    const r = await next(e)
    const stored = r.value.value as { value?: unknown } | undefined
    if (stored?.value !== undefined && stored.value !== null && !(Array.isArray(stored.value) && stored.value.length === 0)) latest[key] = stored.value
    return old[key] === undefined ? r : { value: { value: { shape: tag, value: old[key] }, version: r.value.version } }
  }
  const register = on as unknown as (event: string, matcher: unknown, hook: unknown) => void
  register('state.get', { plugin: 'quorum', key: 'task' }, stand('task', 'task-16'))
  register('state.get', { plugin: 'quorum', key: 'reviews' }, stand('reviews', 'reviews-2'))
  const reviewing = {
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.tasks/review-pr-12/state.md': reviewState('REVIEWING'),
    '.tasks/review-pr-12/run-1/logic.md': SURVIVORS,
  }
  const files: Record<string, string> = { ...repo('IN_REVIEW') }
  world(on, files)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const band = async () => {
    const b = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const drawn = { engine: await b.find({ type: 'Text', text: /^engine$/ }), task: await b.find({ type: 'Text', text: /^ IN_REVIEW $/ }), review: await b.find({ type: 'Text', text: /^ REVIEWING $/ }) }
    await b.unmount()
    return drawn
  }
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // A real IN_REVIEW snapshot and a running review of this session's, as the dashboard keeps them.
  expect((await band()).task).toBeDefined()
  const snapshot = latest.task
  await reload($, files, reviewing)
  expect((await band()).review).toBeDefined()
  const running = latest.reviews
  expect(snapshot).toBeDefined()
  expect(running).toBeDefined()

  // (a) A task stored under task-16, with no task on disk: declined, so the band is the engine's.
  await reload($, files, { '.git/HEAD': 'ref: refs/heads/main\n' })
  old.task = snapshot
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/state.md', content: '' })
  let drawn = await band()
  expect(drawn.task).toBeUndefined()
  expect(drawn.engine).toBeDefined()

  // (b) A running review stored under reviews-2: declined too.
  old.task = undefined
  old.reviews = running
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/state.md', content: '' })
  drawn = await band()
  expect(drawn.review).toBeUndefined()
  expect(drawn.engine).toBeDefined()
})
