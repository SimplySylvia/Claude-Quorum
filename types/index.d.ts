// The dashboard's type contract: the values hooks/dashboard/register.tsx keeps in $.state.

export type Frontmatter = Record<string, string | string[]>

export type Findings = { important: number; nit: number; preExisting: number }

export type Stage = { name: string; state: 'done' | 'active' | 'waiting' | 'stuck' | 'todo' | 'skipped' }

export type Round = { n: number; findings: Findings | null; candidates: number | null }

// One reviewer of the current round: `findings` is null until its reply is saved.
export type Reviewer = { role: string; findings: Findings | null }

// The prover's latest report (proof-final.md, else proof-build.md).
export type Proof = { file: string; rev: string; result: string; rows: { id: string; check: string; result: string }[] }

// One eval.md row (or the fast checks) and its result in the latest proof; null when not run yet.
export type Check = { id: string; label: string; result: 'PASS' | 'FAIL' | 'SKIPPED' | null }

// The current blind-test run's reports; a count is null when that report wasn't written.
export type Blind = {
  run: number
  result: string
  blockers: number
  friction: number
  a11y: number | null
  security: number | null
  caused: number | null
}

// What the "Now" section shows for the current stage.
export type Now =
  | { kind: 'spec'; requirements: number; reviewers: Reviewer[] }
  | { kind: 'plan' | 'review'; round: number; of: number; reviewers: Reviewer[]; voter: Reviewer; survivors: Findings | null }
  | { kind: 'build' }
  | { kind: 'blind'; blind: Blind }
  | { kind: 'done' }

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
  now: Now
  checks: Check[]
  proof: Proof | null
  // The proof the skills should have saved by now ('' while none is due), and the round log's line about the checks.
  expectedProof: string
  checksNote: string
}

export type QuorumAgent = {
  id: string
  type: string
  role: string
  description: string
  startedAt: number
  endedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    quorum: {
      task: Shaped<Snapshot | null>
      agents: Shaped<QuorumAgent[]>
      now: number
    }
  }
}
