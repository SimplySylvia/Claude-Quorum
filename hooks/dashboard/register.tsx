// Quorum's dashboard: a status line, a stage rail above the prompt, and a pane with what the current stage is doing
// (each reviewer of the round, the blind test's reports), how the task's checks stand, its stages, review rounds and
// running agents. It only reads .tasks/; the skills and bin/ scripts stay the source of truth.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Check, Findings, Now, QuorumAgent, Reviewer, Round, Snapshot, Stage } from '../../types'
import {
  ROLE_LABEL, STAGES, checksNoteFromLog, count, countFindings, countRequirements, evalRows, expectedProof, isHookActive, isStuck, joinChecks, parseSpec, requirementState, list, nextStep, parseBlind,
  parseFrontmatter, parseProof, reviewer, roleOf, roundReviewers, scalar, slugFromHead, stageOf, stages,
} from './task'

const PANE = 'quorum-dashboard'
const COMMAND = 'quorum-dashboard'
// Change a tag when its value's fields change: it declines what an earlier version stored.
const task = atom({ plugin: 'quorum', key: 'task' } as const, null, { shape: 'task-4' })
const agents = atom({ plugin: 'quorum', key: 'agents' } as const, [], { shape: 'agents-2' })
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

const CHECK_GLYPH: Record<string, [string, string]> = { PASS: ['✓', 'success'], FAIL: ['✗', 'error'], SKIPPED: ['–', 'warning'] }

const REVIEW_FILES = ['logic.md', 'architecture.md', 'patterns.md', 'docs.md', 'tests.md', 'a11y.md', 'security.md', 'votes.md', 'survivors.md']

const STATUS_COLOR = (status: string) =>
  isStuck(status) ? 'error' : status === 'READY' || status === 'AWAITING-HUMAN' ? 'warning' : 'claude'

const readOr = ($: EngineInterface, path: string) => $.fs.read(path).catch(() => null)

// The slug bin/quorum-active-task would print: a feat/ or fix/ branch with a task folder, then .tasks/.active.
// `root` is the session's project root, the CLAUDE_PROJECT_DIR that script resolves against.
async function activeSlug($: EngineInterface, root: string): Promise<string> {
  let head = await readOr($, `${root}/.git/HEAD`)
  if (head === null) {
    // A worktree: .git is a file naming the real git dir, absolute or relative to the worktree.
    const gitdir = /^gitdir:\s*(.+)$/m.exec((await readOr($, `${root}/.git`)) ?? '')?.[1]?.trim()
    head = gitdir ? await readOr($, gitdir.startsWith('/') ? `${gitdir}/HEAD` : `${root}/${gitdir}/HEAD`) : null
  }
  const fromBranch = slugFromHead(head ?? '')
  if (fromBranch && (await $.fs.exists(`${root}/.tasks/${fromBranch}/state.md`))) return fromBranch
  const active = ((await readOr($, `${root}/.tasks/.active`)) ?? '').split('\n')[0]?.trim() ?? ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(active) ? active : ''
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
  const slug = await activeSlug($, root)
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
    expectedProof: expectedProof(status, stage),
    checksNote: proof ? '' : checksNoteFromLog(text),
  }
}

function statusLine(t: Snapshot | null): string | undefined {
  if (!t) return undefined
  const parts = [`Quorum · ${t.slug}`, t.status || 'no status', t.risk]
  if (t.round > 0) parts.push(`round ${t.round}/${t.maxRounds}`)
  if (t.pending > 0) parts.push(`${t.pending} pending`)
  return parts.filter(Boolean).join(' · ')
}

function stageDetail(t: Snapshot, name: string): string {
  switch (name) {
    case 'Spec': return t.signoff ? `mockup signed off ${t.signoff}` : ''
    case 'Plan':
      return [t.planRounds ? `${t.planRounds} review round${t.planRounds === 1 ? '' : 's'}` : '',
        t.planApproved ? `approved ${t.planApproved}` : ''].filter(Boolean).join(', ')
    case 'Review': return t.round ? `round ${t.round} of ${t.maxRounds}` : ''
    case 'Blind test': return t.risk === 'LOW' ? 'not run for LOW' : t.blindRuns ? `${t.blindRuns} run${t.blindRuns === 1 ? '' : 's'}` : ''
    default: return ''
  }
}

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

const seconds = (a: QuorumAgent, now: number) => `${Math.max(0, Math.round(((a.endedAt ?? now) - a.startedAt) / 1000))}s`

