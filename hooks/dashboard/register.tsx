// Quorum's dashboard: a status line, a stage rail above the prompt, and a pane with the active task's stages,
// review rounds and running agents. It only reads .tasks/; the skills and bin/ scripts stay the source of truth.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { QuorumAgent, Round, Snapshot, Stage } from '../../types'
import {
  STAGES, count, countFindings, isStuck, list, nextStep, parseFrontmatter, scalar, slugFromHead, stageOf, stages,
} from './task'

const PANE = 'quorum-dashboard'
const COMMAND = 'quorum-dashboard'
// Change a tag when its value's fields change: it declines what an earlier version stored.
const task = atom({ plugin: 'quorum', key: 'task' } as const, null, { shape: 'task-1' })
const agents = atom({ plugin: 'quorum', key: 'agents' } as const, [], { shape: 'agents-1' })

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

const STATUS_COLOR = (status: string) =>
  isStuck(status) ? 'error' : status === 'READY' || status === 'AWAITING-HUMAN' ? 'warning' : 'claude'

const readOr = ($: EngineInterface, path: string) => $.fs.read(path).catch(() => null)

// The slug bin/quorum-active-task would print: a feat/ or fix/ branch with a task folder, then .tasks/.active.
async function activeSlug($: EngineInterface): Promise<string> {
  let head = await readOr($, '.git/HEAD')
  if (head === null) {
    // A worktree: .git is a file naming the real git dir.
    const gitdir = /^gitdir:\s*(.+)$/m.exec((await readOr($, '.git')) ?? '')?.[1]?.trim()
    head = gitdir ? await readOr($, `${gitdir}/HEAD`) : null
  }
  const fromBranch = slugFromHead(head ?? '')
  if (fromBranch && (await $.fs.exists(`.tasks/${fromBranch}/state.md`))) return fromBranch
  const active = ((await readOr($, '.tasks/.active')) ?? '').split('\n')[0]?.trim() ?? ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(active) ? active : ''
}

async function snapshot($: EngineInterface, maxRounds: number, previous: Snapshot | null): Promise<Snapshot | null> {
  const slug = await activeSlug($)
  if (!slug) return null
  const text = await readOr($, `.tasks/${slug}/state.md`)
  if (text === null) return null
  const fm = parseFrontmatter(text)
  const status = scalar(fm, 'status')
  const risk = scalar(fm, 'risk')
  const round = count(fm, 'round')

  const rounds: Round[] = []
  for (let n = 1; n <= round; n++) {
    const dir = `.tasks/${slug}/review/round-${n}`
    const survivors = await readOr($, `${dir}/survivors.md`)
    const candidates = await readOr($, `${dir}/candidates.md`)
    rounds.push({
      n,
      findings: survivors === null ? null : countFindings(survivors),
      candidates: candidates === null ? null : (({ important, nit, preExisting }) => important + nit + preExisting)(countFindings(candidates)),
    })
  }

  return {
    slug,
    risk,
    status,
    // ESCALATED records the status it interrupted; HALTED comes from the review loop, or from blind test after 2 runs.
    stage: status === 'ESCALATED' && scalar(fm, 'escalated_from')
      ? stageOf(scalar(fm, 'escalated_from'), undefined)
      : status === 'HALTED' && count(fm, 'blind_runs') > 0
        ? STAGES.indexOf('Blind test')
        : stageOf(status, previous?.slug === slug ? previous.stage : undefined),
    round,
    maxRounds,
    planRounds: count(fm, 'plan_rounds'),
    planApproved: scalar(fm, 'plan_approved'),
    signoff: scalar(fm, 'signoff'),
    blindRuns: count(fm, 'blind_runs'),
    stopBlocks: count(fm, 'stop_blocks'),
    pending: list(fm, 'pending_findings').length,
    rounds,
    next: nextStep(status, risk),
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

function open($: EngineInterface, focus?: true) {
  return $.ui.open({ id: PANE, title: 'Quorum', ...(focus ? { focus } : {}) })
}

export const register: Register = (on, options) => {
  const maxRounds = Number(options.max_rounds ?? 3) || 3

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: "Show or hide the Quorum task dashboard" })
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

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny === undefined && spawned.agentId && e.subagentType.startsWith('quorum:')) {
      const agent: QuorumAgent = {
        id: spawned.agentId,
        type: e.subagentType.slice('quorum:'.length),
        description: e.description,
        startedAt: await $.clock.now(),
        endedAt: null,
      }
      await update($, agents, all => [...all, agent].slice(-30))
    }
    return spawned
   }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      const id = e.agentId
      const now = await $.clock.now()
      await update($, agents, all => all.map(a => (a.id === id && a.endedAt === null ? { ...a, endedAt: now } : a)))
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
    const now = await $.clock.now()
    const rail = stages(t.status, t.risk, t.stage)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{t.slug}</Text>
          <Text>
            <Text color={STATUS_COLOR(t.status)} bold>{t.status || 'no status'}</Text>
            <Text dimColor> · {t.risk || 'no risk tier'} risk</Text>
          </Text>
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

        {crew.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Agents</Text>
            {crew.slice(-10).map(a => (
              <Text key={a.id}>
                <Text color={a.endedAt === null ? 'claude' : 'success'}>{a.endedAt === null ? '●' : '✓'} </Text>
                <Text>{a.type}</Text>
                <Text dimColor>  {a.description} · {seconds(a, now)}</Text>
              </Text>
            ))}
          </Box>
        )}

        {(t.stopBlocks > 0 || t.pending > 0) && (
          <Box flexDirection="column">
            <Text bold>Checks</Text>
            {t.stopBlocks > 0 && <Text color="warning">Stop hook blocked {t.stopBlocks} time{t.stopBlocks === 1 ? '' : 's'} in a row</Text>}
            {t.pending > 0 && <Text color="warning">{t.pending} finding{t.pending === 1 ? '' : 's'} pending for the builder</Text>}
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

