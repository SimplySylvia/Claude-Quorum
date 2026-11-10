// Quorum's dashboard: a band above the prompt, and a pane with what the current stage is doing (each reviewer of the
// round, the blind test's reports), how the task's checks stand, its stages, review rounds and running agents, and
// standalone reviews (/quorum:review): the one running now, and the ones before it. It only reads .tasks/; the skills and bin/ scripts stay the
// source of truth.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Check, Findings, KeptFinding, Now, PullRequest, QuorumAgent, Review, Reviewer, Round, Section, Snapshot, Stage } from '../../types'
import {
  ROLE_LABEL, STAGES, branchFromHead, isStaleProof, packedRef, checksNoteFromLog, isPrStage, isReportedPass, parsePr, prDetail, prFromUrl, prNext, count, countFindings, countRequirements, evalRows, expectedProof, isHookActive, isStuck, joinChecks, parseSpec, requirementState, list, nextStep, parseBlind,
  parseFrontmatter, parseProof, reviewer, roleOf, roundReviewers, scalar, slugFromHead, spendOf, stageOf, stages, tokenCount,
  keptFindings, nextCommand, openByDefault, problemsOf, splitTicket, ago, isReviewId, isReviewRunning, latestRun, liveReview, shortRange,
} from './task'

const PANE = 'quorum-dashboard'
const COMMAND = 'quorum-dashboard'
// Change a tag when its value's fields change: it declines what an earlier version stored.
const task = atom({ plugin: 'quorum', key: 'task' } as const, null, { shape: 'task-8' })
const agents = atom({ plugin: 'quorum', key: 'agents' } as const, [], { shape: 'agents-3' })
const pr = atom({ plugin: 'quorum', key: 'pr' } as const, null, { shape: 'pr-1' })
const reviews = atom({ plugin: 'quorum', key: 'reviews' } as const, [], { shape: 'reviews-1' })
// Sections the person opened or closed in the pane, by `<slug>:<section>`.
const sections = atom({ plugin: 'quorum', key: 'sections' } as const, {}, { shape: 'sections-1' })
// How long a PR lookup stands before the next refresh asks GitHub again.
const PR_TTL_MS = 2 * 60 * 1000
// Bumped every second while a Quorum agent runs, so the pane's running times count up.
const clock = atom({ plugin: 'quorum', key: 'now' } as const, 0)
let ticker: Timer | null = null

// Statuses worth interrupting for.
const TOASTS: Record<string, string> = {
  CONVERGED: 'review converged',
  HALTED: 'HALTED after the round cap; see the post-mortem',
  ESCALATED: 'ESCALATED: the Stop-hook checks failed 3 times',
  READY: 'READY for /quorum:pr-draft',
  'AWAITING-HUMAN': 'waiting for your review',
}

const GLYPH: Record<Stage['state'], [string, string]> = {
  done: ['✓', 'success'],
  active: ['●', 'claude'],
  waiting: ['◆', 'warning'],
  stuck: ['✗', 'error'],
  todo: ['○', 'inactive'],
  skipped: ['–', 'inactive'],
}

const REQUIREMENT_GLYPH = { pass: ['✓', 'success'], fail: ['✗', 'error'], open: ['○', 'inactive'], none: ['–', 'inactive'] } as const

const REVIEW_FILES = ['logic.md', 'architecture.md', 'patterns.md', 'docs.md', 'tests.md', 'a11y.md', 'security.md', 'votes.md', 'survivors.md']


const readOr = ($: EngineInterface, path: string) => $.fs.read(path).catch(() => null)

// The slug bin/quorum-active-task would print: a feat/ or fix/ branch with a task folder, then .tasks/.active.
// `root` is the session's project root, the CLAUDE_PROJECT_DIR that script resolves against.
async function activeSlug($: EngineInterface, root: string): Promise<{ slug: string; branch: string; head: string }> {
  // A worktree's .git is a file naming the real git dir, absolute or relative to the worktree.
  const pointer = /^gitdir:\s*(.+)$/m.exec((await readOr($, `${root}/.git`)) ?? '')?.[1]?.trim()
  const gitdir = !pointer ? `${root}/.git` : pointer.startsWith('/') ? pointer : `${root}/${pointer}`
  const headFile = (await readOr($, `${gitdir}/HEAD`)) ?? ''
  const branch = branchFromHead(headFile)
  const head = await headCommit($, gitdir, headFile, branch)
  const fromBranch = slugFromHead(headFile)
  if (fromBranch && (await $.fs.exists(`${root}/.tasks/${fromBranch}/state.md`))) return { slug: fromBranch, branch, head }
  const active = ((await readOr($, `${root}/.tasks/.active`)) ?? '').split('\n')[0]?.trim() ?? ''
  return { slug: /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(active) ? active : '', branch, head }
}

// HEAD's commit: detached, the branch's loose ref, or packed-refs; a worktree's refs live in its commondir.
async function headCommit($: EngineInterface, gitdir: string, headFile: string, branch: string): Promise<string> {
  if (/^[0-9a-f]{40}\s*$/.test(headFile)) return headFile.trim()
  if (!branch) return ''
  const common = ((await readOr($, `${gitdir}/commondir`)) ?? '').trim()
  const dirs = [gitdir, ...(common ? [common.startsWith('/') ? common : `${gitdir}/${common}`] : [])]
  for (const dir of dirs) {
    const loose = ((await readOr($, `${dir}/refs/heads/${branch}`)) ?? '').trim()
    if (/^[0-9a-f]{40}$/.test(loose)) return loose
    const packed = packedRef((await readOr($, `${dir}/packed-refs`)) ?? '', `refs/heads/${branch}`)
    if (packed) return packed
  }
  return ''
}

// The files among `names` under `dir` that exist, by name.
async function readFiles($: EngineInterface, dir: string, names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const text = await readOr($, `${dir}/${name}`)
    if (text !== null) out[name] = text
  }
  return out
}

// One plan or code review round: its reviewers' replies, the voter's, and what survived.
async function roundNow($: EngineInterface, dir: string, kind: 'plan' | 'review', round: number, of: number, risk: string): Promise<Now> {
  const files = await readFiles($, `${dir}/round-${round}`, REVIEW_FILES)
  const survivors = files['survivors.md']
  return {
    kind,
    round,
    of,
    reviewers: roundReviewers(kind, risk, files),
    voter: reviewer('voter', files['votes.md']),
    survivors: survivors === undefined ? null : countFindings(survivors),
    kept: survivors === undefined ? [] : keptFindings(survivors),
  }
}

