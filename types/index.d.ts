// The dashboard's type contract: the values hooks/dashboard/register.tsx keeps in $.state.

export type Frontmatter = Record<string, string | string[]>

export type Findings = { important: number; nit: number; preExisting: number }

export type Stage = { name: string; state: 'done' | 'active' | 'waiting' | 'stuck' | 'todo' | 'skipped' }

export type Round = { n: number; findings: Findings | null; candidates: number | null }

// One finding the voter kept: its tag, `file:line` (or '' when its line has no location), Pattern Category (or the
// rest of its line), confidence, and the kind its `Security: <kind>` line gives (null without one).
export type KeptFinding = { tag: 'IMPORTANT' | 'NIT' | 'PRE-EXISTING'; loc: string; title: string; confidence: number | null; security: string | null }

// One review round's (or a standalone review's run's) kept findings, the raw `path:line` of each IMPORTANT finding
// its disputes.md dropped, and the end of the range it reviewed (runs only; null when unknown).
export type RoundKept = { n: number; kept: KeptFinding[]; drops: string[]; end: string | null }

// A finding in the findings tree, tracked across rounds: `path` is repo-relative, or '' with no location. `open`:
// the round on show keeps it (`round` is that round); `fixed`: an earlier round kept it as IMPORTANT (`round`, the
// last that did) and the round on show doesn't (`fixedBy`, the first round after it was last kept); `dropped`: the
// voter dropped it on dispute in `round`. `security`: its security kind, from the latest round that kept it, or null.
export type TreeFinding = {
  path: string
  line: number | null
  tag: KeptFinding['tag']
  title: string
  confidence: number | null
  security: string | null
  state: 'open' | 'fixed' | 'dropped'
  round: number
  fixedBy: number | null
}

// What the findings tree shows: the round (or run) on show, how many findings it kept, how many of those its own
// disputes.md dropped, and every finding to draw.
export type FindingsView = { unit: 'round' | 'run'; round: number; kept: number; dropped: number; findings: TreeFinding[] }

// One row of .tasks/<slug>/files.tsv (bin/quorum-files record): the git letter, lines added and removed (`bin` for
// a binary file, null while the file is only planned), the repo-relative path and, for a rename, the old one (''
// otherwise), the plan steps whose line names it (ascending), and whether it changed since the last round sha
// (null when there's none).
export type ChangedFile = {
  letter: 'M' | 'A' | 'D' | 'R'
  added: number | 'bin' | null
  removed: number | 'bin' | null
  path: string
  oldPath: string
  steps: number[]
  fix: boolean | null
}

// files.tsv's header and rows: HEAD when recorded, the base the change is diffed against, the round sha `fix` is
// against ('' for `-`), and when it was recorded, in unix seconds.
export type FileList = { head: string; base: string; since: string; recorded: number; files: ChangedFile[] }

// The pane's foldable sections. Each opens by itself while it holds a problem; a click overrides that.
export type Section = 'tasks' | 'requirements' | 'checks' | 'rounds' | 'reviews' | 'spend' | 'agents'

// One reviewer of the current round: `findings` is null until its reply is saved.
export type Reviewer = { role: string; findings: Findings | null }

// A requirement's verdict in the final proof, and the evidence for it.
export type Verdict = { n: string; verdict: 'MET' | 'PARTIAL' | 'MISSING' | 'CONTRADICTS'; evidence: string }

// The prover's latest report (proof-final.md, else proof-build.md); only a final proof has verdicts.
export type Proof = { file: string; rev: string; result: string; rows: { id: string; check: string; result: string }[]; verdicts: Verdict[] }

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
  // `tree`: the findings tree, for the latest round with a survivors.md (null before any). `rereviewBy`: by reviewer
  // role, how many of its reply's IMPORTANT findings are now awaiting re-review (code review only).
  | { kind: 'plan' | 'review'; round: number; of: number; reviewers: Reviewer[]; voter: Reviewer; survivors: Findings | null; tree: FindingsView | null; rereviewBy: Record<string, number> }
  | { kind: 'build' }
  | { kind: 'blind'; blind: Blind }
  // `blind`: at the PR handoff, the task's last blind run; null for a LOW task, or one with no blind run.
  | { kind: 'done'; blind: Blind | null }

// One of plan.md's steps, as `quorum-plan show N` reads it: its number, title, requirement numbers, and the 1-based
// plan.md lines it spans, from its numbered line to its last indented line.
export type PlanStep = { n: number; title: string; requirements: number[]; from: number; to: number }

