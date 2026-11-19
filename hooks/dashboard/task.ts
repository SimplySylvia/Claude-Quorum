// Pure helpers for the dashboard: read state.md's frontmatter the way bin/quorum-state does, place a status on
// the stage rail, count findings the way bin/quorum-findings does, and read the specs, proofs, and reports the skills
// save in .tasks/<slug>/. No `$` here, so tests can call them directly.

import type { Blind, ChangedFile, Check, FileList, Findings, Frontmatter, KeptFinding, PlanStep, Proof, PullRequest, QuorumAgent, Requirement, Reviewer, Section, Snapshot, Spec, Spend, Stage, Verdict } from '../../types'
import { cellWidth, cutEnd, repoPath, slashes } from './tree'

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

// A stage's mark and its colour, on the stage rail and the map's task dots.
export const GLYPH: Record<Stage['state'], [string, string]> = {
  done: ['✓', 'success'],
  active: ['●', 'claude'],
  waiting: ['◆', 'warning'],
  stuck: ['✗', 'error'],
  todo: ['○', 'inactive'],
  skipped: ['–', 'inactive'],
}

// The status badge's color: amber when the task waits on the person, red when it's stuck, else the accent.
export const whoseMove = (status: string) =>
  isStuck(status) ? 'error' : status === 'READY' || status === 'AWAITING-HUMAN' || status === 'DRAFT-AWAITING-VISUAL-SIGNOFF' ? 'warning' : 'claude'

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

// A state.md's stage. ESCALATED records the status it interrupted; HALTED comes from the review loop, or from blind
// test after 2 runs. `previous`: the stage the same task was last at, kept for a status the rail doesn't place.
export function stageFor(fm: Frontmatter, previous?: number): number {
  const status = scalar(fm, 'status')
  return status === 'ESCALATED' && scalar(fm, 'escalated_from')
    ? stageOf(scalar(fm, 'escalated_from'), undefined)
    : status === 'HALTED' && count(fm, 'blind_runs') > 0
      ? STAGES.indexOf('Blind test')
      : stageOf(status, previous)
}

