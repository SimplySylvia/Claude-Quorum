// A map's pure model: read .tasks/map-<slug>/'s map.md, tickets and tasks.md the way bin/quorum-map does, order the
// tickets under their first blocker, say each ticket's and each task's state, and place the map on its four phases
// (Chart, Tickets, Hand off, Tasks). `quorum-map tasks`' result is stored with the map's slug, and every reader goes
// through statesOf, so another map's result reads as no states. No `$` here, so tests can call it directly.

import type { MapLine, MapStates, MapTask, MapTaskRun, MapTicket, MapView } from '../../types'
import { GLYPH, plural, section, stages, whoseMove } from './task'
import type { TreePart } from './tree'

// bin/quorum-map's valid_slug and valid_session: checked before any path is built from them.
export const isMapSlug = (s: string) => /^[a-z0-9][a-z0-9.-]*$/.test(s)
export const isSessionId = (s: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s)

// A `- ` line of a map.md section; `- [title](tickets/NN-x.md): gist` links ticket NN.
function mapLine(line: string): MapLine {
  const text = line.replace(/^- /, '')
  const m = /^\[([^\]]*)\]\(tickets\/(\d\d)-[^)]*\.md\):[ \t]*(.*)$/.exec(text)
  return m ? { text, ticket: m[2] ?? '', title: m[1] ?? '', gist: m[3] ?? '' } : { text, ticket: '', title: '', gist: '' }
}

