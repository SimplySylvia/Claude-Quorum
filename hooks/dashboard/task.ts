// Pure helpers for the dashboard: read state.md's frontmatter the way bin/quorum-state does, place a status on
// the stage rail, count findings the way bin/quorum-findings does, and read the specs, proofs, and reports the skills
// save in .tasks/<slug>/. No `$` here, so tests can call them directly.

import type { Blind, Check, Findings, Frontmatter, Proof, Reviewer, Stage } from '../../types'

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

// The numbered items under rd.md's "## Requirements".
export function countRequirements(rd: string): number {
  return section(rd, 'Requirements').filter(l => /^\d+\.\s+\S/.test(l)).length
}

// The rows of eval.md's "## Task checks" table, as `#` and requirement.
export function evalRows(evalMd: string): { id: string; label: string }[] {
  return tableRows(section(evalMd, 'Task checks'))
    .map(cells => ({ id: cells[0] ?? '', label: cells[1] ?? '' }))
    .filter(r => r.id !== '')
}

// The prover's report: "Proof: <slug> at <rev>", "Result: ...", and its | # | Check | Result | Evidence | table.
export function parseProof(text: string, file: string): Proof {
  const rows = tableRows(text.split('\n'))
    .map(cells => ({ id: cells[0] ?? '', check: cells[1] ?? '', result: (cells[2] ?? '').toUpperCase() }))
    .filter(r => r.id !== '' && /^(PASS|FAIL|SKIPPED)$/.test(r.result))
  return {
    file,
    rev: /^Proof:.* at (\S+)/m.exec(text)?.[1] ?? '',
    result: /^Result:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '',
    rows,
  }
}

// eval.md's rows with the latest proof's result for each; the fast checks first, and any proof row eval.md lacks
// (a fail-before-fix row like "7b") after its own.
export function joinChecks(rows: { id: string; label: string }[], proof: Proof | null): Check[] {
  const results = new Map((proof?.rows ?? []).map(r => [r.id, r]))
  const result = (id: string) => (results.get(id)?.result ?? null) as Check['result']
  const out: Check[] = [{ id: 'fast', label: 'verify-completion.sh', result: result('fast') }]
  for (const row of rows) out.push({ id: row.id, label: row.label, result: result(row.id) })
  for (const r of proof?.rows ?? []) {
    if (!out.some(c => c.id === r.id)) out.push({ id: r.id, label: r.check, result: r.result as Check['result'] })
  }
  return out
}

export function parseBlind(run: number, files: { blind?: string; a11y?: string; security?: string; triage?: string }): Blind {
  const lines = (text = '') => text.split('\n')
  const caused = (() => {
    let inCaused = false
    let n = 0
    for (const l of lines(files.triage)) {
      if (/^[A-Z-]+:\s*$/.test(l)) inCaused = l.startsWith('CAUSED')
      else if (inCaused && l.startsWith('- ')) n++
    }
    return n
  })()
  return {
    run,
    result: /^Result:\s*(REACHED|NOT REACHED)/m.exec(files.blind ?? '')?.[1] ?? '',
    blockers: lines(files.blind).filter(l => /^-\s*BLOCKER:/.test(l)).length,
    friction: lines(files.blind).filter(l => /^-\s*FRICTION:/.test(l)).length,
    a11y: files.a11y === undefined ? null : countFindings(files.a11y).important,
    security: files.security === undefined ? null : countFindings(files.security).important,
    caused: files.triage === undefined ? null : caused,
  }
}

// Which reviewer an agent is, from its type and the persona its prompt names.
export function roleOf(type: string, prompt: string): string {
  const persona = /Persona:\s*([^.\n]+)/.exec(prompt)?.[1] ?? ''
  if (type === 'code-reviewer') {
    if (/Architecture/i.test(persona)) return 'architecture'
    if (/Test Adequacy/i.test(persona)) return 'tests'
    return 'logic'
  }
  if (type === 'spec-reviewer') return /Improver/i.test(persona) ? 'improver' : 'feasibility'
  const roles: Record<string, string> = {
    'pattern-auditor': 'patterns', 'docs-auditor': 'docs', 'a11y-auditor': 'a11y', 'security-reviewer': 'security',
    'verifier-voter': 'voter', 'blind-user': 'blind', 'friction-triager': 'triage',
  }
  return roles[type] ?? type
}

export const ROLE_LABEL: Record<string, string> = {
  logic: 'Logic & edge cases', architecture: 'Architecture & drift', patterns: 'Patterns', docs: 'Docs',
  tests: 'Test adequacy', a11y: 'Accessibility', security: 'Security', voter: 'Verifier vote',
  feasibility: 'Feasibility critic', improver: 'Spec improver', blind: 'Blind user', triage: 'Friction triage',
}

// The reviewers a round runs, per skills/plan and skills/review-loop: the ones the tier always gets, plus any
// conditional one (tests, a11y, security) that left a reply. `files` maps a reviewer's file to its text.
export function roundReviewers(kind: 'plan' | 'review', risk: string, files: Record<string, string>): Reviewer[] {
  const isWide = risk === 'MEDIUM' || risk === 'HIGH'
  const always = ['logic', ...(isWide ? ['architecture', 'patterns', 'docs'] : []), ...(kind === 'plan' && risk === 'HIGH' ? ['security'] : [])]
  const roles = [...always, ...['docs', 'tests', 'a11y', 'security'].filter(r => !always.includes(r) && files[`${r}.md`] !== undefined)]
  return roles.map(role => reviewer(role, files[`${role}.md`]))
}

export function reviewer(role: string, text: string | undefined): Reviewer {
  return text === undefined ? { role, findings: null } : { role, findings: countFindings(text) }
}

function section(text: string, heading: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${heading}`)
  if (start < 0) return []
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l))
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

// A markdown table's body rows as trimmed cells, header and separator left out.
function tableRows(lines: string[]): string[][] {
  const rows = lines.filter(l => l.trim().startsWith('|')).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
  return rows.filter((cells, i) => !cells.every(c => /^:?-+:?$/.test(c)) && !(i === 0 && cells[0] === '#'))
}