// What the current stage is doing, read from the files its skill saves.
async function nowFor($: EngineInterface, dir: string, t: Pick<Snapshot, 'stage' | 'risk' | 'round' | 'maxRounds' | 'planRounds' | 'blindRuns'>, rd: string): Promise<Now> {
  switch (STAGES[t.stage]) {
    case 'Spec': {
      const files = await readFiles($, `${dir}/spec-review`, ['feasibility.md', 'improver.md'])
      return {
        kind: 'spec',
        requirements: countRequirements(rd),
        reviewers: [reviewer('feasibility', files['feasibility.md']), reviewer('improver', files['improver.md'])],
      }
    }
    case 'Plan': return roundNow($, `${dir}/plan-review`, 'plan', t.planRounds, 2, t.risk)
    case 'Build': return { kind: 'build' }
    case 'Review': return roundNow($, `${dir}/review`, 'review', t.round, t.maxRounds, t.risk)
    case 'Blind test': {
      if (t.risk === 'LOW' || t.blindRuns === 0) return t.round > 0 ? roundNow($, `${dir}/review`, 'review', t.round, t.maxRounds, t.risk) : { kind: 'done' }
      const run = t.blindRuns
      const files = await readFiles($, `${dir}/blind`, [`blind-${run}.md`, `a11y-${run}.md`, `security-${run}.md`, `triage-${run}.md`])
      return {
        kind: 'blind',
        blind: parseBlind(run, { blind: files[`blind-${run}.md`], a11y: files[`a11y-${run}.md`], security: files[`security-${run}.md`], triage: files[`triage-${run}.md`] }),
      }
    }
    default: return { kind: 'done' }
  }
}

async function snapshot($: EngineInterface, maxRounds: number, previous: Snapshot | null): Promise<Snapshot | null> {
  const root = await $.session.root()
  const { slug, branch, head } = await activeSlug($, root)
  if (!slug) return null
  const text = await readOr($, `${root}/.tasks/${slug}/state.md`)
  if (text === null) return null
  const fm = parseFrontmatter(text)
  const status = scalar(fm, 'status')
  const risk = scalar(fm, 'risk')
  const round = count(fm, 'round')

  const rounds: Round[] = []
  for (let n = 1; n <= round; n++) {
    const dir = `${root}/.tasks/${slug}/review/round-${n}`
    const survivors = await readOr($, `${dir}/survivors.md`)
    const candidates = await readOr($, `${dir}/candidates.md`)
    rounds.push({
      n,
      findings: survivors === null ? null : countFindings(survivors),
      candidates: candidates === null ? null : (({ important, nit, preExisting }) => important + nit + preExisting)(countFindings(candidates)),
    })
  }

  // ESCALATED records the status it interrupted; HALTED comes from the review loop, or from blind test after 2 runs.
  const stage = status === 'ESCALATED' && scalar(fm, 'escalated_from')
    ? stageOf(scalar(fm, 'escalated_from'), undefined)
    : status === 'HALTED' && count(fm, 'blind_runs') > 0
      ? STAGES.indexOf('Blind test')
      : stageOf(status, previous?.slug === slug ? previous.stage : undefined)
  const planRounds = count(fm, 'plan_rounds')
  const blindRuns = count(fm, 'blind_runs')

  const dir = `${root}/.tasks/${slug}`
  const rd = (await readOr($, `${dir}/rd.md`)) ?? ''
  const evalMd = (await readOr($, `${dir}/eval.md`)) ?? ''
  // proof-final.md is written after the review loop or blind test, so it is the newer one when both exist.
  const proofs = await readFiles($, dir, ['proof-final.md', 'proof-build.md'])
  const proofFile = proofs['proof-final.md'] !== undefined ? 'proof-final.md' : proofs['proof-build.md'] !== undefined ? 'proof-build.md' : ''
  const proof = proofFile ? parseProof(proofs[proofFile] ?? '', proofFile) : null

  return {
    slug,
    branch,
    prDrafted: await $.fs.exists(`${dir}/pr.md`),
    prUrl: scalar(fm, 'pr'),
    risk,
    status,
    stage,
    round,
    maxRounds,
    planRounds,
    planApproved: scalar(fm, 'plan_approved'),
    signoff: scalar(fm, 'signoff'),
    blindRuns,
    stopBlocks: count(fm, 'stop_blocks'),
    pending: list(fm, 'pending_findings').length,
    rounds,
    next: nextStep(status, risk),
    now: await nowFor($, dir, { stage, risk, round, maxRounds, planRounds, blindRuns }, rd),
    spec: parseSpec(rd),
    checks: joinChecks(evalRows(evalMd), proof),
    proof,
    head,
    isProofStale: proof !== null && isStaleProof(proof.rev, head),
    expectedProof: expectedProof(status, stage),
    checksNote: proof ? '' : checksNoteFromLog(text),
  }
}

// How many reviews the dashboard keeps: the live one and the history under it.
const REVIEWS_SHOWN = 6

// The newest standalone reviews (skills/review keeps each in .tasks/review-<id>/), by when state.md last changed.
// `session` is this session's id: a running review that records it is the live one.
async function reviewsSnapshot($: EngineInterface, root: string, session: string): Promise<Review[]> {
  const tasks = `${root}/.tasks`
  const dirs = (await $.fs.list(tasks).catch(() => [])).filter(e => e.kind === 'dir' && isReviewId(e.name))
  const dated = await Promise.all(dirs.map(async e => ({
    id: e.name,
    mtimeMs: (await $.fs.stat(`${tasks}/${e.name}/state.md`).catch(() => null))?.mtimeMs ?? -1,
  })))
  const out: Review[] = []
  for (const { id, mtimeMs } of dated.filter(d => d.mtimeMs >= 0).sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    if (out.length >= REVIEWS_SHOWN) break
    const fm = parseFrontmatter((await readOr($, `${tasks}/${id}/state.md`)) ?? '')
    if (scalar(fm, 'kind') !== 'review') continue
    const risk = scalar(fm, 'risk')
    const run = latestRun((await $.fs.list(`${tasks}/${id}`).catch(() => [])).filter(e => e.kind === 'dir').map(e => e.name))
    const files = run > 0 ? await readFiles($, `${tasks}/${id}/run-${run}`, REVIEW_FILES) : {}
    const survivors = files['survivors.md']
    out.push({
      id,
      status: scalar(fm, 'status'),
      risk,
      isOurs: session !== '' && scalar(fm, 'session') === session,
      changedAt: mtimeMs,
      range: shortRange(scalar(fm, 'range')),
      run,
      reviewers: roundReviewers('standalone', risk, files),
      voter: reviewer('voter', files['votes.md']),
      survivors: survivors === undefined ? null : countFindings(survivors),
      kept: survivors === undefined ? [] : keptFindings(survivors),
    })
  }
  return out
}