// map.md's title (its first `# ` line, without the template's `Map: `), its Destination (the non-blank lines outside
// `<!-- -->`, as quorum-map check reads it, joined with spaces), and its Decisions so far and Out of scope lines.
export function parseMapMd(text: string): { title: string; destination: string; decisions: MapLine[]; outOfScope: MapLine[] } {
  const title = (/^# (.*)$/m.exec(text)?.[1] ?? '').replace(/^Map: /, '').trim()
  const destination: string[] = []
  let isComment = false
  for (const l of section(text, 'Destination')) {
    if (!/^[ \t]*$/.test(l) && !/^[ \t]*<!--/.test(l) && !isComment) destination.push(l.trim())
    if (l.includes('<!--') && !l.includes('-->')) isComment = true
    if (l.includes('-->')) isComment = false
  }
  const items = (heading: string) => section(text, heading).filter(l => l.startsWith('- ')).map(mapLine)
  return { title, destination: destination.join(' '), decisions: items('Decisions so far'), outOfScope: items('Out of scope') }
}

// A ticket file, as quorum-map's list_tickets reads it: `field` takes the first `KEY:` line before the first `## `,
// trimmed; `blockers_of` pads each number in `Blocked by:` to two digits. Null without a `Status:` line, or when the
// file isn't named NN-<name>.md. `gist` is '' here: joinGists fills it from map.md.
export function parseTicket(file: string, text: string): MapTicket | null {
  const n = /^(\d\d)-/.exec(file)?.[1]
  if (n === undefined) return null
  const lines = text.split('\n')
  const head = lines.slice(0, (i => (i < 0 ? undefined : i))(lines.findIndex(l => l.startsWith('## '))))
  const field = (key: string) => {
    const line = head.find(l => l.startsWith(`${key}:`))
    return line === undefined ? null : line.slice(key.length + 1).replace(/^[ \t]+|[ \t]+$/g, '')
  }
  const status = field('Status')
  if (status === null) return null
  return {
    n,
    title: /^# (.*)$/m.exec(text)?.[1] ?? '',
    type: field('Type') ?? '',
    blockedBy: (field('Blocked by') ?? '').split(/[,\s]+/).filter(b => /^\d+$/.test(b)).map(b => String(Number(b)).padStart(2, '0')),
    status,
    answeredBy: field('Answered by') ?? '',
    question: section(text, 'Question').map(l => l.trim()).filter(l => l !== '').join(' '),
    gist: '',
  }
}

// Each ticket's gist: an out-of-scope ticket's reason from Out of scope, any other's line in Decisions so far.
export function joinGists(tickets: MapTicket[], decisions: MapLine[], outOfScope: MapLine[]): MapTicket[] {
  return tickets.map(t => {
    const from = t.status === 'out-of-scope' ? outOfScope : decisions
    return { ...t, gist: from.find(l => l.ticket === t.n)?.gist ?? '' }
  })
}

// tasks.md's numbered lines, as quorum-map's task_lines splits them: the request, then ` · `-separated `tier:` and
// `blocked by:` parts (`none` for no blockers).
export function parseTasksMd(text: string): MapTask[] {
  const out: MapTask[] = []
  for (const line of text.split('\n')) {
    if (!/^[0-9]+\.[ \t]/.test(line)) continue
    const [request = '', ...parts] = line.replace(/^[0-9]+\.[ \t]+/, '').split(' · ')
    let tier = ''
    let blockedBy: number[] = []
    for (const p of parts) {
      if (p.startsWith('tier:')) tier = p.replace(/^tier:[ \t]*/, '')
      else if (p.startsWith('blocked by:')) {
        const bl = p.replace(/^blocked by:/, '').replace(/[ \t]/g, '')
        blockedBy = bl === 'none' || bl === '' ? [] : bl.split(',').filter(b => /^\d+$/.test(b)).map(Number)
      }
    }
    out.push({ n: Number(/^(\d+)/.exec(line)?.[1]), request, tier, blockedBy })
  }
  return out
}

// `quorum-map tasks`' `N<TAB>STATE<TAB>…` lines, by task number, for the numbers tasks.md has only.
export function parseTaskStates(stdout: string, known: number[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const [n = '', state = ''] = line.split('\t')
    if (/^\d+$/.test(n) && state !== '' && known.includes(Number(n))) out[String(Number(n))] = state
  }
  return out
}

// ---- Tickets

export const isClosed = (t: MapTicket) => t.status === 'resolved' || t.status === 'out-of-scope'

// The blockers that are missing or still open, in `Blocked by:` order.
export const openBlockers = (t: MapTicket, all: MapTicket[]) =>
  t.blockedBy.filter(b => { const x = all.find(o => o.n === b); return !x || !isClosed(x) })

// quorum-map's frontier: open, and every blocker closed.
export const isFrontier = (t: MapTicket, all: MapTicket[]) => t.status === 'open' && openBlockers(t, all).length === 0

// The deepest a ticket is drawn: a ticket further down a chain sits at this level (6 columns).
export const MAX_TICKET_DEPTH = 3

// Every ticket once, each under its first blocker (at the top level when that ticket doesn't exist), siblings in
// file order. A ticket left after the walk from the top (one in a cycle) starts a walk of its own, in file order.
export function ticketOrder(tickets: MapTicket[]): { ticket: MapTicket; depth: number }[] {
  const ns = new Set(tickets.map(t => t.n))
  const under = new Map<string, MapTicket[]>()
  for (const t of tickets) {
    const first = t.blockedBy[0]
    if (first !== undefined && ns.has(first)) under.set(first, [...(under.get(first) ?? []), t])
  }
  const out: { ticket: MapTicket; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (root: MapTicket) => {
    const stack = [{ ticket: root, depth: 0 }]
    while (stack.length > 0) {
      const { ticket, depth } = stack.pop() as { ticket: MapTicket; depth: number }
      if (seen.has(ticket.n)) continue
      seen.add(ticket.n)
      out.push({ ticket, depth: Math.min(depth, MAX_TICKET_DEPTH) })
      const kids = (under.get(ticket.n) ?? []).filter(k => !seen.has(k.n))
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ ticket: kids[i] as MapTicket, depth: depth + 1 })
    }
  }
  for (const t of tickets) if (!seen.has(t.n) && !(t.blockedBy[0] !== undefined && ns.has(t.blockedBy[0]))) walk(t)
  for (const t of tickets) if (!seen.has(t.n)) walk(t)
  return out
}

// `N tickets · R resolved · O out of scope · K ready`, zero counts left out except R resolved.
export function ticketSummary(tickets: MapTicket[]): string {
  const outOfScope = tickets.filter(t => t.status === 'out-of-scope').length
  const ready = tickets.filter(t => isFrontier(t, tickets)).length
  return [
    tickets.length > 0 ? plural(tickets.length, 'ticket') : '',
    `${tickets.filter(t => t.status === 'resolved').length} resolved`,
    outOfScope > 0 ? `${outOfScope} out of scope` : '',
    ready > 0 ? `${ready} ready` : '',
  ].filter(Boolean).join(' · ')
}

