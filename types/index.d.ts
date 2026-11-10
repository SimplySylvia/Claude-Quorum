// The dashboard's type contract: the values hooks/dashboard/register.tsx keeps in $.state.

export type Frontmatter = Record<string, string | string[]>

export type Findings = { important: number; nit: number; preExisting: number }

export type Stage = { name: string; state: 'done' | 'active' | 'waiting' | 'stuck' | 'todo' | 'skipped' }

export type Round = { n: number; findings: Findings | null; candidates: number | null }

// One finding the voter kept: its tag, `file:line`, Pattern Category (or the rest of its line), and confidence.
export type KeptFinding = { tag: 'IMPORTANT' | 'NIT' | 'PRE-EXISTING'; loc: string; title: string; confidence: number | null }

// The pane's foldable sections. Each opens by itself while it holds a problem; a click overrides that.
export type Section = 'requirements' | 'checks' | 'rounds' | 'reviews' | 'spend' | 'agents'

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
  | { kind: 'plan' | 'review'; round: number; of: number; reviewers: Reviewer[]; voter: Reviewer; survivors: Findings | null; kept: KeptFinding[] }
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

// A standalone review (/quorum:review), from .tasks/review-<id>/: its latest run's reviewers, voter, and kept
// findings, as for a task's review round. The one this session is running gets the live card; the rest are history.
export type Review = {
  id: string
  status: string
  risk: string
  // Whether this session runs it (state.md's `session` is this session's id), and when its state.md last changed.
  isOurs: boolean
  changedAt: number
  // The range it reviews, in short SHAs.
  range: string
  run: number
  reviewers: Reviewer[]
  voter: Reviewer
  survivors: Findings | null
  kept: KeptFinding[]
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
  // The model it runs on, as the engine resolved it.
  model: string
  startedAt: number
  endedAt: number | null
  // Tokens its requests used so far: input (cache reads and writes included), the part the cache served, output.
  tokensIn: number
  tokensCached: number
  tokensOut: number
}

// What the agents since the last /quorum:* command used, and how many ran on each model.
export type Spend = { agents: number; tokensIn: number; tokensCached: number; tokensOut: number; models: [string, number][] }

declare module 'claude-code' {
  interface PluginState {
    quorum: {
      task: Shaped<Snapshot | null>
      agents: Shaped<QuorumAgent[]>
      pr: Shaped<PullRequest | null>
      // The newest reviews first, a few at most.
      reviews: Shaped<Review[]>
      now: number
      // Sections the person opened or closed, by `<slug>:<section>`; absent, the section's default.
      sections: Shaped<Record<string, boolean>>
    }
  }
}
