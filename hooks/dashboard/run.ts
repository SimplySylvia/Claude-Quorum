// A /quorum:run's pure model: read the session's marker as bin/quorum-run enter writes it (the start time, then
// `until STAGE` and `yes` for the run's own flags), say where the run stops next from the task's status and risk
// and those flags, and name the gate open now from the status alone; then the run's state (going, waiting on the
// person, or stopped), its words for the band by width, and what gives way on a band's row that doesn't fit them;
// and the texts of the run's announcements (waiting on the person, stopped, ended) and of its quiet status toasts.
// No `$` here, so tests can call it directly.

import type { RunMarker, RunStage } from '../../types'
import { cellWidth, cutEnd } from './tree'

// The stages `--until` takes, in the run's order: a stage's index is its place in the run.
const RUN_STAGES: RunStage[] = ['spec', 'plan', 'build', 'review', 'blind', 'pr']

// The run stage each status sits at. Not task.ts's STAGE_OF: a run's mockup sign-off belongs to the plan's stops.
const RUN_STAGE_OF: Record<string, RunStage> = {
  'DRAFT-AWAITING-VISUAL-SIGNOFF': 'plan',
  PLANNING: 'plan',
  BUILDING: 'build',
  IN_REVIEW: 'review',
  CONVERGED: 'blind',
  'BLIND-TEST': 'blind',
  READY: 'pr',
  'AWAITING-HUMAN': 'pr',
}

// The stops `--until build`, `review` and `blind` name.
const END_OF: Partial<Record<RunStage, string>> = { build: 'end of build', review: 'end of review', blind: 'end of blind test' }

// The marker's text: `since` is the HH:MM of a line 1 that reads `YYYY-MM-DD HH:MM`, `until` the stage of the first
// `until <stage>` line that names one, `isYes` whether a line reads `yes`. Every other line is ignored, so nothing
// of the file is kept but a time, a stage of RUN_STAGES and a flag. `escalated`, which `quorum-run escalated` adds
// for hooks/run-guard.sh, is such a line: the run reads the same with it.
export function parseRunMarker(text: string): RunMarker {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  const since = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})$/.exec(lines[0] ?? '')?.[1] ?? ''
  let until: RunStage | '' = ''
  let isYes = false
  for (const l of lines) {
    const stage = RUN_STAGES.find((s) => l === `until ${s}`)
    if (stage && !until) until = stage
    if (l === 'yes') isYes = true
  }
  return { since, until, isYes }
}

// Where the run stops next, in its long words and the words for a narrow band; null for a status no run goes on
// from (HALTED, ESCALATED, any other).
export function nextStop(status: string, risk: string, until: RunStage | '', isYes: boolean): { long: string; short: string } | null {
  const at = RUN_STAGE_OF[status]
  if (!at) return null
  const same = (word: string) => ({ long: word, short: word })
  if (status === 'DRAFT-AWAITING-VISUAL-SIGNOFF') return same(until === 'spec' ? 'end of spec' : 'mockup sign-off')
  if (status === 'PLANNING') {
    if (until === 'spec') return same('end of spec')
    if (!isYes || risk === 'HIGH') return same('plan approval')
    if (until === 'plan') return same('end of plan')
  }
  // A LOW task has no blind test, and a stage behind the status's is one the run has left.
  const end = until === 'blind' && risk === 'LOW' ? undefined : END_OF[until || 'pr']
  if (end && RUN_STAGES.indexOf(until || 'pr') >= RUN_STAGES.indexOf(at)) return same(end)
  return risk === 'LOW' ? same('PR drafted') : { long: 'PR drafted, then your review', short: 'your review' }
}

// The gate a run waiting on the user has open, from the status alone; '' for a status with no gate to name.
export function gateNow(status: string): string {
  if (status === 'DRAFT-AWAITING-VISUAL-SIGNOFF') return 'mockup sign-off'
  return status === 'PLANNING' ? 'plan approval' : ''
}

// What the main session's turn tells of a run, kept in memory by register.tsx: how many of its questions are open,
// how its last turn ended (null while one runs), and whether the wait after an `answer` end has begun.
export type RunTurn = { asking: number; ended: 'answer' | 'error' | 'refusal' | 'aborted' | null; isIdle: boolean }

// A run as the band and the pane show it: its state, why it stopped (null unless stopped), where it stops next
// (nextStop) and the gate open now (gateNow).
export type RunView = {
  state: 'going' | 'waiting' | 'stopped'
  reason: 'ESCALATED' | 'HALTED' | 'error' | 'refusal' | 'aborted' | null
  stop: { long: string; short: string } | null
  gate: string
}

// The run's state. Stopped wins over waiting, and a status reason over a turn reason.
export function runView(marker: RunMarker, status: string, risk: string, turn: RunTurn): RunView {
  const rest = { stop: nextStop(status, risk, marker.until, marker.isYes), gate: gateNow(status) }
  if (status === 'ESCALATED' || status === 'HALTED') return { state: 'stopped', reason: status, ...rest }
  if (turn.ended === 'error' || turn.ended === 'refusal' || turn.ended === 'aborted') return { state: 'stopped', reason: turn.ended, ...rest }
  return { state: turn.asking > 0 || turn.isIdle ? 'waiting' : 'going', reason: null, ...rest }
}