// Only the user answers a grilling or prototype ticket, so a claimed one waits on them.
const isUsers = (t: MapTicket) => t.type === 'grilling' || t.type === 'prototype'

// The ticket being worked: the first claimed one that waits on the user, else the first claimed one, else null.
export function nowTicket(tickets: MapTicket[]): MapTicket | null {
  const claimed = tickets.filter(t => t.status === 'claimed')
  return claimed.find(isUsers) ?? claimed[0] ?? null
}

// A ticket row's mark and status, and their colours (a `wordColor` of '' draws dim). `type` shows while the ticket
// is open or claimed, else it's null. `words`, for a label, adds who decided a resolved ticket.
export function ticketStatus(t: MapTicket, all: MapTicket[], isAgentRunning: boolean): { mark: string; markColor: string; word: string; wordColor: string; type: string | null; words: string } {
  const row = (mark: string, markColor: string, word: string, wordColor: string, words = word) =>
    ({ mark, markColor, word, wordColor, type: isClosed(t) ? null : t.type, words })
  if (t.status === 'resolved') {
    return t.answeredBy === 'user'
      ? row('✓', 'success', 'you', 'success', 'resolved, decided by you')
      : row('✓', 'subtle', 'agent', 'claude', 'resolved, decided by the agent')
  }
  if (t.status === 'out-of-scope') return row('–', 'inactive', 'out of scope', '')
  if (t.status === 'claimed') {
    if (isUsers(t)) return row('◆', 'warning', 'your answer', 'warning')
    return isAgentRunning ? row('●', 'claude', 'in progress', 'claude') : row('○', 'subtle', 'claimed', 'subtle')
  }
  const open = openBlockers(t, all)
  return open.length === 0 ? row('○', 'subtle', 'ready', 'subtle') : row('○', 'inactive', `after ${open.join(', ')}`, 'inactive')
}

// ---- The stored quorum-map tasks result: only the map it was run for reads it.

export const statesOf = (m: MapView, s: MapStates | null): Record<string, string> | null =>
  s !== null && s.slug === m.slug ? s.states : null

export const isHandoffOf = (m: MapView, s: MapStates | null) => s?.slug === m.slug && s.isHandoff

// ---- Phase and stepper

const MAP_PHASES = ['Chart', 'Tickets', 'Hand off', 'Tasks'] as const

// 0 Chart: no tickets; 1 Tickets: any ticket open or claimed; 3 Tasks: tasks.md and a voted breakdown review, or a
// task started from the map; else 2 Hand off. No session marker plays a part.
export function mapPhase(m: MapView): number {
  if (m.tickets.length === 0) return 0
  if (m.tickets.some(t => !isClosed(t))) return 1
  if ((m.tasks !== null && m.review?.voter.findings != null) || m.runs.length > 0) return 3
  return 2
}

// The map waits on the user: a claimed grilling or prototype ticket, or a reviewed breakdown no task has started.
export function mapWaits(m: MapView): boolean {
  const t = nowTicket(m.tickets)
  return (t !== null && isUsers(t)) || (mapPhase(m) === 3 && m.runs.length === 0)
}

export const mergedCount = (m: MapView, s: MapStates | null) => {
  const states = statesOf(m, s)
  return (m.tasks ?? []).filter(t => states?.[String(t.n)] === 'merged').length
}

export const readyTasks = (m: MapView, s: MapStates | null): MapTask[] => {
  const states = statesOf(m, s)
  return (m.tasks ?? []).filter(t => states?.[String(t.n)] === 'ready')
}

