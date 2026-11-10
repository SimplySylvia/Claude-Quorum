import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  countFindings, countRequirements, evalRows, isReportedPass, isStaleProof, packedRef, joinChecks, nextStep, parseBlind, parseFrontmatter, parsePr,
  parseProof, parseSpec, prDetail, prFromUrl, prNext,
  requirementState, roleOf,
  roundReviewers, slugFromHead, spendOf, stageOf, stages, tokenCount,
  keptFindings, nextCommand, openByDefault, splitTicket,
} from '../../hooks/dashboard/task'

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
  props: { bodyColumns: 140, hasSurvey: false, isWorking: false, maxRows: 6, scroll: { offset: 0, bodyRows: 6 }, view: {} },
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

// Stands for the engine beneath the plugin: a project at /repo holding the files in `files`.
function world(on: On, files: Record<string, string>, root = '/repo') {
  const seen = { status: [] as (string | undefined)[], toasts: [] as string[], opened: 0, ticks: 0, live: [] as string[], copied: [] as string[], filled: [] as string[], draft: '' }
  const file = (path: string) => (path.startsWith(`${root}/`) ? files[path.slice(root.length + 1)] : undefined)
  on('session.root', () => ({ value: root }))
  on('agent.list', () => ({ value: seen.live.map(id => ({ id, description: '', type: 'quorum:code-reviewer', status: 'running' as const })) }))
  // Each period of $.clock.every is one dispatch; refusing the first ends that interval, so this counts intervals.
  on('clock.every', () => { seen.ticks++; return { deny: 'test' } })
  on('fs.read', (_, e) => {
    const text = file(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: file(e.path) !== undefined }))
  on('clock.now', () => ({ value: 1_000 }))
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
  })

  test('next steps, findings and branch slugs', () => {
    expect(nextStep('IN_REVIEW', 'MEDIUM')).toBe('/quorum:review-loop')
    expect(nextStep('CONVERGED', 'LOW')).toBe('LOW tasks already have their summary')
    expect(countFindings(CANDIDATES)).toEqual({ important: 2, nit: 2, preExisting: 0 })
    expect(slugFromHead('ref: refs/heads/fix/a.b-c\n')).toBe('a.b-c')
    expect(slugFromHead('ref: refs/heads/main')).toBe('')
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
      file: 'proof-final.md', rev: '', result: '', rows: [{ id: '4, 5', check: '', result: 'PASS' }, { id: '6', check: '', result: 'PASS' }, { id: '6b', check: '', result: 'FAIL' }],
    })
    expect(requirementState('5', checks)).toEqual({ checks: 1, state: 'pass' })
    expect(requirementState('6', checks)).toEqual({ checks: 2, state: 'fail' })
    expect(requirementState('16', checks)).toEqual({ checks: 0, state: 'none' })
    expect(requirementState('4', joinChecks([{ id: '4', label: '' }], null))).toEqual({ checks: 1, state: 'open' })
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
  })
})

test('the status line, band and pane show the active task', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(seen.status.at(-1)).toBe('export-csv · IN_REVIEW · MEDIUM · round 2/3 · 1 pending')
  expect(seen.opened).toBe(1)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Review r2\/3/ }))).toBeDefined()
  expect((await band.find({ type: 'Text', text: /next: \/quorum:review-loop/ }))).toBeDefined()
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /2 plan review rounds, approved 2026-11-08/ })).toBeDefined()
  // Checks holds a problem (a pending finding), so it opens by itself; the rounds stay folded to their summary.
  expect(await pane.find({ type: 'Text', text: /1 finding pending/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^r1 1 IMPORTANT · r2 reviewing$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /voter kept 2 of 4/ })).toBeUndefined()
  await pane.press({ key: 'toggle-rounds' })
  expect(await pane.find({ type: 'Text', text: /voter kept 2 of 4/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /2 candidates, voting/ })).toBeDefined()
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
  expect(await band.find({ type: 'Text', text: /^ › ✗ Blind test$/ })).toBeDefined()
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

test('task files are read from the project root, not the working directory', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'), '/work/repo')
  await $.session.start({ cwd: '/work/repo/app', surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('export-csv · IN_REVIEW · MEDIUM · round 2/3 · 1 pending')
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
    { tag: 'IMPORTANT', loc: 'app/report.py:42', title: 'Unescaped CSV fields', confidence: 95 },
    { tag: 'NIT', loc: 'app/report.py:7', title: 'naming', confidence: null },
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
  expect(openByDefault(t({}))).toEqual({ requirements: false, checks: false, rounds: false, spend: false, agents: false })
  expect(openByDefault(t({ isProofStale: true })).checks).toBe(true)
  expect(openByDefault(t({ expectedProof: 'proof-final.md' })).checks).toBe(true)
  expect(openByDefault(t({ pending: 1 })).checks).toBe(true)
  expect(openByDefault(t({ stopBlocks: 2, status: 'BUILDING' })).checks).toBe(true)
  expect(openByDefault(t({ stopBlocks: 2, status: 'AWAITING-HUMAN' })).checks).toBe(false)
  expect(openByDefault(t({ status: 'HALTED' })).rounds).toBe(true)
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
  expect(await pane.find({ type: 'Text', text: /^✗ Logic & edge cases\s+1 IMPORTANT · 1 NIT$/ })).toBeDefined()
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
  expect(await pane.find({ type: 'Text', text: /kept 1 IMPORTANT · 1 NIT/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /1 IMPORTANT finding survives: the builder fixes them/ })).toBeDefined()
  // Each kept finding, with its severity badge, file:line, Pattern Category, and a copy button for the location.
  expect(await pane.find({ type: 'Text', text: /^ IMPORTANT $/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^app\/report\.py:42$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Unescaped CSV fields$/ })).toBeDefined()
  await pane.press({ key: 'copy-kept-0' })
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
  expect(seen.status.at(-1)).toBe('export-csv · AWAITING-HUMAN · MEDIUM · round 2/3 · 1 pending · PR #33807 open')
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^PR #33807 open$/ })).toBeDefined()
  expect((await pane.find({ type: 'Link' }))?.props.href).toBe('https://github.com/o/r/pull/33807')
  expect(await pane.find({ type: 'Text', text: /^Get PR #33807 reviewed and merged$/ })).toBeDefined()
  await pane.press({ key: 'copy-pr' })
  expect(seen.copied).toEqual(['https://github.com/o/r/pull/33807'])
  await pane.unmount()

  answer = answer.replace('OPEN', 'MERGED')
  await $.tool.call({ tool: 'Bash', command: 'gh pr view 33807' })
  await settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^ › ✓ PR$/ })).toBeDefined()
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
  expect(await pane.find({ type: 'Text', text: /^PR #42$/ })).toBeDefined()
  expect((await pane.find({ type: 'Link' }))?.props.href).toBe('https://github.com/o/r/pull/42')
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