// The run's words for a band of `columns`, longest first, with their look; null when there are none to draw (a
// going run with no next stop). The first form is the width's own: the long one from 110 columns, the middle one
// from 90, else the short one. A problem comes first, so beside one the words start a size down: the middle form
// from 110 columns, the short one under. A stopped run reads the same at every width.
export function runForms(view: RunView, columns: number, hasProblem: boolean): { forms: string[]; color: 'claude' | 'warning' | 'error'; isBold: boolean } | null {
  if (view.state === 'stopped') return { forms: ['run stopped'], color: view.reason === 'aborted' ? 'warning' : 'error', isBold: false }
  const size = columns >= 110 ? 0 : columns >= 90 ? 1 : 2
  const first = hasProblem ? Math.min(2, size + 1) : size
  if (view.state === 'waiting') {
    const all = view.gate
      ? [`autopilot · waiting for you: ${view.gate}`, `waiting: ${view.gate}`, `◆ ${view.gate}`]
      : ['autopilot · waiting for you', 'waiting for you', '◆ waiting']
    return { forms: all.slice(first), color: 'warning', isBold: true }
  }
  if (!view.stop) return null
  const stop = columns >= 110 ? view.stop.long : view.stop.short
  return { forms: [`autopilot · next stop: ${stop}`, `auto · next: ${stop}`, `▸▸ ${stop}`].slice(first), color: 'claude', isBold: false }
}

// Why a run stopped, in the Run card's words. HALTED and ESCALATED have rows of their own: /quorum:run doesn't
// continue a halted task, and stops again on an escalated one until its checks pass.
const WHY = { error: 'API error', refusal: 'refused', aborted: 'interrupted' }

// Why a run stopped and what continues it: the Run card's last row, and the end of a stop's announcement.
export function stopRow(reason: NonNullable<RunView['reason']>): string {
  if (reason === 'HALTED') return 'HALTED · see the post-mortem'
  if (reason === 'ESCALATED') return 'ESCALATED · fix the checks, then /quorum:run'
  return `${WHY[reason]} · /quorum:run continues it`
}

// A message for the task `slug`: `<slug>: <text>`, or the text alone with no task to name.
export function withSlug(slug: string, text: string): string {
  return slug ? `${slug}: ${text}` : text
}

// The announcement of a run waiting on the person, with the gate open now when there is one.
export function waitingText(slug: string, gate: string): string {
  return withSlug(slug, gate ? `waiting for you · ${gate}` : 'the run is waiting for you')
}

// The announcement of a run that stopped: a halt, an escalation, or a turn that died.
export function stoppedText(slug: string, reason: Exclude<NonNullable<RunView['reason']>, 'aborted'>): string {
  return withSlug(slug, `run stopped · ${stopRow(reason)}`)
}

// The announcement of a run's end, with its task's status; `run ended` for a run with no task.
export function endedText(slug: string, status: string): string {
  return slug ? withSlug(slug, `run ended · ${status}`) : 'run ended'
}

// The toast, without the slug, for a status a run goes on from: the status and what the run does next, or the
// status alone when `until` stops the run there; null for a status with no toast in a run.
export function runToast(status: string, risk: string, until: RunStage | ''): string | null {
  if (status === 'CONVERGED') {
    if (risk === 'LOW') return 'CONVERGED · final proof next'
    return until === 'review' ? 'CONVERGED' : 'CONVERGED · blind test next'
  }
  if (status === 'READY') return until === 'review' ? 'READY' : 'READY · drafting the PR'
  if (status === 'AWAITING-HUMAN') return until === 'blind' ? 'AWAITING-HUMAN' : 'AWAITING-HUMAN · drafting the PR'
  return null
}

// `text` without its control characters (C0, DEL and C1), so a message can't carry a terminal's control codes.
export function stripControls(text: string): string {
  return text.replace(/[ --]/g, '')
}

// The run's own flags as the marker recorded them, `--until <stage>` then `--yes`.
const runFlags = (marker: RunMarker) => [marker.until ? `--until ${marker.until}` : '', marker.isYes ? '--yes' : ''].filter(Boolean)

// The command that continues a stopped run: /quorum:run with the flags it was started with, so the run stops where
// it would have.
export function runCommand(marker: RunMarker): string {
  return ['/quorum:run', ...runFlags(marker)].join(' ')
}