// One part list per phase: `✓` done, the current one `◆` when it waits on the user and `●` otherwise, later ones
// `○`; the current label bold and the others dim. `Tickets R/I` counts resolved of in-scope tickets, and `Tasks M/N`
// merged of all tasks.
export function mapStepper(m: MapView, s: MapStates | null): TreePart[][] {
  const phase = mapPhase(m)
  const inScope = m.tickets.filter(t => t.status !== 'out-of-scope')
  const counts = [
    '',
    m.tickets.length > 0 ? ` ${inScope.filter(t => t.status === 'resolved').length}/${inScope.length}` : '',
    '',
    m.tasks !== null && m.tasks.length > 0 ? ` ${mergedCount(m, s)}/${m.tasks.length}` : '',
  ]
  return MAP_PHASES.map((name, i) => {
    const [mark, color] = i < phase ? ['✓', 'success'] : i > phase ? ['○', 'inactive'] : mapWaits(m) ? ['◆', 'warning'] : ['●', 'claude']
    const label = ` ${name}${counts[i] ?? ''}`
    return [{ text: mark, color }, i === phase ? { text: label, bold: true } : { text: label, dim: true }]
  })
}

// ---- Tasks

// A task's state as one word, mark and colour (rd.md requirement 5's table), from this map's stored states. Null
// for `unknown` or no state.
export function taskState(task: MapTask, m: MapView, s: MapStates | null, isAgentRunning: boolean): { word: string; mark: string; color: string } | null {
  const states = statesOf(m, s)
  const st = states?.[String(task.n)]
  if (st === undefined || st === '' || st === 'unknown') return null
  if (st === 'merged') return { word: 'merged', mark: '✓', color: 'success' }
  if (st === 'ready') return { word: 'ready', mark: '○', color: 'subtle' }
  if (st === 'blocked') {
    const waits = task.blockedBy.filter(b => states?.[String(b)] !== 'merged')
    return { word: `after task ${waits.join(', ')}`, mark: '○', color: 'inactive' }
  }
  const word = st.toLowerCase().replace(/[_-]/g, ' ')
  const move = whoseMove(st)
  if (move === 'warning') return { word: 'your move', mark: '◆', color: 'warning' }
  if (move === 'error') return { word, mark: '✗', color: 'error' }
  return isAgentRunning ? { word, mark: '●', color: 'claude' } : { word, mark: '○', color: 'subtle' }
}

// The stage names short enough for a task row: `Blind test` reads `Blind`.
const SHORT_STAGES: Record<string, string> = { 'Blind test': 'Blind' }

// A task's six stage dots from its state.md, as the Task card's stepper places them (every stage to do before a
// run exists), and the current stage's short name: `done` once merged, '' with no stage under way.
export function taskDots(run: MapTaskRun | null, tier: string, isMerged: boolean): { parts: TreePart[]; stage: string } {
  const rail = (run ? stages(run.status, run.risk || tier, run.stage, run.isFast) : stages('', tier, -1))
    .map(st => (isMerged && st.state !== 'skipped' ? { ...st, state: 'done' as const } : st))
  const parts = rail.map(st => { const [text, color] = GLYPH[st.state]; return { text, color } })
  if (isMerged) return { parts, stage: 'done' }
  const at = rail.find(st => st.state === 'active' || st.state === 'waiting' || st.state === 'stuck')
  return { parts, stage: at ? SHORT_STAGES[at.name] ?? at.name : '' }
}

// The stored result after a `quorum-map tasks` run for `slug` (`parsed` is null when it failed): a failure keeps the
// last states and ready set for the same map and stamps the attempt. A task newly ready since a recorded ready set is
// a hand-off, kept until another map's result.
export function nextStates(prev: MapStates | null, slug: string, parsed: Record<string, string> | null, at: number, tasks: MapTask[]): { value: MapStates; isReadyChange: boolean } {
  const same = prev !== null && prev.slug === slug
  if (parsed === null) {
    return { value: { slug, states: same ? prev.states : null, triedAt: at, ready: same ? prev.ready : null, isHandoff: same && prev.isHandoff }, isReadyChange: false }
  }
  const ready = tasks.filter(t => parsed[String(t.n)] === 'ready').map(t => t.n)
  const was = same ? prev.ready : null
  const isReadyChange = was !== null && ready.some(n => !was.includes(n))
  return { value: { slug, states: parsed, triedAt: at, ready, isHandoff: (same && prev.isHandoff) || isReadyChange }, isReadyChange }
}