// The task's PR as GitHub last reported it, else as state.md records it.
const prOf = (t: Snapshot, known: PullRequest | null) => (known?.slug === t.slug ? known : prFromUrl(t.slug, t.prUrl))


// Put a Quorum command in the prompt for the person to send, edit, or add to; never send it. A draft they already
// typed stays, after the command, as its arguments.
async function fillPrompt($: EngineInterface, cmd: string) {
  const draft = ((await $.prompt.read().catch(() => null))?.text ?? '').trim()
  const text = draft.startsWith(cmd) ? draft : draft ? `${cmd} ${draft}` : `${cmd} `
  await $.prompt.fill({ text, cursor: text.length }).catch(() => undefined)
}

// The status badge's color: amber when the task waits on the person, red when it's stuck, else the accent.
const whoseMove = (status: string) =>
  isStuck(status) ? 'error' : status === 'READY' || status === 'AWAITING-HUMAN' || status === 'DRAFT-AWAITING-VISUAL-SIGNOFF' ? 'warning' : 'claude'

// Ask GitHub for the task branch's PR, at most every PR_TTL_MS unless `force`d, and only once the task waits on one.
// It runs after the hook that started it; a missing or signed-out gh is remembered as UNKNOWN until the TTL passes.
async function lookupPr($: EngineInterface, t: Snapshot, force: boolean) {
  if (!isPrStage(t.status) || (!t.branch && !t.prUrl)) return
  const known = await read($, pr)
  const now = await $.clock.now()
  // A recorded lookup for this task, and for the PR state.md names if it names one, stands until the TTL.
  const isFresh = known?.slug === t.slug && (!t.prUrl || known.url === t.prUrl) && now - known.checkedAt < PR_TTL_MS
  if (!force && isFresh) return
  // The PR state.md records, else the newest one for the task's branch.
  const argv = t.prUrl
    ? ['gh', 'pr', 'view', t.prUrl, '--json', 'number,state,isDraft,url']
    : ['gh', 'pr', 'list', '--head', t.branch, '--state', 'all', '--limit', '1', '--json', 'number,state,isDraft,url']
  const ran = await $.process.run(argv, { cwd: await $.session.root(), timeoutMs: 15_000 }).catch(() => null)
  const found: PullRequest = ran && ran.exitCode === 0
    ? parsePr(t.slug, ran.stdout, now)
    : { ...(prFromUrl(t.slug, t.prUrl) ?? { slug: t.slug, number: 0, state: 'UNKNOWN', isDraft: false, url: '' }), checkedAt: now }
  await update($, pr, () => found)
}

// What the stepper can't say: the mockup sign-off, the plan's rounds and approval, the blind-test runs, and a drafted
// PR before one is open. One line under the stepper.
function stageDetails(t: Snapshot, known: PullRequest | null): string {
  const plan = [t.planRounds ? `${t.planRounds} plan review round${t.planRounds === 1 ? '' : 's'}` : '',
    t.planApproved ? `approved ${t.planApproved}` : ''].filter(Boolean).join(', ')
  return [
    t.signoff ? `mockup signed off ${t.signoff}` : '',
    plan,
    t.risk !== 'LOW' && t.blindRuns ? `blind test: ${t.blindRuns} run${t.blindRuns === 1 ? '' : 's'}` : '',
    isPrStage(t.status) && !(known && known.number > 0) ? prDetail(known, t.prDrafted) : '',
  ].filter(Boolean).join(' · ')
}

// A known PR's state in a word or two, for after its linked number: '' when GitHub couldn't be asked.
const prState = (p: PullRequest) =>
  p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed without merging' : p.state === 'OPEN' ? (p.isDraft ? 'draft, open' : 'open') : ''

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function findingsText(f: Findings): string {
  if (f.important + f.nit + f.preExisting === 0) return 'clean'
  return [`${f.important} IMPORTANT`, `${f.nit} NIT`, ...(f.preExisting ? [`${f.preExisting} pre-existing`] : [])].join(' · ')
}

// How many of the round's reviewers have replied, for the band and the pane.
function reviewerProgress(now: Now): string {
  if (now.kind !== 'plan' && now.kind !== 'review' && now.kind !== 'spec') return ''
  const done = now.reviewers.filter(r => r.findings !== null).length
  return `reviewers ${done}/${now.reviewers.length}`
}

// Where a standalone review is: its reviewers, then the voter, then (FIXING) the builder.
function reviewProgress(r: Review): string {
  if (r.status === 'FIXING') return 'builder fixing'
  const done = r.reviewers.filter(x => x.findings !== null).length
  if (r.run > 0 && done === r.reviewers.length && r.voter.findings === null) return 'voter voting'
  return `reviewers ${done}/${r.reviewers.length}`
}

function checkProgress(checks: Check[], hasProof: boolean): string {
  return hasProof ? `checks ${checks.filter(c => c.result === 'PASS').length}/${checks.length}` : ''
}

function nowTitle(now: Now, maxRounds: number): string {
  switch (now.kind) {
    case 'spec': return 'Spec review'
    case 'plan': return now.round === 0 ? 'Planning: the planner is writing plan.md' : `Plan review, round ${now.round} of ${now.of}`
    case 'review': return `Code review, round ${now.round} of ${now.of || maxRounds}`
    case 'build': return 'Build'
    case 'blind': return `Blind test, run ${now.blind.run}`
    case 'done': return 'Waiting for you'
  }
}

// What the voter's result means for the round.
function verdict(now: Extract<Now, { kind: 'plan' | 'review' }>): [string, string] | null {
  if (!now.survivors) return null
  if (now.survivors.important === 0) return [now.kind === 'plan' ? 'Nothing IMPORTANT left: ready for your approval' : 'Nothing IMPORTANT left: the round converges', 'success']
  const who = now.kind === 'plan' ? 'the planner revises' : 'the builder fixes them'
  const n = now.survivors.important
  return [`${n === 1 ? '1 IMPORTANT finding survives' : `${n} IMPORTANT findings survive`}: ${who}`, 'error']
}

// The stage rail, with the PR stage done once GitHub says the PR merged.
const railFor = (t: Snapshot, known: PullRequest | null): Stage[] =>
  stages(t.status, t.risk, t.stage).map(s => (s.name === 'PR' && known?.state === 'MERGED' ? { ...s, state: 'done' } : s))

const nextFor = (t: Snapshot, known: PullRequest | null) => (isPrStage(t.status) ? prNext(known, t.prDrafted, t.next) : t.next)

const seconds = (a: QuorumAgent, now: number) => `${Math.max(0, Math.round(((a.endedAt ?? now) - a.startedAt) / 1000))}s`