// The Run card's rows: `Run · autopilot` or `Run · stopped` with the start time when the marker has one (`since`
// it, or `started` at it for a stopped run, where `since` would read as when the run stopped), how the
// run was started (only the flags given), and what the state says: where the run stops next, what it waits on, or
// why it stopped and what continues it. A going run with no next stop has two rows.
export function runCardRows(marker: RunMarker, view: RunView): string[] {
  const isStopped = view.state === 'stopped'
  const head = `Run · ${isStopped ? 'stopped' : 'autopilot'}${marker.since ? ` · ${isStopped ? 'started' : 'since'} ${marker.since}` : ''}`
  const flags = runFlags(marker)
  const started = flags.length > 0 ? `started with ${flags.join(' ')}` : 'stops only where you must decide'
  const last = view.reason ? stopRow(view.reason)
    : view.state === 'waiting' ? (view.gate ? `waiting for you: ${view.gate}` : 'waiting for you')
      : view.stop ? `next stop: ${view.stop.long}` : ''
  return [head, started, ...(last ? [last] : [])]
}

// The columns the terminal draws around a Button's label: `[ Dashboard ]`, a bracket and a space on each side, as
// seen in a Claude Code 2.1.330 session.
export const BUTTON_FRAME = 4

// The band's row during a run, each top-level item's text as it would be drawn ('' for one not drawn): the status
// badge, the slug and risk, the stage dots with the stage's name, the progress, file count and review texts, the
// problem, and the buttons' labels.
export type RunRow = { badge: string; id: string; rail: string; extras: string[]; problem: string; buttons: string[] }

// Fit the row and the run's words (`forms`, longest first; [] for none) to `columns`: what is drawn of the words and
// of the problem, and whether the slug, the stage dots and the extras stay. A text counts as its cells, a button as
// its label plus BUTTON_FRAME, with 1 between buttons and 2 between items (the buttons are one item). Each step is
// taken only while the row is still too wide. Going or waiting, the words outrank the slug and the dots: the first
// form that fits whole, tried beside the whole row, then without the slug, then without the dots too. When none
// fits even so, the last form is cut at the end, down to its first word and the cut's mark, and a cut form outranks
// the slug and the dots too: it is tried beside the whole row, then without the slug, then without the dots. When
// not even that can be drawn there are no words, and the slug and the dots are back, to go only while the row is
// too wide without any words; then the problem is cut, and last the extras go.
// Stopped: the words stay whole, the problem is cut first, then the slug goes, the dots, and the extras. The badge
// and the buttons always stay.
export function fitRun(columns: number, row: RunRow, forms: string[], isStopped: boolean): { words: string; problem: string; hasId: boolean; hasRail: boolean; hasExtras: boolean } {
  const buttons = row.buttons.reduce((n, label) => n + cellWidth(label) + BUTTON_FRAME, 0) + Math.max(0, row.buttons.length - 1)
  const fit = { words: '', problem: row.problem, hasId: true, hasRail: true, hasExtras: true }
  // The columns left for `words` and `problem` beside every other item on show, each item 2 from the one before.
  const room = (words: string, problem: string) => {
    const texts = [row.badge, fit.hasId ? row.id : '', fit.hasRail ? row.rail : '', ...(fit.hasExtras ? row.extras : []), problem, words].filter(Boolean)
    const items = texts.length + (row.buttons.length > 0 ? 1 : 0)
    return columns - texts.reduce((n, text) => n + cellWidth(text), 0) - buttons - 2 * Math.max(0, items - 1)
  }
  const isWide = () => room(fit.words, fit.problem) < 0
  // The problem, cut to what the rest of the row leaves it.
  const cutProblem = () => {
    if (!isWide() || fit.problem === '') return
    const left = room(fit.words, '') - 2
    fit.problem = left < 2 ? '' : cutEnd(fit.problem, left)
  }
  if (isStopped) {
    fit.words = forms[0] ?? ''
    cutProblem()
  } else if (forms.length > 0) {
    const whole = () => forms.find(form => room(form, fit.problem) >= 0) ?? ''
    fit.words = whole()
    if (!fit.words && row.id) {
      fit.hasId = false
      fit.words = whole()
    }
    if (!fit.words && row.rail) {
      fit.hasRail = false
      fit.words = whole()
    }
    if (!fit.words) {
      // No form fits whole: the last one cut to what the row leaves it, '' when that is less than its first word
      // and the cut's mark. The slug and then the dots give way for it, as they do for a whole form.
      const last = forms[forms.length - 1] ?? ''
      const cut = () => {
        const left = room('', fit.problem) - 2
        return left >= cellWidth(last.split(' ')[0] ?? '') + 1 ? cutEnd(last, left) : ''
      }
      fit.hasId = true
      fit.hasRail = true
      fit.words = cut()
      if (!fit.words && row.id) {
        fit.hasId = false
        fit.words = cut()
      }
      if (!fit.words && row.rail) {
        fit.hasRail = false
        fit.words = cut()
      }
      // No words can be drawn without them either, so they stay unless the row is too wide (below).
      if (!fit.words) {
        fit.hasId = true
        fit.hasRail = true
      }
    }
  }
  if (isWide()) fit.hasId = false
  if (isWide()) fit.hasRail = false
  if (!isStopped) cutProblem()
  if (isWide()) fit.hasExtras = false
  return fit
}