// Re-read the task, redraw, set the status line, and toast a status change worth interrupting for.
async function refresh($: EngineInterface, maxRounds: number): Promise<Snapshot | null> {
  const before = await read($, task)
  const after = await snapshot($, maxRounds, before)
  await update($, task, () => after)
  $.ui.status(statusLine(after))
  const message = after && TOASTS[after.status]
  if (message && before?.slug === after.slug && before.status !== after.status) {
    $.ui.toast(`Quorum · ${after.slug}: ${message}`)
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
    if (await refresh($, maxRounds)) void open($)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Quorum dashboard closed.' }
    }
    const t = await refresh($, maxRounds)
    await open($)
    return { text: t ? `Quorum dashboard opened for ${t.slug}.` : 'Quorum dashboard opened. No active task yet.' }
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
    if (/quorum-(state|active-task|branch)|\.tasks\//.test(e.command)) await refresh($, maxRounds)
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
        startedAt: await $.clock.now(),
        endedAt: null,
      }
      keepTicking($, await update($, agents, all => [...all, agent].slice(-30)))
    }
    return spawned
  }).catch(($, e, next) => next(e))

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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const t = await read($, task)
    if (!t || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const rail = stages(t.status, t.risk, t.stage)
    const wide = (e.props.bodyColumns ?? 120) >= 110

    return (
      <Box flexDirection="row" gap={1}>
        <Text bold>Quorum</Text>
        <Text dimColor>{t.slug}</Text>
        <Text>
          {rail.map((s, i) => {
            const [glyph, color] = GLYPH[s.state]
            const label = s.name === 'Review' && t.round > 0 ? `${s.name} r${t.round}/${t.maxRounds}` : s.name
            return (
              <Text key={s.name} color={color} bold={s.state === 'active' || s.state === 'stuck'}>
                {i > 0 ? ' › ' : ''}{glyph} {label}
              </Text>
            )
          })}
        </Text>
        {[reviewerProgress(t.now), checkProgress(t.checks, t.proof !== null)].filter(Boolean).map(p => (
          <Text key={p} dimColor>{p}</Text>
        ))}
        {wide && <Text dimColor>next: {t.next}</Text>}
        <Button key="open" label="Dashboard" onPress={() => open($, true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, task)
    if (!t) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No active Quorum task.</Text>
          <Text dimColor>Start one with /quorum:spec-and-eval.</Text>
        </Box>
      )
    }
    const crew = await read($, agents)
    await read($, clock) // redraw on each tick
    const clockNow = await $.clock.now()
    const rail = stages(t.status, t.risk, t.stage)
    const n = t.now

    // One line per reviewer or report: ● running, ✓ or ✗ done, ○ waiting.
    const line = (key: string, state: 'running' | 'done' | 'waiting', label: string, detail: string, isBad = false) => (
      <Text key={key}>
        <Text color={state === 'running' ? 'claude' : state === 'waiting' ? 'inactive' : isBad ? 'error' : 'success'}>
          {state === 'running' ? '●' : state === 'waiting' ? '○' : isBad ? '✗' : '✓'}{' '}
        </Text>
        <Text dimColor={state === 'waiting'}>{label}</Text>
        {detail ? <Text dimColor>  {detail}</Text> : null}
      </Text>
    )
    const runningAs = (role: string) => crew.findLast(a => a.role === role && a.endedAt === null)
    const reviewerLine = (r: Reviewer) => {
      const agent = runningAs(r.role)
      const label = ROLE_LABEL[r.role] ?? r.role
      if (r.findings) return line(r.role, 'done', label, r.role === 'voter' ? `kept ${findingsText(r.findings)}` : findingsText(r.findings), r.findings.important > 0)
      if (agent) return line(r.role, 'running', label, `running ${seconds(agent, clockNow)}`)
      return line(r.role, 'waiting', label, 'waiting')
    }
    // A report that only some runs write: shown once it exists or its agent runs.
    const reportLine = (role: string, important: number | null, detail: (k: number) => string) => {
      const agent = runningAs(role)
      if (important !== null) return line(role, 'done', ROLE_LABEL[role] ?? role, detail(important), important > 0)
      return agent ? line(role, 'running', ROLE_LABEL[role] ?? role, `running ${seconds(agent, clockNow)}`) : null
    }

    const shown = new Set<string>(
      n.kind === 'plan' || n.kind === 'review' ? [...n.reviewers.map(r => r.role), 'voter']
        : n.kind === 'spec' ? n.reviewers.map(r => r.role)
          : n.kind === 'build' ? ['builder', 'prover']
            : n.kind === 'blind' ? ['blind', 'a11y', 'security', 'triage'] : [],
    )
    const others = crew.filter(a => !shown.has(a.role)).slice(-6)
    const taskChecks = t.checks.filter(c => c.id !== 'fast').length
    const passed = t.checks.filter(c => c.result === 'PASS').length
    const spec = t.spec
    const requirements = (spec?.requirements ?? []).map(r => ({ ...r, ...requirementState(r.n, t.checks) }))
    const met = requirements.filter(r => r.state === 'pass').length

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{spec?.title || t.slug}</Text>
          {spec?.title ? <Text dimColor>{t.slug}</Text> : null}
          <Text>
            <Text color={STATUS_COLOR(t.status)} bold>{t.status || 'no status'}</Text>
            <Text dimColor> · {t.risk || 'no risk tier'} risk{spec?.isUi ? ' · UI change' : ''}</Text>
          </Text>
        </Box>

        {spec?.goal ? (
          <Box flexDirection="column">
            <Text bold>Goal</Text>
            <Text>{spec.goal}</Text>
          </Box>
        ) : null}

        <Box flexDirection="column">
          <Text>
            <Text bold>Now · </Text>
            <Text bold color="claude">{nowTitle(n, t.maxRounds)}</Text>
          </Text>
          {n.kind === 'spec' && <Text dimColor>{plural(n.requirements, 'requirement')} in rd.md · {plural(taskChecks, 'check')} in eval.md</Text>}
          {n.kind === 'spec' && n.reviewers.map(reviewerLine)}
          {(n.kind === 'plan' || n.kind === 'review') && n.round > 0 && (
            <Box flexDirection="column">
              <Text dimColor>{reviewerProgress(n)} replied</Text>
              {n.reviewers.map(reviewerLine)}
              {reviewerLine(n.voter)}
              {(() => {
                const v = verdict(n)
                return v ? <Text color={v[1]}>{v[0]}</Text> : null
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
          {n.kind === 'done' && <Text dimColor>Every stage is done.</Text>}
        </Box>

        {requirements.length > 0 && (
          <Box flexDirection="column">
            <Text>
              <Text bold>Requirements · </Text>
              {t.proof
                ? <Text color={met === requirements.length ? 'success' : 'warning'}>{met} of {requirements.length} met</Text>
                : <Text dimColor>{requirements.length} in rd.md</Text>}
            </Text>
            {requirements.map(r => {
              const [glyph, color] = REQUIREMENT_GLYPH[r.state]
              return (
                <Text key={`req-${r.n}`} wrap="truncate-end">
                  <Text color={color}>{glyph} </Text>
                  <Text dimColor>{r.n}  </Text>
                  <Text>{r.title}</Text>
                  {r.state === 'none' ? <Text dimColor>  no check in eval.md</Text> : null}
                </Text>
              )
            })}
          </Box>
        )}

        {spec && spec.nonGoals.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Not in scope</Text>
            {spec.nonGoals.slice(0, 4).map((g, i) => <Text key={`non-${i}`} dimColor wrap="truncate-end">- {g}</Text>)}
            {spec.nonGoals.length > 4 ? <Text dimColor>and {spec.nonGoals.length - 4} more in rd.md</Text> : null}
          </Box>
        )}

        <Box flexDirection="column">
          <Text>
            <Text bold>Checks · </Text>
            {t.proof
              ? <Text color={passed === t.checks.length ? 'success' : 'error'}>{passed} of {t.checks.length} pass</Text>
              : t.expectedProof
                ? <Text color="warning">{plural(taskChecks, 'check')} in eval.md, no proof saved</Text>
                : <Text dimColor>{plural(taskChecks, 'check')} in eval.md, not run yet</Text>}
          </Text>
          {t.proof && <Text dimColor>{t.proof.file}{t.proof.rev ? ` at ${t.proof.rev}` : ''}</Text>}
          {!t.proof && t.expectedProof && (
            <Text color="warning">
              {t.expectedProof} is missing{t.expectedProof === 'proof-final.md' ? ', so /quorum:pr-draft will stop' : ''}
            </Text>
          )}
          {!t.proof && t.expectedProof && t.checksNote && <Text dimColor>Round log: {t.checksNote}</Text>}
          {t.checks.map(c => {
            const [glyph, color] = c.result ? CHECK_GLYPH[c.result] ?? ['○', 'inactive'] : ['○', 'inactive']
            return (
              <Text key={`check-${c.id}`} wrap="truncate-end">
                <Text color={color}>{glyph} </Text>
                <Text dimColor>{c.id}  </Text>
                <Text dimColor={c.result === null}>{c.label}</Text>
              </Text>
            )
          })}
          {t.stopBlocks > 0 && isHookActive(t.status) && <Text color="warning">Stop hook blocked {plural(t.stopBlocks, 'time')} in a row</Text>}
          {t.pending > 0 && <Text color="warning">{plural(t.pending, 'finding')} pending for the builder</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold>Stages</Text>
          {rail.map(s => {
            const [glyph, color] = GLYPH[s.state]
            const detail = stageDetail(t, s.name)
            return (
              <Text key={s.name}>
                <Text color={color}>{glyph} </Text>
                <Text bold={s.state === 'active' || s.state === 'stuck'} dimColor={s.state === 'todo' || s.state === 'skipped'}>{s.name}</Text>
                {detail ? <Text dimColor>  {detail}</Text> : null}
              </Text>
            )
          })}
        </Box>

        {t.rounds.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Review rounds</Text>
            {t.rounds.map(r => (
              <Text key={`round-${r.n}`}>
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
            ))}
          </Box>
        )}

        {others.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Other agents</Text>
            {others.map(a => (
              <Text key={a.id}>
                <Text color={a.endedAt === null ? 'claude' : 'success'}>{a.endedAt === null ? '●' : '✓'} </Text>
                <Text>{a.type}</Text>
                <Text dimColor>  {a.description} · {seconds(a, clockNow)}</Text>
              </Text>
            ))}
          </Box>
        )}

        <Text>
          <Text dimColor>Next: </Text>
          <Text>{t.next}</Text>
        </Text>
      </Box>
    )
  })
}