// Re-read the task and the reviews, redraw, and toast a status change worth interrupting for.
async function refresh($: EngineInterface, maxRounds: number, forcePr = false): Promise<Snapshot | null> {
  const before = await read($, task)
  const after = await snapshot($, maxRounds, before)
  await update($, task, () => after)
  const session = await $.session.id().catch(() => '')
  const found = await reviewsSnapshot($, await $.session.root(), session)
  await update($, reviews, () => found)
  // In the background, so a slow GitHub never holds up the turn; a failed lookup just leaves the last answer.
  if (after) void lookupPr($, after, forcePr).catch(() => undefined)
  const message = after && TOASTS[after.status]
  if (message && before?.slug === after.slug && before.status !== after.status) {
    // Claude Code draws toasts under the plugin's name ("quorum"), so the text doesn't repeat it.
    $.ui.toast(`${after.slug}: ${message}`)
  }
  return after
}

// Tick while any Quorum agent runs, and stop once none does.
function keepTicking($: EngineInterface, all: QuorumAgent[]) {
  const isRunning = all.some(a => a.endedAt === null)
  if (isRunning && ticker === null) {
    ticker = $.clock.every(1000, () => { void $.clock.now().then(now => update($, clock, () => now)) })
  } else if (!isRunning && ticker !== null) {
    ticker.cancel()
    ticker = null
  }
}

// After a reload or resume, mark agents the engine no longer runs as finished, so none ticks forever.
async function settleAgents($: EngineInterface) {
  const live = new Set((await $.agent.list()).filter(a => a.status === 'pending' || a.status === 'running').map(a => a.id))
  const now = await $.clock.now()
  const all = await update($, agents, list => list.map(a => (a.endedAt === null && !live.has(a.id) ? { ...a, endedAt: now } : a)))
  keepTicking($, all)
}

function open($: EngineInterface, focus?: true) {
  return $.ui.open({ id: PANE, title: 'Quorum', ...(focus ? { focus } : {}) })
}