// A fast-path task (`fast: true`) has no plan round, so its Plan stage is skipped too.
export function stages(status: string, risk: string, current: number, isFast = false): Stage[] {
  return STAGES.map((name, i) => {
    if (name === 'Blind test' && risk === 'LOW') return { name, state: 'skipped' }
    if (name === 'Plan' && isFast) return { name, state: 'skipped' }
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

// How many steps plan.md has under "## Steps" (bin/quorum-plan steps).
export function countPlanSteps(plan: string): number {
  return section(plan, 'Steps').filter(l => /^\d+\.\s/.test(l)).length
}

// plan.md's steps, with the lines `quorum-plan show N` prints for each (bin/quorum-plan's steps_section and show awk,
// rule for rule): the section runs from the line "## Steps" to the next # or ## heading; a step is its numbered line,
// then each line that repeats its own number or is indented, skipping blank ones, up to the next numbered or
// unindented line. A number already read is ignored, with its indented lines, since `show N` stops at its first run.
export function parsePlanSteps(plan: string): PlanStep[] {
  const lines = plan.split('\n')
  const start = lines.indexOf('## Steps')
  if (start < 0) return []
  const steps: PlanStep[] = []
  const seen = new Set<string>()
  let cur: { num: string; step: PlanStep } | null = null
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (/^#{1,2}[ \t]/.test(l)) break
    const num = /^(\d+)\.[ \t]/.exec(l)?.[1]
    if (cur && num === cur.num) { cur.step.to = i + 1; continue }
    if (num !== undefined) {
      cur = null
      if (seen.has(num)) continue
      seen.add(num)
      const bold = /\*\*(.+?)\*\*/.exec(l)?.[1]
      const reqs = /·[ \t]*requirements:([^·]*)/.exec(l)?.[1] ?? ''
      const step = {
        n: Number(num),
        title: plain(bold ?? l.replace(/^\d+\.[ \t]+/, '')),
        requirements: reqs.split(/[,\s]+/).filter(r => /^\d+$/.test(r)).map(Number),
        from: i + 1,
        to: i + 1,
      }
      steps.push(step)
      cur = { num, step }
      continue
    }
    if (!cur || /^[ \t]*$/.test(l)) continue
    if (/^[ \t]/.test(l)) cur.step.to = i + 1
    else cur = null
  }
  return steps
}

// A plan of this many steps or more is built a step at a time (bin/quorum-plan sliced).
export const SLICE_AT = 4

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

// The prover's report: "Proof: <slug> at <rev>", "Result: ...", its | # | Check | Result | Evidence | table, and in
// a final proof its | Req | Verdict | Evidence | table under "## Requirements".
export function parseProof(text: string, file: string): Proof {
  const rows = tableRows(text.split('\n'))
    .map(cells => ({ id: cells[0] ?? '', check: cells[1] ?? '', result: (cells[2] ?? '').toUpperCase() }))
    .filter(r => r.id !== '' && /^(PASS|FAIL|SKIPPED)$/.test(r.result))
  const verdicts = tableRows(section(text, 'Requirements'))
    .map(cells => ({ n: (cells[0] ?? '').replace(/^R/, ''), verdict: (cells[1] ?? '').replace(/\*/g, '').toUpperCase(), evidence: plain(cells[2] ?? '') }))
    .filter((v): v is Verdict => /^\d+$/.test(v.n) && /^(MET|PARTIAL|MISSING|CONTRADICTS)$/.test(v.verdict))
  return {
    file,
    rev: /^Proof:.* at (\S+)/m.exec(text)?.[1] ?? '',
    result: /^Result:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '',
    rows,
    verdicts,
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

// A blind run as the handoff's Blind test row reads it. `text`: `run R`, then its parts joined by ` · `, the ones that
// make the run not clean first (security, a11y, caused, blockers, not reached, no report, triage: no report), so a
// cut row still shows them; then the rest in the order result, blockers, triage. `words`: the label's, in that
// usual order. `isClean`: reached, no blocker, nothing caused, and no accessibility or security IMPORTANT.
export function blindSummary(b: Blind): { text: string; words: string; isClean: boolean } {
  const a11y = b.a11y ?? 0
  const security = b.security ?? 0
  const result = b.result === 'REACHED' ? 'reached' : b.result === 'NOT REACHED' ? 'not reached' : 'no report'
  const blockers = plural(b.blockers, 'blocker')
  const triage = b.caused === null ? 'triage: no report' : `${b.caused} caused`
  const problems = [
    security > 0 ? `security ${security}` : '',
    a11y > 0 ? `a11y ${a11y}` : '',
    b.caused !== null && b.caused > 0 ? triage : '',
    b.blockers > 0 ? blockers : '',
    result !== 'reached' ? result : '',
    b.caused === null ? triage : '',
  ].filter(p => p !== '')
  const rest = [result, blockers, triage].filter(p => !problems.includes(p))
  const words = [
    `run ${b.run}`,
    b.result === 'REACHED' ? 'reached the goal' : b.result === 'NOT REACHED' ? 'did not reach the goal' : 'no report',
    blockers,
    triage,
    ...(a11y > 0 ? [`${a11y} accessibility IMPORTANT`] : []),
    ...(security > 0 ? [`${security} security IMPORTANT`] : []),
  ]
  return {
    text: [`run ${b.run}`, ...problems, ...rest].join(' · '),
    words: words.join(', '),
    isClean: b.result === 'REACHED' && b.blockers === 0 && b.caused === 0 && a11y === 0 && security === 0,
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

// The reviewers a round runs, per skills/plan, skills/review-loop, skills/review (`standalone`) and skills/map's
// review of a task breakdown (`breakdown`): the ones the tier always gets, plus any conditional one (tests, a11y,
// security) that left a reply. The breakdown always gets architecture and patterns, and adds only security, for a
// HIGH task or once it replied. `files` maps a reviewer's file to its text.
export function roundReviewers(kind: 'plan' | 'review' | 'standalone' | 'breakdown', risk: string, files: Record<string, string>): Reviewer[] {
  if (kind === 'breakdown') {
    return ['architecture', 'patterns', ...(risk === 'HIGH' || files['security.md'] !== undefined ? ['security'] : [])]
      .map(role => reviewer(role, files[`${role}.md`]))
  }
  const isWide = risk === 'MEDIUM' || risk === 'HIGH'
  const always = ['logic', ...(isWide ? ['architecture', 'patterns', 'docs'] : []), ...(kind !== 'review' && risk === 'HIGH' ? ['security'] : [])]
  const roles = [...always, ...['docs', 'tests', 'a11y', 'security'].filter(r => !always.includes(r) && files[`${r}.md`] !== undefined)]
  return roles.map(role => reviewer(role, files[`${role}.md`]))
}

export function reviewer(role: string, text: string | undefined): Reviewer {
  return text === undefined ? { role, findings: null } : { role, findings: countFindings(text) }
}

export function section(text: string, heading: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${heading}`)
  if (start < 0) return []
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l))
  return lines.slice(start + 1, end < 0 ? undefined : end)
}

// A markdown table's body rows as trimmed cells, header and separator left out. In a cell, \| is a literal |.
function tableRows(lines: string[]): string[][] {
  const rows = lines.filter(l => l.trim().startsWith('|'))
    .map(l => l.trim().replace(/\\\|/g, '\u0001').replace(/^\||\|$/g, '').split('|').map(c => c.replace(/\u0001/g, '|').trim()))
  return rows.filter((cells, i) => !cells.every(c => /^:?-+:?$/.test(c)) && !(i === 0 && cells[0] === '#'))
}

// The statuses where the Stop hook runs (hooks/stop-verify.sh), so a stop_blocks count still means something.
export const isHookActive = (status: string) => ['BUILDING', 'IN_REVIEW', 'BLIND-TEST', 'ESCALATED'].includes(status)

// Which proof the skills should have saved by this status: proof-build.md after /quorum:build, proof-final.md once
// the task is READY or AWAITING-HUMAN. Empty while none is due yet.
export function expectedProof(status: string, stage: number): string {
  if (status === 'READY' || status === 'AWAITING-HUMAN') return 'proof-final.md'
  return stage > STAGES.indexOf('Build') ? 'proof-build.md' : ''
}

// The round log's latest line about the checks (state.md's body), for when no proof file was saved.
export function checksNoteFromLog(stateMd: string): string {
  const body = stateMd.split('\n')
  const end = body[0] === '---' ? body.indexOf('---', 1) : -1
  const lines = body.slice(end + 1).map(l => l.trim()).filter(l => /\b(eval|checks?)\b/i.test(l) && /\b(pass(es|ed)?|fail(s|ed)?)\b/i.test(l))
  const last = lines.at(-1) ?? ''
  return last.length > 200 ? `${last.slice(0, 199)}…` : last
}

// Markdown down to plain text for a one-line label: no emphasis, code ticks, or links.
const plain = (text: string) => text.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

// A requirement's short name: its bold lead ("**One shared helper.**"), or after a one-word label like
// "**Docs:** add …", the whole line.
function requirementTitle(text: string): string {
  const lead = /^\*\*(.+?)\*\*\s*(.*)$/.exec(text)?.[1]
  if (lead && !/^\w+:$/.test(lead)) return clip(plain(lead).replace(/[.:]$/, ''), 90)
  return clip(plain(text), 90)
}

// What rd.md says the task is: its title, goal, requirements, and non-goals.
export function parseSpec(rd: string): Spec | null {
  if (!rd.trim()) return null
  // The goal's first paragraph, the template's comment left out.
  const goal = section(rd, 'Goal').map(l => l.trim()).filter(l => !l.startsWith('<!--'))
  const start = goal.findIndex(l => l !== '')
  const end = goal.indexOf('', start)
  const paragraph = start < 0 ? [] : goal.slice(start, end < 0 ? undefined : end)
  const requirements: Requirement[] = []
  for (const line of section(rd, 'Requirements')) {
    const m = /^(\d+)\.\s+(\S.*)$/.exec(line)
    if (m) requirements.push({ n: m[1] ?? '', title: requirementTitle(m[2] ?? '') })
  }
  return {
    title: plain(/^#\s+(.+)$/m.exec(rd)?.[1] ?? ''),
    goal: clip(plain(paragraph.join(' ')), 280),
    isUi: /\*\*UI change:\*\*\s*yes/i.test(rd),
    requirements,
    nonGoals: section(rd, 'Non-goals').filter(l => /^-\s+\S/.test(l)).map(l => clip(plain(l.replace(/^-\s+/, '')), 90)),
  }
}

// A requirement's checks: the eval.md rows whose # names it ("4", "4, 5", "4b"), and how they stand. A final
// proof's verdict decides instead when there is one: MET passes, anything else fails, with its evidence.
export function requirementState(n: string, checks: Check[], verdicts: Verdict[] = []): { checks: number; state: 'pass' | 'fail' | 'open' | 'none'; verdict?: Verdict } {
  const mine = checks.filter(c => c.id.split(/[,\s]+/).some(id => new RegExp(`^${n}[a-z]?$`).test(id)))
  const verdict = verdicts.find(v => v.n === n)
  if (verdict) return { checks: mine.length, state: verdict.verdict === 'MET' ? 'pass' : 'fail', verdict }
  if (mine.length === 0) return { checks: 0, state: 'none' }
  if (mine.some(c => c.result === 'FAIL')) return { checks: mine.length, state: 'fail' }
  return { checks: mine.length, state: mine.every(c => c.result === 'PASS') ? 'pass' : 'open' }
}

export function branchFromHead(head: string): string {
  return /^ref: refs\/heads\/(\S+)\s*$/.exec(head.trim())?.[1] ?? ''
}

// The PR stage only matters once the task is finished and waiting on a PR.
export const isPrStage = (status: string) => status === 'READY' || status === 'AWAITING-HUMAN'

// `gh pr list --json number,state,isDraft,url` output (the newest PR for the branch, or NONE), or `gh pr view`'s
// single object.
export function parsePr(slug: string, stdout: string, checkedAt: number): PullRequest {
  const none: PullRequest = { slug, number: 0, state: 'NONE', isDraft: false, url: '', checkedAt }
  try {
    const parsed: unknown = JSON.parse(stdout)
    const pr = (Array.isArray(parsed) ? parsed[0] : parsed) as Partial<PullRequest> | undefined | null
    if (!pr || typeof pr.number !== 'number') return none
    const state = pr.state === 'OPEN' || pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'UNKNOWN'
    return { slug, number: pr.number, state, isDraft: pr.isDraft === true, url: typeof pr.url === 'string' ? pr.url : '', checkedAt }
  } catch {
    return { ...none, state: 'UNKNOWN' }
  }
}

// The PR state.md records (`pr`, a pull request URL) before or without asking GitHub: its number, state unknown.
export function prFromUrl(slug: string, url: string): PullRequest | null {
  const number = Number(/\/pull\/(\d+)$/.exec(url)?.[1] ?? 0)
  return number > 0 ? { slug, number, state: 'UNKNOWN', isDraft: false, url, checkedAt: 0 } : null
}

// The PR stage's line, or '' when there is nothing to say.
export function prDetail(pr: PullRequest | null, isDrafted: boolean): string {
  if (pr && pr.number > 0) {
    if (pr.state === 'MERGED') return `PR #${pr.number} merged`
    if (pr.state === 'CLOSED') return `PR #${pr.number} closed without merging`
    if (pr.state === 'UNKNOWN') return `PR #${pr.number}`
    return `${pr.isDraft ? 'draft ' : ''}PR #${pr.number} open`
  }
  if (!isDrafted) return ''
  return pr?.state === 'NONE' ? 'pr.md drafted, PR not opened yet' : 'pr.md drafted'
}

// The next step once the PR is known; otherwise the status's own (nextStep).
export function prNext(pr: PullRequest | null, isDrafted: boolean, fallback: string): string {
  if (pr && pr.number > 0) {
    if (pr.state === 'MERGED') return 'Done. Optionally /quorum:codify-lesson'
    if (pr.state === 'CLOSED') return `PR #${pr.number} was closed; reopen it or start again`
    return `Get PR #${pr.number} reviewed and merged`
  }
  if (isDrafted && pr?.state !== 'UNKNOWN') return 'Push the branch and open the PR with pr.md (gh pr create)'
  return fallback
}

// The round log says every check passed, though no proof file was saved.
export const isReportedPass = (note: string) => /\ball\b[^.]*\bchecks?\s+pass/i.test(note) && !/\bfail/i.test(note)

// A ref's commit from a packed-refs file ("<sha> refs/heads/<branch>" lines), or ''.
export function packedRef(packed: string, ref: string): string {
  for (const line of packed.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/)
    if (name === ref && /^[0-9a-f]{40}$/.test(sha ?? '')) return sha ?? ''
  }
  return ''
}

// A proof is stale when it ran at a commit other than HEAD (its short sha isn't HEAD's prefix).
export const isStaleProof = (rev: string, head: string) => rev !== '' && head !== '' && !head.startsWith(rev.toLowerCase())

// What a list of agents used: their token totals, and how many ran on each model, most used first.
export function spendOf(agents: QuorumAgent[]): Spend {
  const models = new Map<string, number>()
  let tokensIn = 0, tokensCached = 0, tokensOut = 0
  for (const a of agents) {
    tokensIn += a.tokensIn
    tokensCached += a.tokensCached
    tokensOut += a.tokensOut
    if (a.model) models.set(a.model, (models.get(a.model) ?? 0) + 1)
  }
  return { agents: agents.length, tokensIn, tokensCached, tokensOut, models: [...models].sort((x, y) => y[1] - x[1]) }
}

// Which of the task's model choices an agent runs on (skills/pipeline-laws/models.md); '' for the session's model.
export function modelGroup(type: string): 'reviewers' | 'helpers' | '' {
  if (['spec-reviewer', 'code-reviewer', 'pattern-auditor', 'docs-auditor', 'a11y-auditor', 'security-reviewer', 'verifier-voter'].includes(type)) return 'reviewers'
  if (['friction-triager', 'pr-writer'].includes(type)) return 'helpers'
  return ''
}

// How a choice reads: the model, "session model" for inherit, "not chosen" before the spec asks.
export const choiceLabel = (choice: string) => (choice === 'inherit' ? 'session model' : choice || 'not chosen')

// Agents that ran on another model than the task chose for their group, one line per group and model: a choice that
// didn't take. A choice is often an alias (`haiku`) of the model the engine reports (`claude-haiku-5-5`), so either
// containing the other is a match. `inherit` and no choice can't be checked against a model name.
export function modelMismatches(agents: QuorumAgent[], reviewerModel: string, helperModel: string): string[] {
  const chosen = { reviewers: reviewerModel, helpers: helperModel }
  const off = new Map<string, number>()
  for (const a of agents) {
    const group = modelGroup(a.type)
    const want = group ? chosen[group].toLowerCase() : ''
    const got = a.model.toLowerCase()
    if (!want || want === 'inherit' || !got || got.includes(want) || want.includes(got)) continue
    const key = `${group}\t${a.model}`
    off.set(key, (off.get(key) ?? 0) + 1)
  }
  return [...off].map(([key, n]) => {
    const [group = '', model = ''] = key.split('\t')
    return `${group} chose ${chosen[group as 'reviewers' | 'helpers']}, but ${n} ran on ${model}`
  })
}

// An absolute path with its `.` and `..` segments resolved, as git's relative commondir needs.
export function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

// The repo-relative path an Edit, Write or NotebookEdit changed, or null when it is outside the task. Either slash
// reads as `/`; a relative path is joined to the session's cwd; `.` and `..` are resolved in the POSIX and the
// `X:/` form (a `..` past the top stops there), which repoPath leaves alone. Null when the path is a root itself,
// under none of them, or under .tasks/.
export function editPath(raw: string, cwd: string, roots: string[]): string | null {
  const isAbs = (p: string) => p.startsWith('/') || /^[A-Za-z]:\//.test(p)
  const p = slashes(raw)
  const joined = isAbs(p) ? p : `${slashes(cwd)}/${p}`
  const abs = /^[A-Za-z]:\//.test(joined) ? `${joined.slice(0, 2)}${normalizePath(joined.slice(2))}` : normalizePath(joined)
  const rel = repoPath(abs, roots)
  return rel === '' || isAbs(rel) || rel.startsWith('.tasks/') ? null : rel
}

// Statuses a task has once its work is done, or stopped for a redesign.
export const isFinished = (status: string) => status === 'READY' || status === 'AWAITING-HUMAN' || status === 'HALTED'

// `1 file`, `4 files`.
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// The voter row's next step, as the pipeline takes it: a code review fixes and re-reviews until `of` rounds, then
// halts; a plan is revised once, then waits on the person; a standalone review fixes only once it is FIXING.
export function voterNext(kind: 'plan' | 'review' | 'standalone', important: number, round: number, of: number, status: string): string {
  if (kind === 'standalone') return status === 'FIXING' ? 'fix' : 'done'
  if (kind === 'plan') return important === 0 ? 'ready for you' : round >= 2 ? 'your call' : 'revise the plan'
  return important === 0 ? 'converges' : round >= of ? 'halts' : 'fix round'
}

// A token count in a few characters: 950, 12k, 1.4M.
export function tokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 999_500) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// The findings a voter's survivors.md kept, in order: `[TAG] file:line — Pattern Category: X`, then an optional
// `Confidence: N` line under it, and an optional `Security: <kind>` line in its body, as bin/quorum-findings reads
// them. The `file:line` is optional: a finding without one gets `loc: ''`, so the list's length matches
// countFindings. A Security: line counts only while its finding is open, as records() decides: a `#` heading or a
// DROP, KEEP or Summary: line closes it, and so does a line after a blank one that isn't indented and isn't a key.
export function keptFindings(text: string): KeptFinding[] {
  const out: KeptFinding[] = []
  let isOpen = false
  let blank = false
  for (const line of text.split('\n')) {
    const m = /^\[(IMPORTANT|NIT|PRE-EXISTING)\]\s+(?:(\S+:\d+)\s*)?(?:[—-]+\s*)?(.*)$/.exec(line)
    if (m) {
      const rest = (m[3] ?? '').trim()
      out.push({ tag: m[1] as KeptFinding['tag'], loc: m[2] ?? '', title: /Pattern Category:\s*(.+)$/.exec(rest)?.[1]?.trim() ?? rest, confidence: null, security: null })
      isOpen = true
      continue
    }
    const c = /^Confidence:\s*(\d{1,3})\s*$/.exec(line)
    const last = out[out.length - 1]
    if (c && last && last.confidence === null) last.confidence = Number(c[1])
    if (/^#/.test(line) || /^(DROP|KEEP|Summary:)/.test(line)) isOpen = false
    if (!isOpen) continue
    if (/^[ \t]*$/.test(line)) { blank = true; continue }
    if (blank && !/^[ \t]/.test(line) && !/^(Confidence|Mechanism|Why|Fix|Evidence|Pattern Category|Security):/.test(line)) { isOpen = false; blank = false; continue }
    blank = false
    const s = /^Security:\s*(.*\S)\s*$/.exec(line)
    if (s && last && last.security === null) last.security = s[1] ?? null
  }
  return out
}

// The Quorum command in a "next step" text, for the Next button to put in the prompt; null when there's none.
export function nextCommand(next: string): string | null {
  return /\/quorum:[a-z][a-z-]*/.exec(next)?.[0] ?? null
}

// A title ending in a ticket id in parentheses, "Export the rows (SALES-12)", split into the title and the id.
export function splitTicket(title: string): { title: string; ticket: string } {
  const m = /^(.*\S)\s*\(([A-Z][A-Z0-9]*-\d+)\)\s*$/.exec(title)
  return m ? { title: m[1] ?? title, ticket: m[2] ?? '' } : { title, ticket: '' }
}

// A standalone review's folder name (skills/review: `review-<branch>`, `review-pr-<n>`, `review-<sha>`).
export const isReviewId = (name: string) => /^review-[A-Za-z0-9._-]+$/.test(name)

// The statuses where a standalone review is running: its reviewers and voter, or its builder fixing.
export const isReviewRunning = (status: string) => status === 'REVIEWING' || status === 'FIXING'

// The current run of a review: the highest `run-<N>` folder (`<prefix>-<N>`, as `round` for a map's
// tasks-review/), 0 before the first is made.
export function latestRun(names: string[], prefix = 'run'): number {
  return Math.max(0, ...names.map(n => (m => (m && m[1] === prefix ? Number(m[2]) : 0))(/^([a-z]+)-(\d+)$/.exec(n))))
}

// The review this session is running, if any: the live card. Another session's running review may be live in
// another terminal or long dead, so it stays in the history with a note.
export const liveReview = <T extends { status: string; isOurs: boolean }>(reviews: T[]): T | null =>
  reviews.find(r => isReviewRunning(r.status) && r.isOurs) ?? null

// How long ago, in a few characters: just now, 5m, 2h, 3d.
export function ago(now: number, then: number): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / (24 * 60))}d ago`
}

// A range of full SHAs, as the review records it, in short SHAs: `1a2b3c4..5d6e7f8`.
export const shortRange = (range: string) => range.replace(/\b([0-9a-f]{7})[0-9a-f]{33}\b/g, '$1')

// Which sections open by themselves: those holding a problem, so a fold never hides one.
export function openByDefault(t: Snapshot): Record<Section, boolean> {
  const requirements = (t.spec?.requirements ?? []).map(r => requirementState(r.n, t.checks, t.proof?.verdicts).state)
  return {
    tasks: false,
    requirements: requirements.some(state => state === 'fail' || state === 'none'),
    checks: (t.proof !== null && t.checks.some(c => c.result === 'FAIL'))
      || t.isProofStale
      || (t.proof === null && t.expectedProof !== '')
      || (t.stopBlocks > 0 && isHookActive(t.status))
      || t.pending > 0,
    rounds: t.status === 'HALTED',
    reviews: false,
    spend: false,
    agents: false,
  }
}

// The Requirements row's note for its first unmet requirement and how many more: `R<n> <title> unmet, and K more`.
// It sits `beside` the summary when it fits there; otherwise on its own `line` under the row, where only the title is
// cut, and left out when fewer than 2 columns are left for it.
export function unmetNote(first: Requirement, more: number, beside: number, line: number): { beside: string; under: string } {
  const tail = ` unmet${more > 0 ? `, and ${more} more` : ''}`
  const note = `R${first.n} ${first.title}${tail}`
  if (cellWidth(note) <= beside) return { beside: note, under: '' }
  const room = line - cellWidth(`R${first.n} `) - cellWidth(tail)
  return { beside: '', under: room < 2 ? `R${first.n}${tail}` : `R${first.n} ${cutEnd(first.title, room)}${tail}` }
}

// The requirements a current proof leaves unmet, in rd.md order, once the review has converged: what the stepper,
// the details line, the Now title and the band name. A stale proof's failures may already be fixed, so none count.
export function unmetNow(t: Pick<Snapshot, 'spec' | 'checks' | 'proof' | 'isProofStale' | 'status'>): string[] {
  if (!t.proof || t.isProofStale || !['CONVERGED', 'BLIND-TEST', 'READY', 'AWAITING-HUMAN'].includes(t.status)) return []
  const verdicts = t.proof.verdicts
  return (t.spec?.requirements ?? []).filter(r => requirementState(r.n, t.checks, verdicts).state === 'fail').map(r => r.n)
}

// Those requirements in a few words, for the band and the Now title (`short`), and for the details line.
export function unmetWords(ns: string[]): { short: string; details: string } {
  return ns.length === 1
    ? { short: `R${ns[0]} unmet`, details: `converged with requirement ${ns[0]} unmet` }
    : { short: `${ns.length} unmet`, details: `converged with ${plural(ns.length, 'requirement')} unmet` }
}

// The Checks row's summary, `P/N pass @ <rev> · stale`, and its note, within `room` columns. The note gives way
// first (cut at its end, and left out once fewer than 6 columns are left for it), then the rev (cut at its end, and
// left out once fewer than 5 columns are left for ` @ ` and it); `count` and ` · stale` always show.
export function checksRow(count: string, rev: string, isStale: boolean, note: string, room: number): { summary: string; note: string } {
  const rev7 = rev.slice(0, 7)
  const at = rev7 ? ` @ ${rev7}` : ''
  const stale = isStale ? ' · stale' : ''
  const summary = `${count}${at}${stale}`
  if (cellWidth(summary) + 2 + cellWidth(note) <= room) return { summary, note }
  if (cellWidth(summary) <= room) {
    const left = room - cellWidth(summary) - 2
    return { summary, note: left < 6 ? '' : cutEnd(note, left) }
  }
  const left = room - cellWidth(count) - cellWidth(stale)
  const cut = left >= cellWidth(at) ? at : left >= 5 ? ` @ ${cutEnd(rev7, left - 3)}` : ''
  return { summary: `${count}${cut}${stale}`, note: '' }
}

// What's wrong, briefly, for the band: an unmet requirement, failing checks, a stale proof, pending findings.
export function problemsOf(t: Pick<Snapshot, 'spec' | 'status' | 'proof' | 'checks' | 'isProofStale' | 'pending'>): string[] {
  const failing = t.proof ? t.checks.filter(c => c.result === 'FAIL').length : 0
  const unmet = unmetNow(t)
  return [
    unmet.length > 0 ? unmetWords(unmet).short : '',
    failing ? `✗ ${failing} check${failing === 1 ? '' : 's'} failing` : '',
    t.isProofStale ? 'proof older than HEAD' : '',
    t.pending > 0 ? `${t.pending} pending` : '',
  ].filter(Boolean)
}

// .tasks/<slug>/files.tsv (bin/quorum-files record): its header, then one row per file, `LETTER ADDED REMOVED PATH
// OLD_PATH STEPS FIX` tab-separated, `-` for an empty field. Strict: a bad header or any bad row is no list (null).
export function parseFileList(text: string): FileList | null {
  const [first = '', ...rest] = text.split('\n')
  const h = /^# quorum-files 1 head=([0-9a-f]{40}) base=([0-9a-f]{40}|-) since=([0-9a-f]{4,40}|-) recorded=(\d+)$/.exec(first)
  if (!h) return null
  const dash = (v: string) => (v === '-' ? '' : v)
  const lines = (v: string) => (v === '-' ? null : v === 'bin' ? 'bin' : Number(v))
  const files: ChangedFile[] = []
  for (const row of rest) {
    if (row === '') continue
    const f = row.split('\t')
    const [letter = '', added = '', removed = '', path = '', oldPath = '', steps = '', fix = ''] = f
    if (f.length !== 7 || !/^[MADR]$/.test(letter) || !/^(\d+|bin|-)$/.test(added) || !/^(\d+|bin|-)$/.test(removed)
      || path === '' || oldPath === '' || !/^(-|\d+(,\d+)*)$/.test(steps) || !/^[01-]$/.test(fix)) return null
    files.push({
      letter: letter as ChangedFile['letter'],
      added: lines(added),
      removed: lines(removed),
      path,
      oldPath: dash(oldPath),
      steps: steps === '-' ? [] : steps.split(',').map(Number),
      fix: fix === '-' ? null : fix === '1',
    })
  }
  return { head: h[1] ?? '', base: dash(h[2] ?? ''), since: dash(h[3] ?? ''), recorded: Number(h[4]), files }
}

// Which plan steps count as built: the ones built_steps lists, or, in a build that isn't sliced (it pushes no
// built_steps), every step once proof-build.md exists.
export function stepProgress(t: Pick<Snapshot, 'planSteps' | 'isFast' | 'builtList' | 'hasBuildProof'>): { built: number[]; allBuilt: boolean } {
  return { built: t.builtList, allBuilt: !(t.planSteps >= SLICE_AT && !t.isFast) && t.hasBuildProof }
}

// The step a running builder is on, as `quorum-plan next` gives it: the first step in plan order that isn't built,
// or null once every step is.
export function buildingStep(steps: PlanStep[], p: { built: number[]; allBuilt: boolean }): number | null {
  return p.allBuilt ? null : steps.find(s => !p.built.includes(s.n))?.n ?? null
}