export type Snapshot = {
  slug: string
  branch: string
  // pr.md exists: /quorum:pr-draft has run.
  prDrafted: boolean
  // state.md's `pr`: the PR's URL once recorded, else ''.
  prUrl: string
  risk: string
  // state.md's `fast`: a LOW task on the fast path (/quorum:run --fast), with no plan round.
  isFast: boolean
  // state.md's `bug`: a bug fix (--bug), which starts from a reproduction and must prove it fixed.
  isBug: boolean
  // plan.md's step count, and how many state.md's built_steps lists: a plan of 4 or more is built a step at a time.
  planSteps: number
  builtSteps: number
  // plan.md's steps ([] when it has none), and the paths a finding's location may start with: the session root, the
  // main working tree, and the task's worktree.
  steps: PlanStep[]
  roots: string[]
  // The steps built_steps lists, and whether proof-build.md exists (an unsliced build's steps are built once it does).
  builtList: number[]
  hasBuildProof: boolean
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
  // The plan review rounds with a folder on disk (plan-review/round-<N>/).
  planReviewRounds: Round[]
  next: string
  now: Now
  spec: Spec | null
  checks: Check[]
  proof: Proof | null
  // state.md's model choices (skills/pipeline-laws/models.md): a model, `inherit`, or '' before the spec asks.
  reviewerModel: string
  helperModel: string
  // HEAD's commit, '' when it can't be read, and whether the proof ran at an older one.
  head: string
  isProofStale: boolean
  // The proof the skills should have saved by now ('' while none is due), and the round log's line about the checks.
  expectedProof: string
  checksNote: string
  // files.tsv, the task's recorded change (null when it's missing or malformed); the code review's findings tree;
  // and the paths whose kept IMPORTANT finding the list shows changed since that round voted (awaiting re-review).
  files: FileList | null
  codeView: FindingsView | null
  rereview: string[]
}

// A standalone review (/quorum:review), from .tasks/review-<id>/: its latest run's reviewers and voter, as for a
// task's review round, and the findings tree over its runs. The one this session is running gets the live card; the rest are history.
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
  tree: FindingsView | null
}

// Another unfinished task in this repo, for the pane's list: its status and tier, and the git worktree its code is
// in ('' when it builds in the main working tree, or hasn't been built yet).
export type OtherTask = { slug: string; status: string; risk: string; worktree: string; changedAt: number }

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

// A `- ` line of map.md's Decisions so far or Out of scope. A line `- [title](tickets/NN-x.md): gist` fills `ticket`
// (NN), `title` and `gist`; any other line keeps only `text`, and `ticket` is ''.
export type MapLine = { text: string; ticket: string; title: string; gist: string }

// One tickets/NN-<name>.md, as bin/quorum-map reads it: `n` is NN, `blockedBy` the blockers' NNs in `Blocked by:`
// order, `question` the text under `## Question`, and `gist` the decision's gist from map.md (an out-of-scope
// ticket's reason), '' when map.md lists none.
export type MapTicket = { n: string; title: string; type: string; blockedBy: string[]; status: string; answeredBy: string; question: string; gist: string }

// One numbered line of tasks.md: its request, `tier:`, and `blocked by:` task numbers.
export type MapTask = { n: number; request: string; tier: string; blockedBy: number[] }

// A task started from the map (its state.md's `map` names it, `map_task` is `n`): what its row and tree show.
export type MapTaskRun = {
  n: number
  slug: string
  status: string
  risk: string
  stage: number
  isFast: boolean
  pr: number | null
  files: FileList | null
  rounds: Round[]
  codeView: FindingsView | null
  hasPlan: boolean
}

// The latest tasks-review/round-N/ of the map's task breakdown; `exists` is false before any round.
export type MapReview = { round: number; exists: boolean; reviewers: Reviewer[]; voter: Reviewer; survivors: Findings | null }

// A map, from .tasks/map-<slug>/: map.md's title, Destination, Decisions so far and Out of scope lines, its tickets
// in file order, tasks.md's tasks (null when tasks.md is missing), the breakdown's review, the tasks started from it,
// and whether it's on show because this session's map-session marker names it.
export type MapView = {
  slug: string
  title: string
  destination: string
  decisions: MapLine[]
  outOfScope: MapLine[]
  tickets: MapTicket[]
  tasks: MapTask[] | null
  review: MapReview | null
  runs: MapTaskRun[]
  isSession: boolean
}

// The last `quorum-map --map <slug> tasks` result: each task's state by number (null before any success), when it
// was last tried, the tasks it found ready (null before any success), and whether a task turned ready between two
// results, which opens the map's task list.
export type MapStates = { slug: string; states: Record<string, string> | null; triedAt: number; ready: number[] | null; isHandoff: boolean }

declare module 'claude-code' {
  interface PluginState {
    quorum: {
      task: Shaped<Snapshot | null>
      agents: Shaped<QuorumAgent[]>
      pr: Shaped<PullRequest | null>
      // The newest reviews first, a few at most.
      reviews: Shaped<Review[]>
      // Other unfinished tasks, newest first, a few at most.
      others: Shaped<OtherTask[]>
      now: number
      // Sections and findings-tree rows the person opened or closed, by `<slug>:<section>` or
      // `<scope>:tree:<path>`; absent, the default.
      sections: Shaped<Record<string, boolean>>
    }
  }
}