export const register: Register = (on, options) => {
  const maxRounds = Number(options.max_rounds ?? 3) || 3

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: "Show or hide the Quorum task dashboard" })
    await settleAgents($)
    // The band above the prompt says it all, so Quorum keeps no status line; clear one an earlier version set.
    $.ui.status(undefined)
    if ((await refresh($, maxRounds)) || liveReview(await read($, reviews))) void open($)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Quorum dashboard closed.' }
    }
    const t = await refresh($, maxRounds)
    const r = liveReview(await read($, reviews))
    await open($)
    return { text: t ? `Quorum dashboard opened for ${t.slug}.` : r ? `Quorum dashboard opened for ${r.id}.` : 'Quorum dashboard opened. No active task yet.' }
  }).catch(() => ({ text: 'Quorum dashboard: could not open; run claude --debug for the reason.' }))

  // A /quorum:* command starting: refresh, start a fresh agent list, and open the pane unasked.
  on('skill.prompt', async ($, e, next) => {
    if (e.pluginName === 'quorum' || e.skill.startsWith('quorum:')) {
      await update($, agents, all => all.filter(a => a.endedAt === null))
      await refresh($, maxRounds)
      void open($)
    }
    return next(e)
  })

  // Every status change goes through bin/quorum-state or quorum-active-task, so re-read after those. The dashboard
  // only watches: if one of its hooks fails, the call goes on as if it weren't there.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    // `gh pr create` or a push can open or change the PR: look it up again now.
    const isPrCommand = /\bgh\s+pr\b|\bgit\s+push\b/.test(e.command)
    if (isPrCommand || /quorum-(state|active-task|branch)|\.tasks\//.test(e.command)) await refresh($, maxRounds, isPrCommand)
    return ran
  }).catch(($, e, next) => next(e))

  // Reviewers' replies, proofs, and blind-test reports are saved with Write (or fixed with Edit).
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.file_path.includes('/.tasks/')) await refresh($, maxRounds)
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.file_path.includes('/.tasks/')) await refresh($, maxRounds)
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny === undefined && spawned.agentId && e.subagentType.startsWith('quorum:')) {
      const agent: QuorumAgent = {
        id: spawned.agentId,
        type: e.subagentType.slice('quorum:'.length),
        role: roleOf(e.subagentType.slice('quorum:'.length), e.prompt),
        description: e.description,
        model: spawned.model,
        startedAt: await $.clock.now(),
        endedAt: null,
        tokensIn: 0,
        tokensCached: 0,
        tokensOut: 0,
      }
      keepTicking($, await update($, agents, all => [...all, agent].slice(-30)))
    }
    return spawned
  }).catch(($, e, next) => next(e))

  // Each request a Quorum agent makes: pass the stream through untouched, then add what it used to the agent's
  // totals. A streaming hook can't fall back with .catch, so a failed update is dropped here instead.
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    const used = step.usage
    if (e.agentId !== undefined && used) {
      const id = e.agentId
      const cached = used.cache_read_input_tokens
      const input = used.input_tokens + cached + used.cache_creation_input_tokens
      await update($, agents, all => all.some(a => a.id === id)
        ? all.map(a => (a.id === id ? { ...a, tokensIn: a.tokensIn + input, tokensCached: a.tokensCached + cached, tokensOut: a.tokensOut + used.output_tokens } : a))
        : all).catch(() => undefined)
    }
    return step
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      const id = e.agentId
      const now = await $.clock.now()
      keepTicking($, await update($, agents, all => all.map(a => (a.id === id && a.endedAt === null ? { ...a, endedAt: now } : a))))
    } else {
      await refresh($, maxRounds)
    }
    return done
  })

  // The band: one row, most important first. A status badge colored by whose move it is, the task, a dot per stage
  // and the current one by name, the round's progress, then Next (it fills the prompt) and Dashboard.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const t = await read($, task)
    const r = liveReview(await read($, reviews))
    if ((!t && !r) || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns ?? 120
    // No task, only a review: its status, what it reviews, and how far it got.
    if (!t && r) {
      return (
        <Box flexDirection="row" gap={2}>
          <Text backgroundColor="claude" color="inverseText" bold> {r.status} </Text>
          {columns >= 90 ? <Text dimColor>{r.id} · {r.risk}</Text> : null}
          <Text bold>{reviewProgress(r)}</Text>
          <Button key="open" label="Dashboard" onPress={() => open($, true)} />
        </Box>
      )
    }
    if (!t) return next(e)
    const known = prOf(t, await read($, pr))
    const rail = railFor(t, known)
    const current = rail.find(s => s.state === 'active' || s.state === 'stuck' || s.state === 'waiting')
    const currentLabel = !current ? ''
      : current.name === 'Review' && t.round > 0 ? `Review ${t.round}/${t.maxRounds}`
        : current.name === 'PR' ? prDetail(known, t.prDrafted) || 'PR'
          : current.name
    const problems = problemsOf(t)
    const progress = [reviewerProgress(t.now), checkProgress(t.checks, t.proof !== null)].filter(Boolean).join(' · ')
    const command = nextCommand(nextFor(t, known))

    return (
      <Box flexDirection="row" gap={2}>
        <Text backgroundColor={whoseMove(t.status)} color="inverseText" bold> {t.status || 'no status'} </Text>
        {columns >= 90 ? <Text dimColor>{t.slug} · {t.risk}</Text> : null}
        <Text>
          {rail.map(s => {
            const [glyph, color] = GLYPH[s.state]
            return <Text key={s.name} color={color}>{glyph}</Text>
          })}
          {currentLabel ? <Text bold> {currentLabel}</Text> : null}
        </Text>
        {columns >= 110 && progress ? <Text dimColor>{progress}</Text> : null}
        {problems.length > 0 ? <Text color="error">{columns >= 110 ? problems.join(' · ') : problems[0]}</Text> : null}
        {/* A review running beside the task, briefly: the pane has the rest. */}
        {r && columns >= 110 ? <Text dimColor>{r.id}: {reviewProgress(r)}</Text> : null}
        <Box flexDirection="row" gap={1}>
          {command ? <Button key="next" variant="primary" label={columns >= 110 ? `▶ ${command}` : '▶ Next'} onPress={() => void fillPrompt($, command)} /> : null}
          <Button key="open" label="Dashboard" onPress={() => open($, true)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const t = await read($, task)
    const all = await read($, reviews)
    const rv = liveReview(all)
    const past = all.filter(r => r !== rv)
    const crew = await read($, agents)
    const folds = await read($, sections)
    await read($, clock) // redraw on each tick
    const clockNow = await $.clock.now()

    // A small filled label: the severity of a finding, or a check's result.
    const badge = (key: string, label: string, color: string) => (
      <Text key={key} backgroundColor={color} color="inverseText" bold> {label} </Text>
    )
    const copy = (key: string, text: string) => (
      <Button key={key} plain dimColor label="copy" onPress={press => void $.ui.copy({ text, surface: press.surface }).catch(() => undefined)} />
    )

    // One line per reviewer or report: ● running, ✓ or ✗ done, ○ waiting.
    const line = (key: string, state: 'running' | 'done' | 'waiting', label: string, detail: string, isBad = false) => (
      <Text key={key} wrap="truncate-end">
        <Text color={state === 'running' ? 'claude' : state === 'waiting' ? 'inactive' : isBad ? 'error' : 'success'}>
          {state === 'running' ? '●' : state === 'waiting' ? '○' : isBad ? '✗' : '✓'}{' '}
        </Text>
        <Text dimColor={state === 'waiting'}>{label.padEnd(22)}</Text>
        {detail ? <Text dimColor>{detail}</Text> : null}
      </Text>
    )
    const runningAs = (role: string) => crew.findLast(a => a.role === role && a.endedAt === null)
    const findingsLine = (key: string, label: string, f: Findings, prefix = '') => (
      <Text key={key} wrap="truncate-end">
        <Text color={f.important > 0 ? 'error' : 'success'}>{f.important > 0 ? '✗' : '✓'} </Text>
        <Text>{label.padEnd(22)}</Text>
        {f.important + f.nit + f.preExisting === 0
          ? <Text dimColor>{prefix}clean</Text>
          : (
            <Text>
              {prefix ? <Text dimColor>{prefix}</Text> : null}
              {f.important > 0 ? <Text color="error" bold>{f.important} IMPORTANT</Text> : null}
              {f.important > 0 && f.nit + f.preExisting > 0 ? <Text dimColor> · </Text> : null}
              {f.nit > 0 ? <Text dimColor>{f.nit} NIT</Text> : null}
              {f.nit > 0 && f.preExisting > 0 ? <Text dimColor> · </Text> : null}
              {f.preExisting > 0 ? <Text color="warning">{f.preExisting} pre-existing</Text> : null}
            </Text>
          )}
      </Text>
    )
    const reviewerLine = (r: Reviewer) => {
      const agent = runningAs(r.role)
      const label = ROLE_LABEL[r.role] ?? r.role
      if (r.findings) return findingsLine(r.role, label, r.findings, r.role === 'voter' ? 'kept ' : '')
      if (agent) return line(r.role, 'running', label, `running ${seconds(agent, clockNow)}`)
      return line(r.role, 'waiting', label, 'waiting')
    }
    // A report that only some runs write: shown once it exists or its agent runs.
    const reportLine = (role: string, important: number | null, detail: (k: number) => string) => {
      const agent = runningAs(role)
      if (important !== null) return line(role, 'done', ROLE_LABEL[role] ?? role, detail(important), important > 0)
      return agent ? line(role, 'running', ROLE_LABEL[role] ?? role, `running ${seconds(agent, clockNow)}`) : null
    }
    // `prefix` keeps the review card's keys apart from the Now card's.
    const keptLine = (f: KeptFinding, i: number, prefix = 'kept') => (
      <Box key={`${prefix}-${i}`} flexDirection="row" gap={1}>
        {badge(`${prefix}-badge-${i}`, f.tag === 'PRE-EXISTING' ? 'PRE' : f.tag, f.tag === 'IMPORTANT' ? 'error' : f.tag === 'NIT' ? 'subtle' : 'warning')}
        <Text dimColor wrap="truncate-end">{f.loc}</Text>
        <Box flexGrow={1} flexShrink={1}><Text wrap="truncate-end">{f.title}{f.confidence !== null ? ` (${f.confidence})` : ''}</Text></Box>
        {copy(`copy-${prefix}-${i}`, f.loc)}
      </Box>
    )

    // A section folds to one row; it opens by itself while it holds a problem, and a click overrides that. With no
    // task, only Reviews can show, and it opens by itself.
    const defaults: Record<Section, boolean> = t ? openByDefault(t)
      : { requirements: false, checks: false, rounds: false, reviews: true, spend: false, agents: false }
    const scope = t?.slug ?? ''
    const isOpen = (id: Section) => folds[`${scope}:${id}`] ?? defaults[id]
    const fold = (id: Section, label: string, summary: [string, string], note: string, body: () => unknown) => {
      const open = isOpen(id)
      return (
        <Box key={`section-${id}`} flexDirection="column">
          <Button
            key={`toggle-${id}`}
            plain
            hover={{ color: 'claude' }}
            onPress={() => void update($, sections, all => ({ ...all, [`${scope}:${id}`]: !open }))}
          >
            <Text dimColor>{open ? '▾ ' : '▸ '}</Text>
            <Text bold>{label.padEnd(15)}</Text>
            <Text color={summary[1]}>{summary[0]}</Text>
            {note ? <Text color={defaults[id] ? 'warning' : undefined} dimColor={!defaults[id]}>  {note}</Text> : null}
          </Button>
          {open ? <Box flexDirection="column" marginLeft={2}>{body() as never}</Box> : null}
        </Box>
      )
    }

    // The reviews before the live one, newest first. A row opens to its range and what its latest run kept.
    // INTERRUPTED: quorum-reviews found it unfinished. Running, but not in this session: another session runs it, or
    // ran it and stopped, which only that session's next Quorum command can tell.
    const isElsewhere = (r: Review) => isReviewRunning(r.status) && !r.isOurs
    const reviewRow = (r: Review) => {
      const isRowOpen = folds[`review:${r.id}`] ?? false
      const [glyph, color, result]: [string, string, string] = r.status === 'INTERRUPTED' ? ['!', 'warning', 'interrupted']
        : isElsewhere(r) ? ['●', 'warning', 'running elsewhere or interrupted']
          : r.status !== 'REVIEWED' ? ['○', 'inactive', r.status || 'no status']
            : !r.survivors ? ['✓', 'subtle', 'no findings saved']
              : r.survivors.important > 0 ? ['✗', 'error', findingsText(r.survivors)] : ['✓', 'success', findingsText(r.survivors)]
      return (
        <Box key={`past-${r.id}`} flexDirection="column">
          <Button key={`past-toggle-${r.id}`} plain hover={{ color: 'claude' }} onPress={() => void update($, sections, all => ({ ...all, [`review:${r.id}`]: !isRowOpen }))}>
            <Text color={color}>{glyph} </Text>
            <Text>{r.id}  </Text>
            <Text color={color === 'warning' ? 'warning' : undefined} dimColor={color !== 'warning'}>{result}</Text>
            <Text dimColor> · {r.risk || 'no tier'} · {plural(r.run, 'run')} · {ago(clockNow, r.changedAt)}</Text>
          </Button>
          {isRowOpen ? (
            <Box flexDirection="column" marginLeft={2}>
              {r.range ? <Text dimColor wrap="truncate-end">{r.range}</Text> : null}
              {r.status === 'INTERRUPTED' ? <Text color="warning" wrap="truncate-end">Run {r.run} never finished; /quorum:review on the same target starts a new run</Text> : null}
              {isElsewhere(r) ? <Text color="warning" wrap="truncate-end">Another session runs it, or stopped mid-run; its next Quorum command marks it interrupted</Text> : null}
              {r.kept.map((f, i) => keptLine(f, i, `past-${r.id}`))}
            </Box>
          ) : null}
        </Box>
      )
    }
    const stalled = past.filter(r => r.status === 'INTERRUPTED' || isElsewhere(r)).length
    const reviewsFold = past.length > 0 && fold('reviews', 'Reviews',
      [`${plural(past.length, 'review')} · newest ${ago(clockNow, past[0]?.changedAt ?? clockNow)}`, 'text'],
      stalled ? `${stalled} unfinished` : '',
      () => past.map(reviewRow))

    // A standalone review still running, as a card of its own: its reviewers, then the voter and what it kept, then
    // (FIXING) the builder. Beside a task it goes under the Now card, so it never hides the task.
    const reviewCard = rv && (() => {
      const builder = crew.findLast(a => a.role === 'builder')
      const important = rv.survivors?.important ?? 0
      return (
        <Box key="review" borderStyle="round" borderColor="claude" flexDirection="column" paddingX={1}>
          <Text wrap="truncate-end">
            <Text bold>Review · </Text>
            <Text bold color="claude">{rv.id}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {[rv.status, rv.risk, rv.range, rv.run > 0 ? `run ${rv.run}` : ''].filter(Boolean).join(' · ')}
          </Text>
          {rv.run === 0 ? <Text dimColor>Picking the reviewers</Text> : (
            <Box flexDirection="column">
              <Text dimColor>reviewers {rv.reviewers.filter(r => r.findings !== null).length}/{rv.reviewers.length} replied</Text>
              {rv.reviewers.map(reviewerLine)}
              {reviewerLine(rv.voter)}
              {rv.kept.filter(f => f.tag !== 'NIT' || rv.kept.length <= 4).map((f, i) => keptLine(f, i, 'review-kept'))}
              {rv.status === 'FIXING'
                ? line('builder', builder?.endedAt === null ? 'running' : builder ? 'done' : 'waiting', 'Builder',
                  builder ? `fixing ${plural(important, 'IMPORTANT finding')} · ${seconds(builder, clockNow)}` : `fixes ${plural(important, 'IMPORTANT finding')}`)
                : null}
            </Box>
          )}
        </Box>
      )
    })()

    if (!t) {
      return (
        <Box flexDirection="column" gap={1}>
          {reviewCard || (
            <Box key="empty" borderStyle="round" borderColor="subtle" flexDirection="column" paddingX={1}>
              <Text bold>No active Quorum task</Text>
              <Text dimColor>/quorum:spec-and-eval or /quorum:run starts one; /quorum:review reviews any diff.</Text>
            </Box>
          )}
          {reviewsFold}
        </Box>
      )
    }
    const known = prOf(t, await read($, pr))
    const rail = railFor(t, known)
    const n = t.now
    const spec = t.spec
    const { title, ticket } = splitTicket(spec?.title || t.slug)

    const shown = new Set<string>([
      ...(n.kind === 'plan' || n.kind === 'review' ? [...n.reviewers.map(r => r.role), 'voter']
        : n.kind === 'spec' ? n.reviewers.map(r => r.role)
          : n.kind === 'build' ? ['builder', 'prover']
            : n.kind === 'blind' ? ['blind', 'a11y', 'security', 'triage'] : []),
      ...(rv ? [...rv.reviewers.map(r => r.role), 'voter', ...(rv.status === 'FIXING' ? ['builder'] : [])] : []),
    ])
    const others = crew.filter(a => !shown.has(a.role)).slice(-6)
    const spend = spendOf(crew)
    const taskChecks = t.checks.filter(c => c.id !== 'fast').length
    const passed = t.checks.filter(c => c.result === 'PASS').length
    // No proof file, but the round log says every check passed: mark them, muted, as reported rather than proven.
    const isReported = !t.proof && isReportedPass(t.checksNote)
    const REPORTED: readonly [string, string] = ['✓', 'subtle']
    const requirements = (spec?.requirements ?? []).map(r => ({ ...r, ...requirementState(r.n, t.checks) }))
    const met = requirements.filter(r => r.state === 'pass').length

    // The Now card's border says whose move it is: amber when the task waits on the person, red when it's stuck.
    const nowColor = whoseMove(t.status)
    const next = nextFor(t, known)
    const command = nextCommand(next)


    const failedRequirement = requirements.find(r => r.state === 'fail')
    const uncheckedRequirement = requirements.find(r => r.state === 'none')
    const checksSummary: [string, string] = t.proof
      ? [`${passed}/${t.checks.length} pass`, passed === t.checks.length ? 'success' : 'error']
      : t.expectedProof ? ['no proof saved', 'warning']
        : isReported ? [`${t.checks.length} reported passing`, 'subtle'] : [`${taskChecks} not run yet`, 'inactive']
    const checksNote = t.isProofStale ? 'proof older than HEAD'
      : !t.proof && t.expectedProof ? `${t.expectedProof} missing`
        : t.stopBlocks > 0 && isHookActive(t.status) ? `Stop hook blocked ${plural(t.stopBlocks, 'time')}`
          : t.pending > 0 ? `${plural(t.pending, 'finding')} pending`
            : (t.checks.find(c => c.result === 'FAIL') ? `✗ ${t.checks.find(c => c.result === 'FAIL')?.id} ${t.checks.find(c => c.result === 'FAIL')?.label}` : '')
    const lastRound = t.rounds[t.rounds.length - 1]
    const roundsSummary = t.rounds.map(r => `r${r.n} ${r.findings === null ? 'reviewing' : r.findings.important > 0 ? `${r.findings.important} IMPORTANT` : 'clean'}`).join(' · ')
    const running = others.filter(a => a.endedAt === null).length

    return (
      <Box flexDirection="column" gap={1}>
        <Box key="header" borderStyle="round" borderColor="subtle" hover={{ borderColor: 'claude' }} flexDirection="column" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1}><Text bold wrap="truncate-end">{title}</Text></Box>
            {ticket ? <Text dimColor>{ticket}</Text> : null}
          </Box>
          <Text wrap="truncate-end">
            <Text dimColor>{t.slug} · </Text>
            <Text color={whoseMove(t.status)} bold>{t.status || 'no status'}</Text>
            <Text dimColor> · {t.risk || 'no risk tier'}{spec?.isUi ? ' · UI change' : ''}</Text>
          </Text>
          {spec?.goal ? <Text dimColor wrap="truncate-end">{spec.goal}</Text> : null}
          <Text>
            {rail.map((s, i) => {
              const [glyph, color] = GLYPH[s.state]
              const label = s.name === 'Review' && t.round > 0 ? `${s.name} ${t.round}/${t.maxRounds}` : s.name
              return (
                <Text key={s.name} color={color} bold={s.state === 'active' || s.state === 'stuck'} dimColor={s.state === 'todo' || s.state === 'skipped'}>
                  {i > 0 ? <Text dimColor> ─ </Text> : null}{glyph}{label}
                </Text>
              )
            })}
          </Text>
          {stageDetails(t, known) ? <Text dimColor wrap="truncate-end">{stageDetails(t, known)}</Text> : null}
          {known && known.number > 0 && known.url ? (
            <Box flexDirection="row" gap={1}>
              {/* The PR's number is the link; its state follows, as GitHub last reported it (none when unknown). */}
              <Link href={known.url} label={`PR #${known.number}`} />
              {prState(known) ? <Text color={known.state === 'MERGED' ? 'success' : known.state === 'CLOSED' ? 'error' : 'warning'}>{prState(known)}</Text> : null}
              {copy('copy-pr', known.url)}
            </Box>
          ) : null}
        </Box>

        <Box key="now" borderStyle="round" borderColor={nowColor} flexDirection="column" paddingX={1}>
          <Text wrap="truncate-end">
            <Text bold>Now · </Text>
            <Text bold color={nowColor}>{nowTitle(n, t.maxRounds)}</Text>
          </Text>
          {n.kind === 'spec' && <Text dimColor>{plural(n.requirements, 'requirement')} in rd.md · {plural(taskChecks, 'check')} in eval.md</Text>}
          {n.kind === 'spec' && n.reviewers.map(reviewerLine)}
          {(n.kind === 'plan' || n.kind === 'review') && n.round > 0 && (
            <Box flexDirection="column">
              <Text dimColor>{reviewerProgress(n)} replied</Text>
              {n.reviewers.map(reviewerLine)}
              {reviewerLine(n.voter)}
              {n.kept.filter(f => f.tag !== 'NIT' || n.kept.length <= 4).map((f, i) => keptLine(f, i))}
              {(() => {
                const v = verdict(n)
                return v ? <Text color={v[1]} wrap="truncate-end">{v[0]}</Text> : null
              })()}
            </Box>
          )}
          {n.kind === 'build' && (
            <Box flexDirection="column">
              {(['builder', 'prover'] as const).map(role => {
                const agent = crew.findLast(a => a.role === role)
                const label = role === 'builder' ? 'Builder' : 'Prover'
                if (!agent) return line(role, 'waiting', label, role === 'builder' ? 'implements plan.md' : 'runs every check after the build')
                return line(role, agent.endedAt === null ? 'running' : 'done', label, `${agent.endedAt === null ? 'running' : 'took'} ${seconds(agent, clockNow)}`)
              })}
            </Box>
          )}
          {n.kind === 'blind' && (
            <Box flexDirection="column">
              {n.blind.result
                ? line('blind', 'done', ROLE_LABEL.blind ?? 'Blind user', `${n.blind.result === 'REACHED' ? 'reached the goal' : 'did not reach the goal'} · ${plural(n.blind.blockers, 'blocker')} · ${n.blind.friction} friction`, n.blind.result !== 'REACHED' || n.blind.blockers > 0)
                : runningAs('blind')
                  ? line('blind', 'running', ROLE_LABEL.blind ?? 'Blind user', `running ${seconds(runningAs('blind') as QuorumAgent, clockNow)}`)
                  : line('blind', 'waiting', ROLE_LABEL.blind ?? 'Blind user', 'waiting')}
              {reportLine('a11y', n.blind.a11y, k => k ? `${k} IMPORTANT` : 'clean')}
              {reportLine('security', n.blind.security, k => k ? `${k} IMPORTANT` : 'clean')}
              {reportLine('triage', n.blind.caused, k => k ? `${plural(k, 'item')} caused by this change` : 'nothing caused by this change')}
            </Box>
          )}
          {n.kind === 'done' && !(known && known.number > 0) && (
            <Text dimColor>{t.prDrafted ? 'Every stage is done; pr.md is drafted.' : 'Every stage is done.'}</Text>
          )}
          <Box flexDirection="row" gap={1} marginTop={1}>
            {command
              ? <Button key="next" variant="primary" label={`▶ Next: ${command}`} onPress={() => void fillPrompt($, command)} />
              : <Text><Text dimColor>Next: </Text><Text>{next}</Text></Text>}
            {command ? <Text dimColor wrap="truncate-end">{next === command ? 'fills the prompt' : next}</Text> : null}
          </Box>
        </Box>

        {reviewCard}

        <Box flexDirection="column" gap={1}>
          {requirements.length > 0 && fold('requirements', 'Requirements',
            t.proof ? [`${met}/${requirements.length} met`, met === requirements.length ? 'success' : 'warning']
              : isReported ? [`${requirements.length} reported passing`, 'subtle'] : [`${requirements.length} in rd.md`, 'inactive'],
            failedRequirement ? `✗ ${failedRequirement.n} ${failedRequirement.title}` : uncheckedRequirement ? `${uncheckedRequirement.n} has no check` : '',
            () => [
              isReported ? <Text key="reported" dimColor>From the round log, not a saved proof</Text> : null,
              ...requirements.map(r => {
                const [glyph, color] = isReported && r.state === 'open' ? REPORTED : REQUIREMENT_GLYPH[r.state]
                return (
                  <Text key={`req-${r.n}`} wrap="truncate-end">
                    <Text color={color}>{glyph} </Text>
                    <Text dimColor>{r.n}  </Text>
                    <Text>{r.title}</Text>
                    {r.state === 'none' ? <Text color="warning">  no check in eval.md</Text> : null}
                  </Text>
                )
              }),
              ...(spec && spec.nonGoals.length > 0 ? [
                <Text key="non-head" dimColor bold>Not in scope</Text>,
                ...spec.nonGoals.slice(0, 4).map((g, i) => <Text key={`non-${i}`} dimColor wrap="truncate-end">- {g}</Text>),
                spec.nonGoals.length > 4 ? <Text key="non-more" dimColor>and {spec.nonGoals.length - 4} more in rd.md</Text> : null,
              ] : []),
            ])}

          {fold('checks', 'Checks', checksSummary, checksNote, () => [
            t.proof && !t.isProofStale ? <Text key="proof" dimColor>{t.proof.file}{t.proof.rev ? ` at ${t.proof.rev}` : ''}</Text> : null,
            t.proof && t.isProofStale ? (
              <Text key="stale" color="warning">
                {t.proof.file} ran at {t.proof.rev}, before HEAD ({t.head.slice(0, 7)}): these results may be out of date
              </Text>
            ) : null,
            !t.proof && t.expectedProof ? (
              <Text key="missing" color="warning">
                {t.expectedProof} is missing{t.expectedProof === 'proof-final.md' ? ', so /quorum:pr-draft will stop' : ''}
              </Text>
            ) : null,
            !t.proof && t.expectedProof && t.checksNote ? <Text key="note" dimColor>Round log: {t.checksNote}</Text> : null,
            ...t.checks.map(c => (
              <Box key={`check-${c.id}`} flexDirection="row" gap={1}>
                {c.result === 'PASS' ? badge(`b-${c.id}`, 'PASS', 'success')
                  : c.result === 'FAIL' ? badge(`b-${c.id}`, 'FAIL', 'error')
                    : c.result === 'SKIPPED' ? badge(`b-${c.id}`, 'SKIP', 'warning')
                      : <Text color={isReported ? 'subtle' : 'inactive'}>{isReported ? '  ✓   ' : '  ○   '}</Text>}
                <Text dimColor>{c.id.padEnd(4)}</Text>
                <Box flexShrink={1}><Text dimColor={c.result === null} wrap="truncate-end">{c.label}</Text></Box>
              </Box>
            )),
            t.stopBlocks > 0 && isHookActive(t.status) ? <Text key="blocks" color="warning">Stop hook blocked {plural(t.stopBlocks, 'time')} in a row</Text> : null,
            t.pending > 0 ? <Text key="pending" color="warning">{plural(t.pending, 'finding')} pending for the builder</Text> : null,
          ])}

          {t.rounds.length > 0 && fold('rounds', 'Review rounds',
            [roundsSummary, lastRound?.findings && lastRound.findings.important > 0 ? 'error' : 'text'],
            t.status === 'HALTED' ? 'HALTED: see the post-mortem' : '',
            () => t.rounds.map(r => (
              <Text key={`round-${r.n}`} wrap="truncate-end">
                <Text dimColor>Round {r.n}  </Text>
                {r.findings === null
                  ? <Text dimColor>{r.candidates === null ? 'reviewing…' : `${r.candidates} candidates, voting…`}</Text>
                  : (
                    <Text>
                      <Text color={r.findings.important > 0 ? 'error' : 'success'}>{r.findings.important} IMPORTANT</Text>
                      <Text dimColor> · {r.findings.nit} NIT · {r.findings.preExisting} pre-existing</Text>
                      {r.candidates !== null && <Text dimColor>  (voter kept {r.findings.important + r.findings.nit + r.findings.preExisting} of {r.candidates})</Text>}
                    </Text>
                  )}
              </Text>
            )))}

          {reviewsFold}

          {spend.agents > 0 && fold('spend', 'Spend',
            [`${plural(spend.agents, 'agent')} · ${tokenCount(spend.tokensIn)} in · ${tokenCount(spend.tokensOut)} out`, 'text'], '',
            () => [
              <Text key="since" dimColor>Since the last command; {tokenCount(spend.tokensCached)} of the input was cached</Text>,
              <Text key="models" dimColor wrap="truncate-end">{spend.models.map(([m, k]) => `${m} ×${k}`).join(' · ')}</Text>,
            ])}

          {others.length > 0 && fold('agents', 'Other agents',
            [running > 0 ? `${running} running · ${others.length - running} done` : `${others.length} done`, running > 0 ? 'claude' : 'text'], '',
            () => others.map(a => (
              <Text key={a.id} wrap="truncate-end">
                <Text color={a.endedAt === null ? 'claude' : 'success'}>{a.endedAt === null ? '●' : '✓'} </Text>
                <Text>{a.type}</Text>
                <Text dimColor>  {a.description} · {seconds(a, clockNow)}{a.tokensIn + a.tokensOut > 0 ? ` · ${tokenCount(a.tokensIn + a.tokensOut)} tokens` : ''}</Text>
              </Text>
            )))}
        </Box>
      </Box>
    )
  })
}

