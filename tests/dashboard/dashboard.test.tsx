import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { countFindings, nextStep, parseFrontmatter, slugFromHead, stageOf, stages } from '../../hooks/dashboard/task'

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

test('quorum agents show while they run and tick when they finish', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(seen.ticks).toBe(0)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'review', description: 'Logic hunter', subagentType: 'quorum:code-reviewer', parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  expect(seen.ticks).toBe(1)
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^● $/ })).toBeDefined()
  await pane.unmount()

  await $.turn.complete({ agentId: 'a1', turnId: 'x', answer: 'done', reason: 'answer', durationMs: 1, isAborted: false })
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^✓ $/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Logic hunter/ })).toBeDefined()
  await pane.unmount()

  // The first interval was cancelled when the agent finished, so the next agent starts a new one.
  await $.agent.spawn({ tool_use_id: 't2', prompt: 'vote', description: 'Voter', subagentType: 'quorum:verifier-voter', parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  expect(seen.ticks).toBe(2)
})

test('a reload marks agents the engine no longer runs as finished', async ($, on) => {
  const seen = world(on, repo('IN_REVIEW'))
  on('agent.spawn', (_, e) => ({ model: 'claude-opus-5-5', agentId: e.description }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const spawn = (description: string) => $.agent.spawn({ tool_use_id: description, prompt: 'review', description, subagentType: 'quorum:code-reviewer', parentModel: 'claude-opus-5-5', provider: { plugin: 'quorum', tier: 'user' }, background: false, fork: false })
  await spawn('gone')
  await spawn('alive')
  seen.live = ['alive']

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const marks = await pane.findAll({ type: 'Text', text: /^[●✓] $/ })
  // The stage list draws the same glyphs first; the agents are the last two.
  expect(marks.slice(-2).map(m => m.text)).toEqual(['✓ ', '● '])
  await pane.unmount()
})
