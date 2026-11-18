// Quorum's dashboard: a band above the prompt, and a pane with what the current stage is doing (each reviewer of the
// round, the blind test's reports), how the task's checks stand, its stages, review rounds and running agents, and
// standalone reviews (/quorum:review): the one running now, and the ones before it. It only reads .tasks/; the skills and bin/ scripts stay the
// source of truth.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ChangedFile, Check, Findings, FindingsView, Now, OtherTask, PullRequest, QuorumAgent, Review, Reviewer, Round, RoundKept, Section, Snapshot, Stage } from '../../types'
import {
  ROLE_LABEL, STAGES, branchFromHead, isStaleProof, packedRef, checksNoteFromLog, isPrStage, isReportedPass, parsePr, prDetail, prFromUrl, prNext, count, countFindings, countRequirements, evalRows, expectedProof, isHookActive, isStuck, joinChecks, parseSpec, requirementState, list, nextStep, parseBlind,
  parseFrontmatter, parseProof, reviewer, roleOf, roundReviewers, scalar, slugFromHead, spendOf, modelMismatches, choiceLabel, normalizePath, isFinished, countPlanSteps, parsePlanSteps, SLICE_AT, stageOf, stages, tokenCount,
  nextCommand, openByDefault, problemsOf, splitTicket, ago, isReviewId, isReviewRunning, latestRun, liveReview, shortRange, plural, voterNext, parseFileList, stepProgress, buildingStep, editPath, unmetNote, unmetNow, unmetWords,
} from './task'
import { awaitingFrom, awaitingOf, cellWidth, changeHeader, confidenceRow, footprint, iconsOn, isBigTree, isEditShown, markText, markWords, roundKept, runEnds, slashes, stepFindings, stepRows, trackFindings, treeHeader, treeRows } from './tree'
import type { StepLine, TreeChange, TreeEdit, TreePart } from './tree'

const PANE = 'quorum-dashboard'
const COMMAND = 'quorum-dashboard'
// Change a tag when its value's fields change: it declines what an earlier version stored.
const task = atom({ plugin: 'quorum', key: 'task' } as const, null, { shape: 'task-17' })
const agents = atom({ plugin: 'quorum', key: 'agents' } as const, [], { shape: 'agents-3' })
const pr = atom({ plugin: 'quorum', key: 'pr' } as const, null, { shape: 'pr-1' })
const reviews = atom({ plugin: 'quorum', key: 'reviews' } as const, [], { shape: 'reviews-3' })
const otherTasks = atom({ plugin: 'quorum', key: 'others' } as const, [], { shape: 'others-1' })
// Sections and findings-tree rows the person opened or closed in the pane, by `<slug>:<section>`, or
// `<scope>:tree:<path>` for a tree row (`<scope>` is the task's slug or the review's id).
const sections = atom({ plugin: 'quorum', key: 'sections' } as const, {}, { shape: 'sections-1' })
// How long a PR lookup stands before the next refresh asks GitHub again.
const PR_TTL_MS = 2 * 60 * 1000
// Bumped every second while a Quorum agent runs, so the pane's running times count up.
const clock = atom({ plugin: 'quorum', key: 'now' } as const, 0)
let ticker: Timer | null = null
// The plan step whose files the tree highlights, chosen by a press on its row. Kept in memory only, never stored.
let selected: { slug: string; n: number } | null = null
// The file being edited (repo-relative), by which agent (null for the main session) and when, kept in memory only.
// `flash` is the timer that redraws once its highlight is over.
type Edit = { slug: string; path: string; agentId: string | null; at: number }
let edit: Edit | null = null
let flash: Timer | null = null
const FLASH_MS = 2500
// The statuses an edit is recorded and shown in: Build and the code review's fix rounds.
const EDIT_STATUSES = ['BUILDING', 'IN_REVIEW']
function clearEdit() {
  flash?.cancel()
  flash = null
  edit = null
}

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

// From Review on, the plan's steps fold to one row.
const FOLDED_STEPS = ['IN_REVIEW', 'CONVERGED', 'BLIND-TEST', 'READY', 'AWAITING-HUMAN', 'HALTED', 'ESCALATED']

const REVIEW_FILES = ['logic.md', 'architecture.md', 'patterns.md', 'docs.md', 'tests.md', 'a11y.md', 'security.md', 'votes.md', 'survivors.md']


const readOr = ($: EngineInterface, path: string) => $.fs.read(path).catch(() => null)

// The session's git dir, and the root whose .tasks/ it uses (bin/quorum-active-task --root): for a linked worktree,
// whose .git is a file naming its git dir and whose commondir leads to the main one, the main working tree.
async function gitPaths($: EngineInterface, root: string): Promise<{ gitdir: string; tasksRoot: string; isLinked: boolean }> {
  const pointer = /^gitdir:\s*(.+)$/m.exec((await readOr($, `${root}/.git`)) ?? '')?.[1]?.trim()
  if (!pointer) return { gitdir: `${root}/.git`, tasksRoot: root, isLinked: false }
  const gitdir = pointer.startsWith('/') ? pointer : normalizePath(`${root}/${pointer}`)
  const common = ((await readOr($, `${gitdir}/commondir`)) ?? '').trim()
  const main = common ? normalizePath(common.startsWith('/') ? common : `${gitdir}/${common}`) : ''
  return main.endsWith('/.git') ? { gitdir, tasksRoot: main.slice(0, -'/.git'.length), isLinked: true } : { gitdir, tasksRoot: root, isLinked: false }
}

