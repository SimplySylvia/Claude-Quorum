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

// One numbered requirement of rd.md, by its short name.
export type Requirement = { n: string; title: string }

// What rd.md says the task is.
export type Spec = { title: string; goal: string; isUi: boolean; requirements: Requirement[]; nonGoals: string[] }

// What the "Now" section shows for the current stage.
export type Now =
  | { kind: 'spec'; requirements: number; reviewers: Reviewer[] }
  | { kind: 'plan' | 'review'; round: number; of: number; reviewers: Reviewer[]; voter: Reviewer; survivors: Findings | null }
  | { kind: 'build' }
  | { kind: 'blind'; blind: Blind }
  | { kind: 'done' }

export type Snapshot = {
  slug: string
  branch: string
  // pr.md exists: /quorum:pr-draft has run.
  prDrafted: boolean
  // state.md's `pr`: the PR's URL once recorded, else ''.
  prUrl: string
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
  spec: Spec | null
  checks: Check[]
  proof: Proof | null
  // HEAD's commit, '' when it can't be read, and whether the proof ran at an older one.
  head: string
  isProofStale: boolean
  // The proof the skills should have saved by now ('' while none is due), and the round log's line about the checks.
  expectedProof: string
  checksNote: string
}

// The task branch's pull request on GitHub, as `gh pr list` last reported it. NONE: no PR yet; UNKNOWN: gh is
// missing, signed out, or failed.
export type PullRequest = {
  slug: string
  number: number
  state: 'OPEN' | 'MERGED' | 'CLOSED' | 'NONE' | 'UNKNOWN'
  isDraft: boolean
  url: string
  checkedAt: number
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
      pr: Shaped<PullRequest | null>
      now: number
    }
  }
}
