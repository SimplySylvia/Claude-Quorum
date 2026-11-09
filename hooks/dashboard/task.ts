// Pure helpers for the dashboard: read state.md's frontmatter the way bin/quorum-state does, place a status on
// the stage rail, and count findings the way bin/quorum-findings does. No `$` here, so tests can call them directly.

import type { Findings, Frontmatter, Stage } from '../../types'

export const STAGES = ['Spec', 'Plan', 'Build', 'Review', 'Blind test', 'PR'] as const

// Where each status sits on the rail. HALTED and ESCALATED keep the stage the task was in (see stageOf).
const STAGE_OF: Record<string, number> = {
  'DRAFT-AWAITING-VISUAL-SIGNOFF': 0,
  PLANNING: 1,
  BUILDING: 2,
  IN_REVIEW: 3,
  CONVERGED: 4,
  'BLIND-TEST': 4,
  READY: 5,
  'AWAITING-HUMAN': 5,
}

// The same table as skills/pipeline-laws "Where a task is, and what comes next".
const NEXT: Record<string, string> = {
  'DRAFT-AWAITING-VISUAL-SIGNOFF': 'Review mockup.html, then /quorum:plan',
  PLANNING: '/quorum:plan',
  BUILDING: '/quorum:build, or /quorum:review-loop once code exists',
  IN_REVIEW: '/quorum:review-loop',
  CONVERGED: '/quorum:blind-test',
  'BLIND-TEST': 'Wait for /quorum:blind-test to finish',
  READY: '/quorum:pr-draft',
  'AWAITING-HUMAN': 'Review the files in the summary, then /quorum:pr-draft',
  HALTED: 'Pick a redesign from the post-mortem, then /quorum:spec-and-eval --redesign',
  ESCALATED: 'Fix the failing checks; the next pass restores the status',
}

export const isStuck = (status: string) => status === 'HALTED' || status === 'ESCALATED'

const unquote = (v: string) => {
  if (v.startsWith('"')) {
    let out = ''
    for (let i = 1; i < v.length; i++) {
      const c = v[i]
      if (c === '\\') { i++; out += v[i] ?? ''; continue }
      if (c === '"') break
      out += c
    }
    return out
  }
  return v.replace(/\s+#.*$/, '').trim()
}

export function parseFrontmatter(text: string): Frontmatter {
  const out: Frontmatter = {}
  const lines = text.split('\n')
  if (lines[0] !== '---') return out
  let cur = ''
  for (const line of lines.slice(1)) {
    if (line === '---') break
    if (/^\s*(#.*)?$/.test(line)) continue
    const item = /^\s+- (.*)$/.exec(line)
    if (item) {
      const list = out[cur]
      if (Array.isArray(list)) list.push(unquote(item[1] ?? ''))
      continue
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    cur = kv[1] ?? ''
    const val = kv[2] ?? ''
    if (val === '' || val.startsWith('#')) out[cur] = []
    else if (val.startsWith('[')) {
      out[cur] = val.replace(/^\[/, '').replace(/\]\s*(#.*)?$/, '')
        .split(',').map(p => unquote(p.trim())).filter(p => p !== '')
    } else out[cur] = unquote(val)
  }
  return out
}

export const scalar = (fm: Frontmatter, key: string) => {
  const v = fm[key]
  return typeof v === 'string' && v !== 'null' && v !== '~' ? v : ''
}

export const count = (fm: Frontmatter, key: string) => Number(scalar(fm, key)) || 0

export const list = (fm: Frontmatter, key: string) => {
  const v = fm[key]
  return Array.isArray(v) ? v : []
}

export function stageOf(status: string, previous: number | undefined): number {
  return STAGE_OF[status] ?? previous ?? STAGE_OF.IN_REVIEW ?? 3
}

export function stages(status: string, risk: string, current: number): Stage[] {
  return STAGES.map((name, i) => {
    if (name === 'Blind test' && risk === 'LOW') return { name, state: 'skipped' }
    if (i < current) return { name, state: 'done' }
    if (i > current) return { name, state: 'todo' }
    if (isStuck(status)) return { name, state: 'stuck' }
    // A finished stage that waits on the person: CONVERGED (LOW skips blind test), READY, AWAITING-HUMAN.
    if (status === 'READY' || status === 'AWAITING-HUMAN') return { name, state: 'waiting' }
    return { name, state: 'active' }
  })
}

export function nextStep(status: string, risk: string): string {
  if (status === 'CONVERGED' && risk === 'LOW') return 'LOW tasks already have their summary'
  return NEXT[status] ?? '/quorum:spec-and-eval'
}

export function countFindings(text: string): Findings {
  const tally = (tag: string) => text.split('\n').filter(l => l.startsWith(`[${tag}]`)).length
  return { important: tally('IMPORTANT'), nit: tally('NIT'), preExisting: tally('PRE-EXISTING') }
}

// The branch rule of bin/quorum-active-task: feat/<slug> or fix/<slug>.
export function slugFromHead(head: string): string {
  const m = /^ref: refs\/heads\/(?:feat|fix)\/([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/.exec(head.trim())
  return m?.[1] ?? ''
}