// The slug bin/quorum-active-task would print: a feat/ or fix/ branch with a task folder, then .tasks/.active,
// which belongs to the main working tree, so a linked worktree never falls back to it. `root` is the session's
// project root, which follows the session into a worktree.
async function activeSlug($: EngineInterface, root: string): Promise<{ slug: string; branch: string; head: string; tasksRoot: string }> {
  const { gitdir, tasksRoot, isLinked } = await gitPaths($, root)
  const headFile = (await readOr($, `${gitdir}/HEAD`)) ?? ''
  const branch = branchFromHead(headFile)
  const head = await headCommit($, gitdir, headFile, branch)
  const fromBranch = slugFromHead(headFile)
  if (fromBranch && (await $.fs.exists(`${tasksRoot}/.tasks/${fromBranch}/state.md`))) return { slug: fromBranch, branch, head, tasksRoot }
  const active = isLinked ? '' : ((await readOr($, `${tasksRoot}/.tasks/.active`)) ?? '').split('\n')[0]?.trim() ?? ''
  return { slug: /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(active) ? active : '', branch, head, tasksRoot }
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

// One round of a plan or code review, as its files stand: what the voter kept, the candidates it voted on, and the
// findings it dropped on dispute (null while a file isn't written), and whether the round's folder exists yet.
type RoundFiles = { n: number; survivors: string | null; candidates: string | null; disputes: string | null; exists: boolean }

// Rounds 1..last under a review's folder. A counter ahead of the folders on disk reads as rounds with no files.
async function roundHistory($: EngineInterface, dir: string, last: number): Promise<RoundFiles[]> {
  const out: RoundFiles[] = []
  for (let n = 1; n <= last; n++) {
    const at = `${dir}/round-${n}`
    const files = await readFiles($, at, ['survivors.md', 'candidates.md', 'disputes.md'])
    out.push({
      n,
      survivors: files['survivors.md'] ?? null,
      candidates: files['candidates.md'] ?? null,
      disputes: files['disputes.md'] ?? null,
      exists: (await $.fs.list(at).catch(() => [])).length > 0,
    })
  }
  return out
}

const roundOf = (h: RoundFiles): Round => ({
  n: h.n,
  findings: h.survivors === null ? null : countFindings(h.survivors),
  candidates: h.candidates === null ? null : (({ important, nit, preExisting }) => important + nit + preExisting)(countFindings(h.candidates)),
})

// The findings tree for a task's review: the rounds with a survivors.md, the last of them on show.
const treeOf = (history: RoundFiles[], roots: string[]): FindingsView | null =>
  trackFindings(history.flatMap(h => (h.survivors === null ? [] : [roundKept(h.n, h.survivors, h.disputes ?? '', null)])), roots, 'round')

// One plan or code review round: its reviewers' replies, the voter's, what survived, the findings tree over the
// review's rounds so far, and how many of each reply's IMPORTANT findings are now awaiting re-review (`rereview`,
// the paths the fix changed; `roots`, what a reply's paths are read against).
async function roundNow($: EngineInterface, dir: string, kind: 'plan' | 'review', round: number, of: number, risk: string, tree: FindingsView | null, rereview: string[], roots: string[]): Promise<Now> {
  const files = await readFiles($, `${dir}/round-${round}`, REVIEW_FILES)
  const survivors = files['survivors.md']
  const reviewers = roundReviewers(kind, risk, files)
  const rereviewBy: Record<string, number> = {}
  for (const r of reviewers) {
    const reply = files[`${r.role}.md`]
    const k = reply === undefined || rereview.length === 0 ? 0 : awaitingFrom(reply, tree, rereview, roots)
    if (k > 0) rereviewBy[r.role] = k
  }
  return {
    kind,
    round,
    of,
    reviewers,
    voter: reviewer('voter', files['votes.md']),
    survivors: survivors === undefined ? null : countFindings(survivors),
    tree,
    rereviewBy,
  }
}

// Each review's rounds, and the roots a finding's path is read against (the session's, the main working tree's,
// and the task's worktree's).
type Histories = { code: RoundFiles[]; plan: RoundFiles[]; roots: string[] }

// What the current stage is doing, read from the files its skill saves.
async function nowFor($: EngineInterface, dir: string, t: Pick<Snapshot, 'stage' | 'risk' | 'round' | 'maxRounds' | 'planRounds' | 'blindRuns' | 'codeView' | 'rereview'>, rd: string, h: Histories): Promise<Now> {
  const codeRound = () => roundNow($, `${dir}/review`, 'review', t.round, t.maxRounds, t.risk, t.codeView, t.rereview, h.roots)
  switch (STAGES[t.stage]) {
    case 'Spec': {
      const files = await readFiles($, `${dir}/spec-review`, ['feasibility.md', 'improver.md'])
      return {
        kind: 'spec',
        requirements: countRequirements(rd),
        reviewers: [reviewer('feasibility', files['feasibility.md']), reviewer('improver', files['improver.md'])],
      }
    }
    case 'Plan': return roundNow($, `${dir}/plan-review`, 'plan', t.planRounds, 2, t.risk, treeOf(h.plan, h.roots), [], h.roots)
    case 'Build': return { kind: 'build' }
    case 'Review': return codeRound()
    case 'Blind test': {
      if (t.risk === 'LOW' || t.blindRuns === 0) return t.round > 0 ? codeRound() : { kind: 'done' }
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
  const sessionRoot = await $.session.root()
  const { slug, branch, head, tasksRoot: root } = await activeSlug($, sessionRoot)
  if (!slug) return null
  const text = await readOr($, `${root}/.tasks/${slug}/state.md`)
  if (text === null) return null
  const fm = parseFrontmatter(text)
  const status = scalar(fm, 'status')
  const risk = scalar(fm, 'risk')
  const round = count(fm, 'round')
  const planRounds = count(fm, 'plan_rounds')

  const histories: Histories = {
    code: await roundHistory($, `${root}/.tasks/${slug}/review`, round),
    plan: await roundHistory($, `${root}/.tasks/${slug}/plan-review`, planRounds),
    roots: [sessionRoot, root, scalar(fm, 'worktree')],
  }

  // ESCALATED records the status it interrupted; HALTED comes from the review loop, or from blind test after 2 runs.
  const stage = status === 'ESCALATED' && scalar(fm, 'escalated_from')
    ? stageOf(scalar(fm, 'escalated_from'), undefined)
    : status === 'HALTED' && count(fm, 'blind_runs') > 0
      ? STAGES.indexOf('Blind test')
      : stageOf(status, previous?.slug === slug ? previous.stage : undefined)
  const blindRuns = count(fm, 'blind_runs')

  const dir = `${root}/.tasks/${slug}`
  const rd = (await readOr($, `${dir}/rd.md`)) ?? ''
  const evalMd = (await readOr($, `${dir}/eval.md`)) ?? ''
  const plan = (await readOr($, `${dir}/plan.md`)) ?? ''
  // proof-final.md is written after the review loop or blind test, so it is the newer one when both exist.
  const proofs = await readFiles($, dir, ['proof-final.md', 'proof-build.md'])
  const proofFile = proofs['proof-final.md'] !== undefined ? 'proof-final.md' : proofs['proof-build.md'] !== undefined ? 'proof-build.md' : ''
  const proof = proofFile ? parseProof(proofs[proofFile] ?? '', proofFile) : null
  // The recorded change, and the code review's findings tree. A kept IMPORTANT on a file the list marks changed
  // since the round sha is awaiting re-review only when the list was recorded after the round on show voted
  // (`recorded` is in seconds, the mtime in milliseconds).
  const files = parseFileList((await readOr($, `${dir}/files.tsv`)) ?? '')
  const codeView = treeOf(histories.code, histories.roots)
  const votedAt = codeView ? (await $.fs.stat(`${dir}/review/round-${codeView.round}/survivors.md`).catch(() => null))?.mtimeMs ?? null : null
  const rereview = files && files.since !== '' && votedAt !== null && files.recorded * 1000 > votedAt
    ? files.files.filter(f => f.fix === true).map(f => f.path) : []

  return {
    slug,
    branch,
    prDrafted: await $.fs.exists(`${dir}/pr.md`),
    prUrl: scalar(fm, 'pr'),
    risk,
    isFast: scalar(fm, 'fast') === 'true',
    isBug: scalar(fm, 'bug') === 'true',
    planSteps: countPlanSteps(plan),
    steps: parsePlanSteps(plan),
    roots: histories.roots,
    builtSteps: list(fm, 'built_steps').length,
    builtList: list(fm, 'built_steps').map(Number).filter(n => Number.isInteger(n) && n > 0),
    hasBuildProof: proofs['proof-build.md'] !== undefined,
    reviewerModel: scalar(fm, 'reviewer_model'),
    helperModel: scalar(fm, 'helper_model'),
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
    rounds: histories.code.map(roundOf),
    planReviewRounds: histories.plan.filter(h => h.exists).map(roundOf),
    next: nextStep(status, risk),
    now: await nowFor($, dir, { stage, risk, round, maxRounds, planRounds, blindRuns, codeView, rereview }, rd, histories),
    spec: parseSpec(rd),
    checks: joinChecks(evalRows(evalMd), proof),
    proof,
    head,
    isProofStale: proof !== null && isStaleProof(proof.rev, head),
    expectedProof: expectedProof(status, stage),
    checksNote: proof ? '' : checksNoteFromLog(text),
    files,
    codeView,
    rereview,
  }
}

// How many other tasks the pane lists.
const OTHERS_SHOWN = 6

// The repo's other unfinished tasks (not standalone reviews), newest first: what else is in flight, in this working
// tree or in a worktree of its own.
async function othersSnapshot($: EngineInterface, root: string, current: string): Promise<OtherTask[]> {
  const tasks = `${root}/.tasks`
  // A task with its own worktree is a link to its folder there.
  const dirs = (await $.fs.list(tasks).catch(() => [])).filter(e => (e.kind === 'dir' || e.isLink) && e.name !== current && !isReviewId(e.name))
  const out: OtherTask[] = []
  for (const e of dirs) {
    const changedAt = (await $.fs.stat(`${tasks}/${e.name}/state.md`).catch(() => null))?.mtimeMs ?? -1
    if (changedAt < 0) continue
    const fm = parseFrontmatter((await readOr($, `${tasks}/${e.name}/state.md`)) ?? '')
    const status = scalar(fm, 'status')
    if (scalar(fm, 'kind') === 'review' || !status || isFinished(status)) continue
    out.push({ slug: e.name, status, risk: scalar(fm, 'risk'), worktree: scalar(fm, 'worktree'), changedAt })
  }
  return out.sort((a, b) => b.changedAt - a.changedAt).slice(0, OTHERS_SHOWN)
}

// How many reviews the dashboard keeps: the live one and the history under it.
const REVIEWS_SHOWN = 6

// The newest standalone reviews (skills/review keeps each in .tasks/review-<id>/), by when state.md last changed.
// `session` is this session's id: a running review that records it is the live one. `sessionRoot` is one of the
// roots a finding's path is read against.
async function reviewsSnapshot($: EngineInterface, root: string, session: string, sessionRoot: string): Promise<Review[]> {
  const tasks = `${root}/.tasks`
  const dirs = (await $.fs.list(tasks).catch(() => [])).filter(e => e.kind === 'dir' && isReviewId(e.name))
  const dated = await Promise.all(dirs.map(async e => ({
    id: e.name,
    mtimeMs: (await $.fs.stat(`${tasks}/${e.name}/state.md`).catch(() => null))?.mtimeMs ?? -1,
  })))
  const out: Review[] = []
  for (const { id, mtimeMs } of dated.filter(d => d.mtimeMs >= 0).sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    if (out.length >= REVIEWS_SHOWN) break
    const text = (await readOr($, `${tasks}/${id}/state.md`)) ?? ''
    const fm = parseFrontmatter(text)
    if (scalar(fm, 'kind') !== 'review') continue
    const risk = scalar(fm, 'risk')
    const run = latestRun((await $.fs.list(`${tasks}/${id}`).catch(() => [])).filter(e => e.kind === 'dir').map(e => e.name))
    const files = run > 0 ? await readFiles($, `${tasks}/${id}/run-${run}`, REVIEW_FILES) : {}
    const survivors = files['survivors.md']
    // Each run's kept findings, with the end of the range it reviewed; the latest run's come from `files`. A
    // standalone review has no disputes.md.
    const ends = runEnds(text, run, scalar(fm, 'range'))
    const runs: RoundKept[] = []
    for (let n = 1; n < run; n++) {
      const kept = await readOr($, `${tasks}/${id}/run-${n}/survivors.md`)
      if (kept !== null) runs.push(roundKept(n, kept, '', ends[n] ?? null))
    }
    if (survivors !== undefined) runs.push(roundKept(run, survivors, '', ends[run] ?? null))
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
      tree: trackFindings(runs, [sessionRoot, root, scalar(fm, 'worktree')], 'run'),
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

// What the stepper can't say: a requirement a current proof leaves unmet, the fast path, the mockup sign-off, the plan's
// rounds and approval, the blind-test runs, and a drafted PR before one is open. One line under the stepper.
function stageDetails(t: Snapshot, known: PullRequest | null): string {
  const plan = [t.planRounds ? `${t.planRounds} plan review round${t.planRounds === 1 ? '' : 's'}` : '',
    t.planApproved ? `approved ${t.planApproved}` : ''].filter(Boolean).join(', ')
  const unmet = unmetNow(t)
  return [
    unmet.length > 0 ? unmetWords(unmet).details : '',
    t.isBug ? 'bug fix: proven when its reproduction passes and fails without the fix' : '',
    t.isFast ? 'fast path: no plan round, one reviewer' : '',
    t.signoff ? `mockup signed off ${t.signoff}` : '',
    plan,
    t.risk !== 'LOW' && t.blindRuns ? `blind test: ${t.blindRuns} run${t.blindRuns === 1 ? '' : 's'}` : '',
    isPrStage(t.status) && !(known && known.number > 0) ? prDetail(known, t.prDrafted) : '',
  ].filter(Boolean).join(' · ')
}

// A known PR's state in a word or two, for after its linked number: '' when GitHub couldn't be asked.
const prState = (p: PullRequest) =>
  p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed without merging' : p.state === 'OPEN' ? (p.isDraft ? 'draft, open' : 'open') : ''

// Counts in the findings tree's marks (`✗1 n1 p1`), or `clean`.
const findingsText = (f: Findings) => markText(f) || 'clean'

// A review round in the Review rounds summary: `r1 ✗1`, `r2 clean`, `r3 reviewing`; in words for a label.
const roundText = (r: Round) => `r${r.n} ${r.findings === null ? 'reviewing' : r.findings.important > 0 ? `✗${r.findings.important}` : 'clean'}`
const roundWords = (r: Round) => `round ${r.n}: ${r.findings === null ? (r.candidates === null ? 'reviewing' : 'voting')
  : markWords({ important: r.findings.important, nit: 0, preExisting: 0 })}`

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

// The stage rail, with the PR stage done once GitHub says the PR merged.
const railFor = (t: Snapshot, known: PullRequest | null): Stage[] =>
  stages(t.status, t.risk, t.stage, t.isFast).map(s => (s.name === 'PR' && known?.state === 'MERGED' ? { ...s, state: 'done' } : s))

const nextFor = (t: Snapshot, known: PullRequest | null) => (isPrStage(t.status) ? prNext(known, t.prDrafted, t.next) : t.next)

const seconds = (a: QuorumAgent, now: number) => `${Math.max(0, Math.round(((a.endedAt ?? now) - a.startedAt) / 1000))}s`

// Re-read the task, the reviews, and the other tasks, redraw, and toast a status change worth interrupting for.
async function refresh($: EngineInterface, maxRounds: number, forcePr = false): Promise<Snapshot | null> {
  const before = await read($, task)
  const after = await snapshot($, maxRounds, before)
  await update($, task, () => after)
  if (edit && (!after || after.slug !== edit.slug || !EDIT_STATUSES.includes(after.status))) clearEdit()
  const session = await $.session.id().catch(() => '')
  const sessionRoot = await $.session.root()
  const { tasksRoot } = await gitPaths($, sessionRoot)
  const found = await reviewsSnapshot($, tasksRoot, session, sessionRoot)
  await update($, reviews, () => found)
  const elsewhere = await othersSnapshot($, tasksRoot, after?.slug ?? '')
  await update($, otherTasks, () => elsewhere)
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

// Record a successful Edit, Write or NotebookEdit of a file of the task, in Build or review, as its current edit:
// it flashes for FLASH_MS, with one timer that redraws when the flash ends. Reads no files, and never throws.
async function noteEdit($: EngineInterface, rawPath: string, agentId: string | undefined, ran: { deny?: string; isError?: true }) {
  try {
    if (ran.deny !== undefined || ran.isError) return
    const t = await read($, task)
    if (!t || !EDIT_STATUSES.includes(t.status)) return
    const cwd = await $.session.cwd().catch(() => $.session.root())
    const path = editPath(rawPath, cwd, t.roots)
    if (path === null) return
    edit = { slug: t.slug, path, agentId: agentId ?? null, at: await $.clock.now() }
    flash?.cancel()
    // A superseded timer was cancelled; the guard keeps one that still fires from clearing a newer one.
    const mine: Timer = $.clock.after(FLASH_MS, () => {
      if (flash === mine) flash = null
      $.ui.invalidate('ui.render')
    })
    flash = mine
    $.ui.invalidate('ui.render')
  } catch {
    // The dashboard only watches: a failed note leaves the last edit as it was.
  }
}

function open($: EngineInterface, focus?: true) {
  return $.ui.open({ id: PANE, title: 'Quorum', ...(focus ? { focus } : {}) })
}

export const register: Register = (on, options) => {
  const maxRounds = Number(options.max_rounds ?? 3) || 3
  // File type icons in the findings tree: only `nerd`, and only on the terminal (iconsOn).
  const fileIcons = options.file_icons

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: "Show or hide the Quorum task dashboard" })
    await settleAgents($)
    selected = null
    clearEdit()
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

  // Every status change goes through bin/quorum-state or quorum-active-task, and quorum-files records the change, so
  // re-read after those. The dashboard only watches: if one of its hooks fails, the call goes on as if it weren't there.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    // `gh pr create` or a push can open or change the PR: look it up again now.
    const isPrCommand = /\bgh\s+pr\b|\bgit\s+push\b/.test(e.command)
    if (isPrCommand || /quorum-(state|active-task|branch|files)|\.tasks\//.test(e.command)) await refresh($, maxRounds, isPrCommand)
    return ran
  }).catch(($, e, next) => next(e))

  // Reviewers' replies, proofs, and blind-test reports are saved with Write (or fixed with Edit), with either slash.
  // Any other file a Write, Edit or NotebookEdit changes in Build or review is the file being edited.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (slashes(e.file_path).includes('/.tasks/')) await refresh($, maxRounds)
    await noteEdit($, e.file_path, e.agentId, ran)
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (slashes(e.file_path).includes('/.tasks/')) await refresh($, maxRounds)
    await noteEdit($, e.file_path, e.agentId, ran)
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    await noteEdit($, e.notebook_path, e.agentId, ran)
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
    // The agent that made the edit finished its turn: the main session's (no agentId) for its own edits.
    if (edit && edit.agentId === (e.agentId ?? null)) {
      clearEdit()
      $.ui.invalidate('ui.render')
    }
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
    // The recorded change's file count, once the build has a base (the Task card's footprint line).
    const fp = t.files ? footprint(t.files, t.rounds, t.head, awaitingOf(t.codeView, t.rereview)) : null

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
        {columns >= 110 && fp ? <Text dimColor>{plural(fp.files, 'file')}</Text> : null}
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
    const copy = (key: string, text: string, label = 'copy') => (
      <Button key={key} plain dimColor label={label} onPress={press => void $.ui.copy({ text, surface: press.surface }).catch(() => undefined)} />
    )

    // The findings tree: its header and key, then a pressable row per folder, file, and finding, inside a card's
    // border and padding. A press folds or opens the row; an open finding adds the rest of its title, its
    // confidence, and a button that copies its `path:line`.
    const treeWidth = Math.max(24, (e.props.bodyColumns ?? 50) - 4)
    const partsOf = (key: string, parts: TreePart[]) => parts.map((p, i) => (
      <Text key={`${key}:${i}`} color={p.color} dimColor={p.dim} bold={p.bold}>{p.text}</Text>
    ))
    // With a recorded `change`, the tree holds its files too, and `header` (the Plan or Build one) replaces the
    // findings header. Past 15 files a line says the clean folders start folded.
    // `selected`: the plan step whose files are highlighted, their folders held open. `edit`: the file being edited.
    const findingsTree = (id: string, view: FindingsView | null, isHigh: boolean, width: number, change: TreeChange | null = null, header?: string, selected: number | null = null, edit: TreeEdit | null = null) => {
      const head = treeHeader(view, width, change, edit)
      if (!head) return null
      const title = header ?? head.header
      return (
        <Box key={`${id}:tree`} flexDirection="column">
          {title ? <Box key={`${id}:tree-header`}><Text dimColor wrap="truncate-end">{title}</Text></Box> : null}
          {isBigTree(view, change) ? <Box key={`${id}:tree-big`}><Text dimColor wrap="truncate-end">clean folders folded (15+ files)</Text></Box> : null}
          {head.key.map((parts, i) => (
            <Box key={`${id}:tree-key-${i}`}><Text wrap="truncate-end">{partsOf(`${id}:tree-key-${i}`, parts)}</Text></Box>
          ))}
          {treeRows(view, { scope: id, width, icons: iconsOn(fileIcons, e.surface), isHigh, folds, change, selected, edit }).flatMap(row => {
            // A finding dropped on dispute is drawn dim throughout.
            const isDim = row.kind === 'finding' && row.parts.every(p => p.dim)
            const confidence = row.kind === 'finding' && row.isOpen ? confidenceRow(row, width) : []
            return [
              <Button key={row.key} plain hover={{ color: 'claude' }} label={row.label} onPress={() => void update($, sections, all => ({ ...all, [row.key]: !row.isOpen }))}>
                <Text wrap="truncate-end" dimColor={isDim}>{partsOf(row.key, row.parts)}</Text>
              </Button>,
              ...(row.kind === 'finding' && row.isOpen ? row.more.map((text, i) => (
                <Box key={`${row.key}:more-${i}`}><Text wrap="truncate-end" dimColor={isDim}>{text}</Text></Box>
              )) : []),
              confidence.length > 0 ? (
                <Box key={`${row.key}:detail`} flexDirection="row">
                  {/* The copy button's text is the row's last part. */}
                  <Text dimColor>{(row.copy === null ? confidence : confidence.slice(0, -1)).map(p => p.text).join('')}</Text>
                  {row.copy === null ? null : copy(`${row.key}:copy`, row.copy, 'copy path')}
                </Box>
              ) : null,
            ]
          })}
        </Box>
      )
    }

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
    // Counts in the tree's marks, each coloured as the tree colours it: `✗1 n1 p1`, or `none` when all are zero.
    // `awaiting` of the IMPORTANT ones are awaiting re-review, drawn `↻` after the rest's `✗`.
    const marks = (f: Findings, none: string, awaiting = 0) => {
      const items = [
        f.important - awaiting > 0 ? <Text key="important" color="error" bold>✗{f.important - awaiting}</Text> : null,
        awaiting > 0 ? <Text key="awaiting" color="warning">↻{awaiting}</Text> : null,
        f.nit > 0 ? <Text key="nit" dimColor>n{f.nit}</Text> : null,
        f.preExisting > 0 ? <Text key="pre" dimColor>p{f.preExisting}</Text> : null,
      ].filter(item => item !== null)
      return items.length === 0 ? <Text dimColor>{none}</Text> : <Text>{items.flatMap((item, i) => (i > 0 ? [' ', item] : [item]))}</Text>
    }
    // A reply's glyph: ✓ only when clean, ✗ with an IMPORTANT finding, • for nits or pre-existing only. During a
    // round's fix, a reply whose IMPORTANT findings are now awaiting re-review (`awaiting`) reads `• ↻1 found ✗1`.
    const findingsLine = (key: string, label: string, f: Findings, awaiting = 0) => {
      const [glyph, color] = awaiting > 0 ? ['•', undefined] : f.important > 0 ? ['✗', 'error'] : f.nit + f.preExisting > 0 ? ['•', undefined] : ['✓', 'success']
      return (
        <Text key={key} wrap="truncate-end">
          <Text color={color} dimColor={color === undefined}>{glyph} </Text>
          <Text>{label.padEnd(22)}</Text>
          {awaiting > 0 ? <Text><Text color="warning">↻{awaiting}</Text><Text dimColor> found </Text></Text> : null}
          {marks(f, 'clean')}
        </Text>
      )
    }
    const pending = (role: string, label: string) => {
      const agent = runningAs(role)
      return agent ? line(role, 'running', label, `running ${seconds(agent, clockNow)}`) : line(role, 'waiting', label, 'waiting')
    }
    const reviewerLine = (r: Reviewer, awaiting = 0) => {
      const label = ROLE_LABEL[r.role] ?? r.role
      return r.findings ? findingsLine(r.role, label, r.findings, awaiting) : pending(r.role, label)
    }
    // The voter row, once the round's survivors.md exists: what it kept (after the nit cap), what the round's own
    // disputes.md dropped, and the pipeline's next step, so the verdict sits on this row. `awaiting` of the kept
    // IMPORTANT findings are awaiting re-review: `↻`, and a fix round reads `→ re-review`. `prefix` names the round
    // when the verdict is an earlier round's (`round 1: `).
    const voterLine = (kind: 'plan' | 'review' | 'standalone', survivors: Findings | null, round: number, of: number, status: string, dropped: number, awaiting = 0, prefix = '') => {
      const label = ROLE_LABEL.voter ?? 'voter'
      if (!survivors) return pending('voter', label)
      const [glyph, color] = survivors.important > awaiting ? ['✗', 'error'] : awaiting > 0 ? ['↻', 'warning'] : ['✓', 'success']
      const next = voterNext(kind, survivors.important, round, of, status)
      return (
        <Text key="voter" wrap="truncate-end">
          <Text color={color}>{glyph} </Text>
          <Text>{label.padEnd(22)}</Text>
          <Text dimColor>{prefix}kept </Text>
          {marks(survivors, 'nothing', awaiting)}
          {dropped > 0 ? <Text dimColor> · {dropped} dropped on dispute</Text> : null}
          <Text dimColor> → {awaiting > 0 && next === 'fix round' ? 're-review' : next}</Text>
        </Text>
      )
    }
    // A report that only some runs write: shown once it exists or its agent runs.
    const reportLine = (role: string, important: number | null, detail: (k: number) => string) => {
      const agent = runningAs(role)
      if (important !== null) return line(role, 'done', ROLE_LABEL[role] ?? role, detail(important), important > 0)
      return agent ? line(role, 'running', ROLE_LABEL[role] ?? role, `running ${seconds(agent, clockNow)}`) : null
    }

    // A section folds to one row; it opens by itself while it holds a problem, and a click overrides that. With no
    // task, only Reviews can show, and it opens by itself.
    // Spend opens while an agent ran on another model than the task chose.
    const mismatches = t ? modelMismatches(crew, t.reviewerModel, t.helperModel) : []
    const defaults: Record<Section, boolean> = t ? { ...openByDefault(t), spend: mismatches.length > 0 }
      : { tasks: true, requirements: false, checks: false, rounds: false, reviews: true, spend: false, agents: false }
    const scope = t?.slug ?? ''
    const isOpen = (id: Section) => folds[`${scope}:${id}`] ?? defaults[id]
    // `name`: the toggle's label, when its on-screen summary isn't in words or its note may be cut or moved under the
    // row; its state goes last. `layout`: the note as drawn, beside the summary or on its own line under the row; the
    // label keeps the whole `note`.
    const fold = (id: Section, label: string, summary: [string, string], note: string, body: () => unknown, name?: string, layout?: { beside: string; under: string }) => {
      const open = isOpen(id)
      const beside = layout ? layout.beside : note
      return (
        <Box key={`section-${id}`} flexDirection="column">
          <Button
            key={`toggle-${id}`}
            plain
            hover={{ color: 'claude' }}
            label={name === undefined ? undefined : `${name}${note ? `, ${note}` : ''}, ${open ? 'open' : 'folded'}`}
            onPress={() => void update($, sections, all => ({ ...all, [`${scope}:${id}`]: !open }))}
          >
            <Text dimColor>{open ? '▾ ' : '▸ '}</Text>
            <Text bold>{label.padEnd(15)}</Text>
            <Text color={summary[1]}>{summary[0]}</Text>
            {beside ? <Text color={defaults[id] ? 'warning' : undefined} dimColor={!defaults[id]}>  {beside}</Text> : null}
          </Button>
          {layout?.under ? <Text key={`${id}-note`} color={defaults[id] ? 'warning' : undefined} dimColor={!defaults[id]} wrap="truncate-end">  {layout.under}</Text> : null}
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
          <Button
            key={`past-toggle-${r.id}`}
            plain
            hover={{ color: 'claude' }}
            label={[r.id, r.status === 'REVIEWED' && r.survivors ? markWords(r.survivors) : result, r.risk || 'no tier', plural(r.run, 'run'), ago(clockNow, r.changedAt), isRowOpen ? 'open' : 'folded'].join(', ')}
            onPress={() => void update($, sections, all => ({ ...all, [`review:${r.id}`]: !isRowOpen }))}
          >
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
              {findingsTree(r.id, r.tree, r.risk === 'HIGH', treeWidth)}
            </Box>
          ) : null}
        </Box>
      )
    }
    // The repo's other unfinished tasks, one row each: where it is, and whether it has a worktree of its own.
    const rest = await read($, otherTasks)
    const inWorktrees = rest.filter(o => o.worktree).length
    const tasksFold = rest.length > 0 && fold('tasks', 'Other tasks',
      [`${plural(rest.length, 'unfinished task')}${inWorktrees ? ` · ${inWorktrees} in worktrees` : ''}`, 'text'], '',
      () => rest.map(o => (
        <Text key={`other-${o.slug}`} wrap="truncate-end">
          <Text>{o.slug}</Text>
          <Text dimColor>  {[o.status, o.risk, o.worktree ? 'own worktree' : '', ago(clockNow, o.changedAt)].filter(Boolean).join(' · ')}</Text>
        </Text>
      )))

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
              {rv.reviewers.map(r => reviewerLine(r))}
              {voterLine('standalone', rv.survivors, rv.run, 0, rv.status, 0)}
              {rv.status === 'FIXING'
                ? line('builder', builder?.endedAt === null ? 'running' : builder ? 'done' : 'waiting', 'Builder',
                  `fixes ✗${important}${builder ? ` · ${seconds(builder, clockNow)}` : ''}`)
                : null}
              {findingsTree(rv.id, rv.tree, rv.risk === 'HIGH', treeWidth)}
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
          {tasksFold}
        </Box>
      )
    }
    const known = prOf(t, await read($, pr))
    const rail = railFor(t, known)
    const n = t.now
    const spec = t.spec
    // The recorded change as the tree joins it: `rows` of it, against the plan's steps. Null without a list.
    const changeOf = (rows: ChangedFile[], rereview: string[]): TreeChange | null =>
      t.files ? { files: rows, hasPlan: t.planSteps > 0, ...stepProgress(t), rereview } : null
    // Plan: the planned files. Build, Review, and HALTED: the whole change, with the Build header until a round votes.
    const planChange = changeOf((t.files?.files ?? []).filter(f => f.steps.length > 0), [])
    const codeChange = changeOf(t.files?.files ?? [], t.rereview)
    const buildHeader = codeChange ? changeHeader('build', codeChange, t.planSteps) : undefined
    // The steps fold, from Review on, kept open or folded per task like the Files row.
    const stepsKey = `${t.slug}:steps`
    const isStepsOpen = folds[stepsKey] ?? false
    // A step selection reaches the tree only while pressable step rows are drawn above it: in Plan (from round 1)
    // and Build, or with the steps fold open, over a files.tsv, for this task and a step its plan still has.
    const isStepsDrawn = !t.isFast && t.steps.length > 0 && (t.status === 'PLANNING' || t.status === 'BUILDING' || (FOLDED_STEPS.includes(t.status) && isStepsOpen))
    const isTreeUnder = n.kind !== 'spec' && !((n.kind === 'plan' || n.kind === 'review') && n.round === 0)
    const selectedStep = isStepsDrawn && isTreeUnder && t.files !== null && selected?.slug === t.slug && t.steps.some(s => s.n === selected?.n) ? selected.n : null
    // A step is being built while a builder runs for the task, not for this session's standalone review (FIXING).
    const progress = stepProgress(t)
    const isBuilding = t.status === 'BUILDING' && crew.some(a => a.role === 'builder' && a.endedAt === null) && rv?.status !== 'FIXING'
    const beingBuilt = isBuilding ? buildingStep(t.steps, progress) : null
    // The file being edited, in Build and review, while it flashes and after; in Build not on a file whose steps
    // are all built and none being built (isEditShown).
    const shownEdit: TreeEdit | null = edit && edit.slug === t.slug && EDIT_STATUSES.includes(t.status) && codeChange && isEditShown(edit.path, codeChange, t.status === 'BUILDING', beingBuilt)
      ? { path: edit.path, isFlash: clockNow - edit.at < FLASH_MS }
      : null
    const codeTree = (view: FindingsView | null) => findingsTree(t.slug, view, t.risk === 'HIGH', treeWidth, codeChange, view ? undefined : buildHeader, selectedStep, shownEdit)
    // The footprint: the change's files, lines, and latest verdict, once the build has a base. Each item is its own
    // Text after a ` · `, so a wrapped line breaks only between items.
    const fp = t.files ? footprint(t.files, t.rounds, t.head, awaitingOf(t.codeView, t.rereview)) : null
    const fpItems = (key: string) => (fp?.parts ?? []).map((parts, i) => (
      <Text key={`${key}-${i}`}>{i > 0 ? <Text dimColor> · </Text> : null}{partsOf(`${key}-${i}`, parts)}</Text>
    ))
    // From Blind test on (HALTED aside), the tree folds to one Files row whose summary is the footprint; a press
    // opens the Review tree, and the choice is kept like a section's.
    const filesKey = `${t.slug}:files`
    const isFilesOpen = folds[filesKey] ?? false
    const filesRow = fp && t.stage >= STAGES.indexOf('Blind test') && t.status !== 'HALTED' ? (
      <Box key={`${filesKey}-row`} flexDirection="column">
        <Button
          key={filesKey}
          plain
          hover={{ color: 'claude' }}
          label={`Files, ${fp.words.join(', ')}, ${isFilesOpen ? 'open' : 'folded'}`}
          onPress={() => void update($, sections, all => ({ ...all, [filesKey]: !isFilesOpen }))}
        >
          <Text wrap="truncate-end">
            <Text dimColor>{isFilesOpen ? '▾ ' : '▸ '}</Text>
            <Text bold>Files</Text>
            <Text>  </Text>
            {fpItems('files')}
          </Text>
        </Button>
        {isFilesOpen ? codeTree(t.codeView) : null}
      </Box>
    ) : null
    // The code review's voter row. While round N+1 reviews with no vote yet, and round N's fix awaits re-review,
    // it keeps round N's verdict, labelled with its round.
    const roundVoter = (n: Extract<Now, { kind: 'plan' | 'review' }>) => {
      const of = n.of || t.maxRounds
      const awaiting = n.kind === 'review' ? awaitingOf(n.tree, t.rereview) : 0
      if (n.tree && n.tree.round === n.round) return voterLine(n.kind, n.survivors, n.round, of, t.status, n.tree.dropped, awaiting)
      const last = n.tree && awaiting > 0 ? t.rounds.find(r => r.n === n.tree?.round)?.findings ?? null : null
      if (n.tree && last && !n.survivors) return voterLine(n.kind, last, n.tree.round, of, t.status, n.tree.dropped, awaiting, `round ${n.tree.round}: `)
      return voterLine(n.kind, n.survivors, n.round, of, t.status, 0)
    }
    // The plan's steps, in Plan and Build; in Plan a step carries the plan review's open findings on its lines.
    const stepLines = (): StepLine[] => t.steps.map(s => ({
      n: s.n,
      title: s.title,
      requirements: s.requirements,
      mark: t.status === 'PLANNING' ? '○' : progress.allBuilt || progress.built.includes(s.n) ? '✓' : s.n === beingBuilt ? '●' : '○',
      files: t.files ? t.files.files.filter(f => f.steps.includes(s.n)).length : null,
      findings: t.status === 'PLANNING' && n.kind === 'plan' ? stepFindings(n.tree, `.tasks/${t.slug}/plan.md`, s, []) : null,
      isSelected: s.n === selectedStep,
    }))
    // A press on a step selects it, or clears it when it is already selected or names no file. A selection opens
    // a folded Files row (`filesKey`), stored as the person's own choice, so the lit files show.
    const pressStep = (step: number, files: number | null, filesKey?: string) => {
      selected = !files || step === selectedStep ? null : { slug: t.slug, n: step }
      if (selected && filesKey && folds[filesKey] !== true) void update($, sections, all => ({ ...all, [filesKey]: true }))
      $.ui.invalidate('ui.render')
    }
    // `isPressable`: a file tree is drawn under the rows, so each row is a Button and the hint says what a press
    // does; without one they are plain rows. From Review on, the list folds to one row.
    const stepsPart = (opts: { isPressable: boolean; filesKey?: string }) => {
      if (t.isFast || t.steps.length === 0) return null
      const isFolding = FOLDED_STEPS.includes(t.status)
      if (!isFolding && t.status !== 'PLANNING' && t.status !== 'BUILDING') return null
      const hint = opts.isPressable
        ? <Text dimColor wrap="truncate-end">{selectedStep === null ? 'press a step to highlight its files' : `step ${selectedStep}'s files are highlighted`}</Text>
        : null
      const lines = stepLines()
      const rows = stepRows(lines, treeWidth).map(row => {
        const key = `${t.slug}:step:${row.n}`
        const text = <Text wrap="truncate-end">{partsOf(key, row.parts)}</Text>
        if (!opts.isPressable) return <Box key={key}>{text}</Box>
        const files = lines.find(l => l.n === row.n)?.files ?? null
        return <Button key={key} plain hover={{ color: 'claude' }} label={row.label} onPress={() => pressStep(row.n, files, opts.filesKey)}>{text}</Button>
      })
      if (!isFolding) {
        return (
          <Box key={`${t.slug}:steps-list`} flexDirection="column">
            <Text bold>Plan steps</Text>
            {hint}
            {rows}
          </Box>
        )
      }
      const built = progress.allBuilt ? t.steps.length : t.steps.filter(s => progress.built.includes(s.n)).length
      const count = `${built} of ${t.steps.length} built`
      return (
        <Box key={`${t.slug}:steps-list`} flexDirection="column">
          <Button
            key={stepsKey}
            plain
            hover={{ color: 'claude' }}
            label={`Plan steps, ${built} of ${t.steps.length} steps built, ${isStepsOpen ? 'open' : 'folded'}`}
            onPress={() => void update($, sections, all => ({ ...all, [stepsKey]: !isStepsOpen }))}
          >
            <Text wrap="truncate-end">
              <Text dimColor>{isStepsOpen ? '▾ ' : '▸ '}</Text>
              <Text bold>Plan steps</Text>
              <Text>  </Text>
              <Text color={built === t.steps.length ? 'success' : undefined}>{count}</Text>
            </Text>
          </Button>
          {isStepsOpen ? hint : null}
          {isStepsOpen ? rows : null}
        </Box>
      )
    }
    const isPlanning = n.kind === 'plan' && t.status === 'PLANNING'
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
    const requirements = (spec?.requirements ?? []).map(r => ({ ...r, ...requirementState(r.n, t.checks, t.proof?.verdicts) }))
    const met = requirements.filter(r => r.state === 'pass').length

    // The Now card's border says whose move it is: amber when the task waits on the person, red when it's stuck.
    const nowColor = whoseMove(t.status)
    const next = nextFor(t, known)
    const command = nextCommand(next)


    const failedRequirements = requirements.filter(r => r.state === 'fail')
    const uncheckedRequirement = requirements.find(r => r.state === 'none')
    // With a proof, `M of N met`: red when a final proof's verdict leaves one unmet, amber while anything else is.
    const requirementsSummary: [string, string] = t.proof
      ? [`${met} of ${requirements.length} met`, met === requirements.length ? 'success' : failedRequirements.some(r => r.verdict) ? 'error' : 'warning']
      : isReported ? [`${requirements.length} reported passing`, 'subtle'] : [`${requirements.length} in rd.md`, 'inactive']
    // The first unmet requirement, beside the summary, or under the row when it doesn't fit within the pane.
    const columns = e.props.bodyColumns ?? 50
    const [firstFailed] = failedRequirements
    const requirementsLayout = firstFailed
      ? unmetNote(firstFailed, failedRequirements.length - 1, columns - 17 - cellWidth(requirementsSummary[0]) - 2, columns - 2)
      : undefined
    // The label reads the whole note: unmetNote with unlimited room keeps it beside, uncut.
    const requirementsNote = firstFailed ? unmetNote(firstFailed, failedRequirements.length - 1, Infinity, Infinity).beside
      : uncheckedRequirement ? `${uncheckedRequirement.n} has no check` : ''
    const unmet = unmetNow(t)
    const checksSummary: [string, string] = t.proof
      ? [`${passed}/${t.checks.length} pass`, passed === t.checks.length ? 'success' : 'error']
      : t.expectedProof ? ['no proof saved', 'warning']
        : isReported ? [`${t.checks.length} reported passing`, 'subtle'] : [`${taskChecks} not run yet`, 'inactive']
    const checksNote = t.isProofStale ? 'proof older than HEAD'
      : !t.proof && t.expectedProof ? `${t.expectedProof} missing`
        : t.stopBlocks > 0 && isHookActive(t.status) ? `Stop hook blocked ${plural(t.stopBlocks, 'time')}`
          : t.pending > 0 ? `${plural(t.pending, 'finding')} pending`
            : (t.checks.find(c => c.result === 'FAIL') ? `✗ ${t.checks.find(c => c.result === 'FAIL')?.id} ${t.checks.find(c => c.result === 'FAIL')?.label}` : '')
    // Review rounds: the plan rounds, then the code rounds, each group left out when it has none.
    const roundGroups = ([['plan', t.planReviewRounds], ['code', t.rounds]] as const).filter(([, rs]) => rs.length > 0)
    const lastRound = roundGroups.at(-1)?.[1].at(-1)
    const roundsSummary = roundGroups.map(([g, rs]) => `${g} ${rs.map(roundText).join(' · ')}`).join('  ')
    const roundsName = `Review rounds, ${roundGroups.map(([g, rs]) => `${g} ${rs.map(roundWords).join(', ')}`).join('; ')}`
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
              // From CONVERGED on, a requirement a current proof leaves unmet turns Review's tick into a `!`.
              const [glyph, color] = s.name === 'Review' && unmet.length > 0 ? ['!', 'warning'] : GLYPH[s.state]
              const sliced = t.planSteps >= SLICE_AT && !t.isFast && s.state === 'active'
              const label = s.name === 'Review' && t.round > 0 ? `${s.name} ${t.round}/${t.maxRounds}`
                : s.name === 'Build' && sliced ? `${s.name} ${t.builtSteps}/${t.planSteps}` : s.name
              return (
                <Text key={s.name} color={color} bold={s.state === 'active' || s.state === 'stuck'} dimColor={s.state === 'todo' || s.state === 'skipped'}>
                  {i > 0 ? <Text dimColor> ─ </Text> : null}{glyph}{label}
                </Text>
              )
            })}
          </Text>
          {stageDetails(t, known) ? <Text dimColor wrap="truncate-end">{stageDetails(t, known)}</Text> : null}
          {fp ? <Box key="footprint" flexDirection="row" flexWrap="wrap">{fpItems('footprint')}</Box> : null}
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
            {unmet.length > 0 ? <Text color="warning"> · {unmetWords(unmet).short}</Text> : null}
          </Text>
          {/* Before the first round, and in Plan throughout, the steps sit under the title, so the reviewer and voter
              rows run straight into the tree's header. */}
          {(n.kind === 'plan' || n.kind === 'review') && (n.round === 0 || isPlanning) && stepsPart({ isPressable: n.round > 0 && t.files !== null })}
          {n.kind === 'spec' && <Text dimColor>{plural(n.requirements, 'requirement')} in rd.md · {plural(taskChecks, 'check')} in eval.md</Text>}
          {n.kind === 'spec' && n.reviewers.map(r => reviewerLine(r))}
          {(n.kind === 'plan' || n.kind === 'review') && n.round > 0 && (
            <Box flexDirection="column">
              <Text dimColor>{reviewerProgress(n)} replied</Text>
              {/* During round N's fix, a reviewer whose IMPORTANT finding is now awaiting re-review says so; once
                  round N+1 starts, the rows are its own. */}
              {n.reviewers.map(r => reviewerLine(r, n.tree?.round === n.round ? n.rereviewBy[r.role] ?? 0 : 0))}
              {/* While round N+1 reviews, the tree shows round N, whose drops aren't this round's. */}
              {roundVoter(n)}
              {isPlanning ? null : stepsPart({ isPressable: t.files !== null, filesKey: n.kind === 'review' && filesRow ? filesKey : undefined })}
              {n.kind === 'plan'
                ? findingsTree(t.slug, n.tree, t.risk === 'HIGH', treeWidth, planChange, planChange ? changeHeader('plan', planChange, t.planSteps) : undefined, selectedStep)
                : filesRow ?? codeTree(n.tree)}
            </Box>
          )}
          {n.kind === 'build' && (
            <Box flexDirection="column">
              {(['builder', 'prover'] as const).map(role => {
                const agent = crew.findLast(a => a.role === role)
                const label = role === 'builder' ? 'Builder' : 'Prover'
                if (!agent) return line(role, 'waiting', label, role === 'builder' ? 'implements plan.md' : 'runs checks, not final-only')
                return line(role, agent.endedAt === null ? 'running' : 'done', label, `${agent.endedAt === null ? 'running' : 'took'} ${seconds(agent, clockNow)}`)
              })}
              {stepsPart({ isPressable: t.files !== null })}
              {codeTree(null)}
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
              {/* HALTED after a blind run: the Review tree, unfolded, under the blind test's rows. */}
              {stepsPart({ isPressable: t.files !== null, filesKey: t.status !== 'HALTED' && filesRow ? filesKey : undefined })}
              {t.status === 'HALTED' && codeChange ? codeTree(t.codeView) : filesRow}
            </Box>
          )}
          {n.kind === 'done' && !(known && known.number > 0) && (
            <Text dimColor>{t.prDrafted ? 'Every stage is done; pr.md is drafted.' : 'Every stage is done.'}</Text>
          )}
          {n.kind === 'done' && stepsPart({ isPressable: t.files !== null, filesKey })}
          {n.kind === 'done' ? filesRow : null}
          <Box flexDirection="row" gap={1} marginTop={1}>
            {command
              ? <Button key="next" variant="primary" label={`▶ Next: ${command}`} onPress={() => void fillPrompt($, command)} />
              : <Text><Text dimColor>Next: </Text><Text>{next}</Text></Text>}
            {command ? <Text dimColor wrap="truncate-end">{next === command ? 'fills the prompt' : next}</Text> : null}
          </Box>
        </Box>

        {reviewCard}

        <Box flexDirection="column" gap={1}>
          {requirements.length > 0 && fold('requirements', 'Requirements', requirementsSummary, requirementsNote,
            () => [
              isReported ? <Text key="reported" dimColor>From the round log, not a saved proof</Text> : null,
              ...requirements.map(r => {
                const [glyph, color] = isReported && r.state === 'open' ? REPORTED : REQUIREMENT_GLYPH[r.state]
                return (
                  <Text key={`req-${r.n}`} wrap="truncate-end">
                    <Text color={color}>{glyph} </Text>
                    <Text dimColor>{r.n}  </Text>
                    <Text>{r.title}</Text>
                    {r.verdict && r.verdict.verdict !== 'MET' ? <Text color="error">  {r.verdict.verdict}</Text> : null}
                    {r.verdict?.evidence ? <Text dimColor>  {r.verdict.evidence}</Text> : null}
                    {r.state === 'none' ? <Text color="warning">  no check in eval.md</Text> : null}
                  </Text>
                )
              }),
              ...(spec && spec.nonGoals.length > 0 ? [
                <Text key="non-head" dimColor bold>Not in scope</Text>,
                ...spec.nonGoals.slice(0, 4).map((g, i) => <Text key={`non-${i}`} dimColor wrap="truncate-end">- {g}</Text>),
                spec.nonGoals.length > 4 ? <Text key="non-more" dimColor>and {spec.nonGoals.length - 4} more in rd.md</Text> : null,
              ] : []),
            ], t.proof ? `Requirements, ${requirementsSummary[0]}` : undefined, requirementsLayout)}

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

          {roundGroups.length > 0 && fold('rounds', 'Review rounds',
            [roundsSummary, lastRound?.findings && lastRound.findings.important > 0 ? 'error' : 'text'],
            t.status === 'HALTED' ? 'HALTED: see the post-mortem' : '',
            () => roundGroups.flatMap(([g, rs]) => rs.map(r => (
              <Text key={`${g === 'plan' ? 'plan-' : ''}round-${r.n}`} wrap="truncate-end">
                <Text dimColor>{g} r{r.n}  </Text>
                {r.findings === null
                  ? <Text dimColor>{r.candidates === null ? 'reviewing…' : `${r.candidates} candidates, voting…`}</Text>
                  : marks(r.findings, 'clean')}
                {r.findings !== null && r.candidates !== null
                  ? <Text dimColor>  (voter kept {r.findings.important + r.findings.nit + r.findings.preExisting} of {r.candidates})</Text>
                  : null}
              </Text>
            ))),
            roundsName)}

          {reviewsFold}

          {tasksFold}

          {spend.agents > 0 && fold('spend', 'Spend',
            [`${plural(spend.agents, 'agent')} · ${tokenCount(spend.tokensIn)} in · ${tokenCount(spend.tokensOut)} out`, 'text'],
            mismatches.length > 0 ? 'model mismatch' : '',
            () => [
              <Text key="since" dimColor>Since the last command; {tokenCount(spend.tokensCached)} of the input was cached</Text>,
              <Text key="models" dimColor wrap="truncate-end">{spend.models.map(([m, k]) => `${m} ×${k}`).join(' · ')}</Text>,
              <Text key="chosen" dimColor wrap="truncate-end">
                Chosen: reviewers {choiceLabel(t.reviewerModel)} · helpers {choiceLabel(t.helperModel)}
              </Text>,
              ...mismatches.map((m, i) => <Text key={`mismatch-${i}`} color="warning" wrap="truncate-end">⚠ {m}</Text>),
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

