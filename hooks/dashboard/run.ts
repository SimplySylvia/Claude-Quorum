// A /quorum:run's pure model: read the session's marker as bin/quorum-run enter writes it (the start time, then
// `until STAGE` and `yes` for the run's own flags), say where the run stops next from the task's status and risk
// and those flags, and name the gate open now from the status alone. No `$` here, so tests can call it directly.

import type { RunMarker, RunStage } from '../../types'

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
// of the file is kept but a time, a stage of RUN_STAGES and a flag.
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
