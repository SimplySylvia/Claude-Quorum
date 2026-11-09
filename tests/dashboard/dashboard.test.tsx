import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  countFindings, countRequirements, evalRows, joinChecks, nextStep, parseBlind, parseFrontmatter, parseProof, roleOf,
  roundReviewers, slugFromHead, stageOf, stages,
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

const RD = `# Export CSV

## Requirements
1. \`export\` writes a CSV of every customer.
2. Fields with commas are quoted.
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

// Stands for the engine beneath the plugin: a project at /repo holding the files in `files`.
function world(on: On, files: Record<string, string>, root = '/repo') {
  const seen = { status: [] as (string | undefined)[], toasts: [] as string[], opened: 0, ticks: 0, live: [] as string[] }
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

  expect(seen.status.at(-1)).toBe('Quorum · export-csv · IN_REVIEW · MEDIUM · round 2/3 · 1 pending')
  expect(seen.opened).toBe(1)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Review r2\/3/ }))).toBeDefined()
  expect((await band.find({ type: 'Text', text: /next: \/quorum:review-loop/ }))).toBeDefined()
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /2 review rounds, approved 2026-11-08/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /voter kept 2 of 4/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /2 candidates, voting/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /1 finding pending/ })).toBeDefined()
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
  expect(await pane.find({ type: 'Text', text: /2 runs/ })).toBeDefined()
  await pane.unmount()
})

test('a status change toasts once, and only for statuses worth it', async ($, on) => {
  const files: Record<string, string> = repo('IN_REVIEW')
  const seen = world(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(seen.toasts).toEqual([])

  files['.tasks/export-csv/state.md'] = state('CONVERGED')
  await $.tool.call({ tool: 'Bash', command: 'quorum-state set status CONVERGED' })
  expect(seen.toasts).toEqual(['Quorum · export-csv: review converged'])

  // An unrelated command doesn't re-read.
  files['.tasks/export-csv/state.md'] = state('HALTED')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(seen.toasts.length).toBe(1)
})

test('task files are read from the project root, not the working directory', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'), '/work/repo')
  await $.session.start({ cwd: '/work/repo/app', surface: 'terminal', isInteractive: true })
  expect(seen.status.at(-1)).toBe('Quorum · export-csv · IN_REVIEW · MEDIUM · round 2/3 · 1 pending')
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
  expect(await pane.find({ type: 'Text', text: /^  1 IMPORTANT · 1 NIT$/ })).toBeDefined()
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
  await pane.unmount()
})

test('checks join eval.md with the latest proof', async ($, on) => {
  const files: Record<string, string> = repo('BUILDING')
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /3 checks in eval.md, not run yet/ })).toBeDefined()
  await pane.unmount()

  files['.tasks/export-csv/proof-build.md'] = PROOF
  await $.tool.call({ tool: 'Write', file_path: '/repo/.tasks/export-csv/proof-build.md', content: PROOF })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^4 of 5 pass$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /proof-build.md at 1a2b3c4/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✗ 2  quotes commas$/ })).toBeDefined()
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^checks 4\/5$/ })).toBeDefined()
  await band.unmount()
})

test('the spec and blind-test stages show their own reports', async ($, on) => {
  const files: Record<string, string> = repo('DRAFT-AWAITING-VISUAL-SIGNOFF')
  files['.tasks/export-csv/spec-review/feasibility.md'] = 'Summary: 0 issues found. Ready to build.\n'
  world(on, files)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /3 requirements in rd.md · 3 checks in eval.md/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^✓ Feasibility critic  clean$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^○ Spec improver  waiting$/ })).toBeDefined()
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
  const marks = await pane.findAll({ type: 'Text', text: /^[●✓] $/ })
  // The stage list draws the same glyphs first; the two builders, under Other agents, are last.
  expect(marks.slice(-2).map(m => m.text)).toEqual(['✓ ', '● '])
  await pane.unmount()
})
