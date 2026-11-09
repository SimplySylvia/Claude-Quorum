// The dashboard's type contract: the values hooks/dashboard/register.tsx keeps in $.state.

export type Frontmatter = Record<string, string | string[]>

export type Findings = { important: number; nit: number; preExisting: number }

export type Stage = { name: string; state: 'done' | 'active' | 'waiting' | 'stuck' | 'todo' | 'skipped' }

export type Round = { n: number; findings: Findings | null; candidates: number | null }

export type Snapshot = {
  slug: string
  risk: string
  status: string
  stage: number
  round: number
  maxRounds: number
  planRounds: number
  planApproved: string
  signoff: string
  blindRuns: number
  stopBlocks: number
  pending: number
  rounds: Round[]
  next: string
}

export type QuorumAgent = {
  id: string
  type: string
  description: string
  startedAt: number
  endedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    quorum: {
      task: Shaped<Snapshot | null>
      agents: Shaped<QuorumAgent[]>
    }
  }
}
