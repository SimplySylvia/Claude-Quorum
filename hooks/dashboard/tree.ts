// The file tree's pure model and layout: the tree of a task's changed files (files.tsv's rows, with their plan
// progress, git letters, line counts, and steps) and the files its kept findings name. Join a finding's path to the
// project root, track kept findings across a review's rounds (open, awaiting re-review, fixed, or dropped on
// dispute), build the tree, and lay out its rows, header, key, and the footprint line to the card's width, with the
// marks the rows around it share. A `/quorum:review` has no recorded change, so its tree holds only the findings'
// files. No `$` here, so tests can call it directly.

import type { ChangedFile, FileList, Findings, FindingsView, PlanStep, Round, RoundKept, TreeFinding } from '../../types'
import { isStaleProof, keptFindings, plural } from './task'

// A run of text on a row, drawn as its own Text.
export type TreePart = { text: string; color?: string; dim?: boolean; bold?: boolean }

// One pressable row of the tree. `more` holds an open finding's wrapped title past its first line, each line with
// its hanging indent; `copy` is its `path:line`, or null without a location.
export type TreeRow = {
  key: string
  kind: 'folder' | 'file' | 'other' | 'finding'
  isOpen: boolean
  label: string
  parts: TreePart[]
  more: string[]
  copy: string | null
  confidence: number | null
}

// The recorded change the tree joins (files.tsv's rows), whether the task has a plan, the steps built so far (all of
// them, once an unsliced build has its proof), and the paths whose kept IMPORTANT finding is awaiting re-review.
export type TreeChange = { files: ChangedFile[]; hasPlan: boolean; built: number[]; allBuilt: boolean; rereview: string[] }

// The file being edited, repo-relative, and whether its row is still flashing.
export type TreeEdit = { path: string; isFlash: boolean }

// `selected`: the plan step whose files are lit, each with a `▎` before its bold name, their folders held open.
// `edit`: the file being edited, shown `●` and `editing` with its folders held open, as a live row when the list
// doesn't hold it, and lit in the claude colour while it flashes.
export type TreeOptions = { scope: string; width: number; icons: boolean; isHigh: boolean; folds: Record<string, boolean>; change?: TreeChange | null; selected?: number | null; edit?: TreeEdit | null }

// ---- Paths

export const slashes = (text: string) => text.replace(/\\/g, '/')

// A finding's path, repo-relative: backslashes read as `/`, a leading `./` dropped, then the longest root it sits
// under stripped, only at a `/` boundary. A path under no root stays as written. No `..` is resolved and nothing
// is read: the path is only displayed.
export function repoPath(path: string, roots: string[]): string {
  let p = slashes(path)
  while (p.startsWith('./')) p = p.slice(2)
  const bases = roots.map(r => slashes(r).replace(/\/+$/, '')).filter(r => r !== '').sort((a, b) => b.length - a.length)
  for (const base of bases) {
    if (p === base) return ''
    if (p.startsWith(`${base}/`)) return p.slice(base.length + 1)
  }
  return p
}

// `path:line` split at its last `:`; a location with no line number is all path.
export function splitLoc(loc: string): { path: string; line: number | null } {
  const m = /^(.*):(\d+)$/.exec(loc)
  return m ? { path: m[1] ?? '', line: Number(m[2]) } : { path: loc, line: null }
}

// The raw `path:line` of each IMPORTANT finding a voter's disputes.md dropped (`DROP [IMPORTANT] <path:line> — …`).
export function disputeDrops(text: string): string[] {
  return text.split('\n').map(l => /^DROP \[IMPORTANT\]\s+(\S+:\d+)/.exec(l.trim())?.[1] ?? '').filter(Boolean)
}

const rangeEnd = (range: string) => {
  const r = range.trim()
  const at = r.lastIndexOf('..')
  return at < 0 ? r : r.slice(at + 2)
}

// The end of each run's range, from state.md's `## Run <N> (<range>, …)` log lines; the latest run, before its line
// is logged, falls back to the frontmatter's `range`.
export function runEnds(stateMd: string, latestRun: number, latestRange: string): Record<number, string> {
  const ends: Record<number, string> = {}
  for (const line of stateMd.split('\n')) {
    const m = /^## Run (\d+) \(([^,)]+)/.exec(line.trim())
    const end = rangeEnd(m?.[2] ?? '')
    if (m && end && Number(m[1]) <= latestRun) ends[Number(m[1])] = end
  }
  if (ends[latestRun] === undefined && rangeEnd(latestRange)) ends[latestRun] = rangeEnd(latestRange)
  return ends
}

export const roundKept = (n: number, survivors: string, disputes: string, end: string | null): RoundKept =>
  ({ n, kept: keptFindings(survivors), drops: disputeDrops(disputes), end })

// ---- Tracking across rounds

// A Pattern Category as bin/quorum-lessons compares them: lowercased, whitespace collapsed.
const category = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim()

const distance = (a: number | null, b: number | null) =>
  a === null || b === null ? (a === b ? 0 : Number.MAX_SAFE_INTEGER) : Math.abs(a - b)

// Two range ends that are known and name different commits (a short SHA and its full form are the same one).
const isOtherEnd = (a: string | null, b: string | null) => !!a && !!b && !a.startsWith(b) && !b.startsWith(a)

// Code-point order, so an astral character sorts by its value rather than its UTF-16 halves.
function byCodePoint(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0)
    if (d !== 0) return d
  }
  return x.length - y.length
}

const byLine = (a: TreeFinding, b: TreeFinding) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER)

type Item = Omit<TreeFinding, 'state' | 'round' | 'fixedBy'> & { key: string; lastSeen: number; lastImportant: number | null }

// The tree's findings, from every round that has a survivors.md, in order; the last is the round on show. Findings
// pair across rounds by path and Pattern Category, at any severity, nearest line first. Each is then decided once
// against the round on show: dropped on dispute, open, fixed, or let go.
export function trackFindings(rounds: RoundKept[], roots: string[], unit: 'round' | 'run'): FindingsView | null {
  const shown = rounds.at(-1)
  if (!shown) return null
  const items: Item[] = []
  for (const round of rounds) {
    const found = round.kept.map(f => {
      const { path, line } = splitLoc(f.loc)
      const joined = repoPath(path, roots)
      return { f, path: joined, line, key: `${joined}\t${category(f.title)}` }
    })
    const pairs: [number, number, number][] = []
    found.forEach((x, fi) => items.forEach((it, ii) => { if (it.key === x.key) pairs.push([distance(x.line, it.line), fi, ii]) }))
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    const match = new Map<number, number>()
    const taken = new Set<number>()
    for (const [, fi, ii] of pairs) {
      if (match.has(fi) || taken.has(ii)) continue
      match.set(fi, ii)
      taken.add(ii)
    }
    found.forEach((x, fi) => {
      const isImportant = x.f.tag === 'IMPORTANT'
      const item = items[match.get(fi) ?? -1]
      const seen = { line: x.line, tag: x.f.tag, title: x.f.title, confidence: x.f.confidence, security: x.f.security, lastSeen: round.n }
      if (item) Object.assign(item, seen, { lastImportant: isImportant ? round.n : item.lastImportant })
      else items.push({ key: x.key, path: x.path, ...seen, lastImportant: isImportant ? round.n : null })
    })
  }

  const drops = new Map(rounds.map(r => [r.n, new Set(r.drops.map(d => {
    const { path, line } = splitLoc(d)
    return `${repoPath(path, roots)}:${line}`
  }))]))
  const findings: TreeFinding[] = []
  for (const it of items) {
    const base = { path: it.path, line: it.line, tag: it.tag, title: it.title, confidence: it.confidence, security: it.security }
    const at = rounds.findIndex(r => r.n === it.lastSeen)
    if (it.tag === 'IMPORTANT' && it.line !== null && drops.get(it.lastSeen)?.has(`${it.path}:${it.line}`)) {
      findings.push({ ...base, state: 'dropped', round: it.lastSeen, fixedBy: null })
    } else if (it.lastSeen === shown.n) {
      findings.push({ ...base, state: 'open', round: shown.n, fixedBy: null })
    } else if (it.lastImportant !== null) {
      const end = rounds[at]?.end ?? null
      const later = rounds.slice(at + 1)
      // A run fixes it only over a different range end: a run over the same end reviewed the same code.
      const by = unit === 'round' ? later[0] : isOtherEnd(end, shown.end) ? later.find(r => isOtherEnd(end, r.end)) : undefined
      if (by) findings.push({ ...base, tag: 'IMPORTANT', state: 'fixed', round: it.lastImportant, fixedBy: by.n })
    }
  }
  const kept = shown.kept.length
  const shownFindings = (kept === 0 ? findings.filter(f => f.state === 'fixed') : findings)
    .sort((a, b) => byCodePoint(a.path, b.path) || byLine(a, b))
  return {
    unit,
    round: shown.n,
    kept,
    dropped: shownFindings.filter(f => f.state === 'dropped' && f.round === shown.n).length,
    findings: shownFindings,
  }
}

// ---- Marks and words

// `security` and `securityAwaiting`: how many of the `important` and `awaiting` findings have a security kind.
type Counts = Findings & { awaiting: number; fixed: number; dropped: number; security: number; securityAwaiting: number }

// An open IMPORTANT finding on a file the fix changed since its round is awaiting re-review, not important.
const isAwaiting = (f: TreeFinding, rereview: string[]) => f.state === 'open' && f.tag === 'IMPORTANT' && rereview.includes(f.path)

const countOf = (fs: TreeFinding[], rereview: string[] = []): Counts => {
  const open = (tag: TreeFinding['tag']) => fs.filter(f => f.state === 'open' && f.tag === tag && !isAwaiting(f, rereview))
  const important = open('IMPORTANT')
  const awaiting = fs.filter(f => isAwaiting(f, rereview))
  return {
    important: important.length,
    security: important.filter(f => f.security !== null).length,
    awaiting: awaiting.length,
    securityAwaiting: awaiting.filter(f => f.security !== null).length,
    fixed: fs.filter(f => f.state === 'fixed').length,
    nit: open('NIT').length,
    preExisting: open('PRE-EXISTING').length,
    dropped: fs.filter(f => f.state === 'dropped').length,
  }
}

// The marks, in the order every row and the key use. Dropped findings have none. `bang`: the count of the mark's
// findings with a security kind, which a `!` after the count flags.
const MARKS = [
  { glyph: '✗', field: 'important', word: 'important', color: 'error', bang: 'security' },
  { glyph: '↻', field: 'awaiting', word: 'awaiting re-review', color: 'warning', bang: 'securityAwaiting' },
  { glyph: '✓', field: 'fixed', word: 'fixed this run', color: 'success', bang: null },
  { glyph: 'n', field: 'nit', word: 'nit', color: null, bang: null },
  { glyph: 'p', field: 'preExisting', word: 'pre-existing', color: null, bang: null },
] as const

const hasSecurity = (c: Counts) => c.security + c.securityAwaiting > 0

const markPart = (glyph: string, color: string | null, text = glyph): TreePart => (color ? { text, color } : { text, dim: true })

// Counts in marks: `✗1 n1 p1`, zero counts left out ('' when all are zero).
export function markText(f: Findings): string {
  return [f.important ? `✗${f.important}` : '', f.nit ? `n${f.nit}` : '', f.preExisting ? `p${f.preExisting}` : ''].filter(Boolean).join(' ')
}

const words = (c: Counts) => [
  c.important ? `${c.important} important` : '',
  c.security ? `${c.security} of them security` : '',
  c.awaiting ? `${c.awaiting} awaiting re-review` : '',
  c.securityAwaiting ? `${c.securityAwaiting} of them security` : '',
  c.fixed ? `${c.fixed} fixed` : '',
  c.nit ? plural(c.nit, 'nit') : '',
  c.preExisting ? `${c.preExisting} pre-existing` : '',
  c.dropped ? `${c.dropped} dropped on dispute` : '',
].filter(Boolean)

// Counts in words, for a label: `1 important, 1 nit`, zero counts left out, or `clean`.
export const markWords = (f: Findings) => words({ ...f, awaiting: 0, fixed: 0, dropped: 0, security: 0, securityAwaiting: 0 }).join(', ') || 'clean'

// ---- Widths and cuts, in code points

// A Nerd Font icon sits in the Private Use Area, and some fonts draw it two cells wide.
const isWide = (cp: number) => (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd)

export const cellWidth = (text: string) => [...text].reduce((n, c) => n + (isWide(c.codePointAt(0) ?? 0) ? 2 : 1), 0)

const widthOf = (parts: TreePart[]) => parts.reduce((n, p) => n + cellWidth(p.text), 0)

// Cut at the end, with `…`, to at most `max` columns.
export function cutEnd(text: string, max: number): string {
  if (cellWidth(text) <= max) return text
  if (max <= 0) return ''
  let out = ''
  let w = 0
  for (const c of text) {
    if (w + cellWidth(c) > max - 1) break
    out += c
    w += cellWidth(c)
  }
  return `${out.trimEnd()}…`
}

// `stem` cut in the middle with `…`, keeping `suffix` whole, to at most `max` columns.
function cutAround(stem: string, suffix: string, max: number): string {
  if (cellWidth(stem + suffix) <= max) return stem + suffix
  const room = max - cellWidth(suffix) - 1
  if (room < 2) return cutEnd(stem + suffix, max)
  const chars = [...stem]
  const headRoom = Math.ceil(room / 2)
  let head = 0
  let w = 0
  while (head < chars.length && w + cellWidth(chars[head] ?? '') <= headRoom) w += cellWidth(chars[head++] ?? '')
  let tail = chars.length
  while (tail > head && w + cellWidth(chars[tail - 1] ?? '') <= room) w += cellWidth(chars[--tail] ?? '')
  return `${chars.slice(0, head).join('')}…${chars.slice(tail).join('')}${suffix}`
}

// A file name cut in the middle, keeping its extension.
export function cutMiddle(name: string, max: number): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : ''
  return cutAround(name.slice(0, name.length - ext.length), ext, max)
}

// A folder chain (`a/b/c/d/`) cut to its first and last folder, then in the middle if that is still too long.
export function cutChain(chain: string, max: number): string {
  if (cellWidth(chain) <= max) return chain
  const lead = chain.startsWith('/') ? '/' : ''
  const segs = chain.slice(lead.length).replace(/\/$/, '').split('/')
  const short = segs.length >= 3 ? `${lead}${segs[0]}/…/${segs.at(-1)}/` : chain
  return cellWidth(short) <= max ? short : cutAround(short.replace(/\/$/, ''), '/', max)
}

// The parts, cut at the end so that together they are at most `max` columns: the last resort for a row.
function fit(parts: TreePart[], max: number): TreePart[] {
  const out: TreePart[] = []
  let w = 0
  for (const p of parts) {
    const pw = cellWidth(p.text)
    if (w + pw <= max) {
      out.push(p)
      w += pw
      continue
    }
    const cut = cutEnd(p.text, max - w)
    if (cut) out.push({ ...p, text: cut })
    break
  }
  return out
}

// Words onto lines of at most `first` columns, then `rest`; a word too long for a line is cut at its end.
function wrap(text: string, first: number, rest: number): string[] {
  const lines: string[] = []
  let room = Math.max(1, first)
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && cellWidth(cur) + 1 + cellWidth(word) <= room) {
      cur += ` ${word}`
      continue
    }
    if (cur) {
      lines.push(cur)
      room = Math.max(1, rest)
    }
    cur = cutEnd(word, room)
  }
  lines.push(cur)
  return lines
}

// ---- Plan steps

// A step's progress: built, being built, or not built yet.
export type StepMark = '✓' | '●' | '○'
export type StepMarks = Findings & { awaiting: number }
// One step row: `files` is null without files.tsv, and `findings` null outside Plan, so neither is drawn or said.
export type StepLine = { n: number; title: string; requirements: number[]; mark: StepMark; files: number | null; findings: StepMarks | null; isSelected: boolean }

// The view's open findings on plan.md (`planPath`, repo-relative, as the tree places them) whose line falls in the
// step's span, both ends included, counted as the tree counts them.
export function stepFindings(view: FindingsView | null, planPath: string, step: Pick<PlanStep, 'from' | 'to'>, rereview: string[]): StepMarks {
  const on = (view?.findings ?? []).filter(f => f.path === planPath && f.line !== null && f.line >= step.from && f.line <= step.to)
  const { important, awaiting, nit, preExisting } = countOf(on, rereview)
  return { important, awaiting, nit, preExisting }
}

const STEP_COLOR: Record<StepMark, string | null> = { '✓': 'success', '●': 'claude', '○': null }
const STEP_WORD: Record<StepMark, string> = { '✓': 'built', '●': 'being built', '○': 'not built yet' }
const STEP_MARKS = MARKS.filter(m => m.field !== 'fixed')

// `1`, `1 and 2`, `1, 2 and 3`.
const andList = (ns: number[]) => (ns.length < 2 ? ns.join('') : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`)

// The step rows, `width` wide: the mark, the number right-aligned, the title cut at its end (bold after a `▎` when
// selected), then a right-hand block as wide on every row so its columns line up: the finding marks, `K files`
// (none without files.tsv), and ` · req 1, 2`. When the title would get fewer than 12 columns, the requirements
// give way first, cut at the end, and go once fewer than 6 columns are left for them; the marks and files never
// shrink.
export function stepRows(lines: StepLine[], width: number): { n: number; parts: TreePart[]; label: string }[] {
  const numWidth = Math.max(0, ...lines.map(l => cellWidth(String(l.n))))
  const marks = lines.map(l => STEP_MARKS.filter(m => l.findings?.[m.field])
    .flatMap((m, i): TreePart[] => [...(i > 0 ? [{ text: ' ' }] : []), markPart(m.glyph, m.color, `${m.glyph}${l.findings?.[m.field]}`)]))
  const marksWidth = Math.max(0, ...marks.map(widthOf))
  const hasFiles = lines.some(l => l.files !== null)
  const files = lines.map(l => (l.files === null ? '' : plural(l.files, 'file')))
  const filesWidth = Math.max(0, ...files.map(cellWidth))
  const reqs = lines.map(l => (l.requirements.length === 0 ? '' : `${hasFiles ? ' · ' : ''}req ${l.requirements.join(', ')}`))
  const leadWidth = 2 + numWidth + 1
  let reqWidth = Math.max(0, ...reqs.map(cellWidth))
  const short = 12 - (width - leadWidth - 1 - (marksWidth > 0 ? marksWidth + 2 : 0) - filesWidth - reqWidth)
  if (short > 0) reqWidth = reqWidth - short < 6 ? 0 : reqWidth - short

  return lines.map((l, i) => {
    const req = reqWidth > 0 ? cutEnd(reqs[i] ?? '', reqWidth) : ''
    const right: TreePart[] = [
      ...(marksWidth > 0 ? [...pad(marksWidth - widthOf(marks[i] ?? [])), ...(marks[i] ?? []), { text: '  ' }] : []),
      ...pad(filesWidth - cellWidth(files[i] ?? '')),
      ...(files[i] ? [{ text: files[i] ?? '' }] : []),
      ...(req ? [{ text: req }] : []),
      ...pad(reqWidth - cellWidth(req)),
    ]
    const left: TreePart[] = [
      markPart(l.mark, STEP_COLOR[l.mark]),
      // A selected step's bar takes the space before its bold title, as a lit file's does, so nothing moves.
      { text: ` ${' '.repeat(numWidth - cellWidth(String(l.n)))}${l.n}${l.isSelected ? '▎' : ' '}` },
      { text: cutEnd(l.title, width - leadWidth - 1 - widthOf(right)), ...(l.isSelected ? { bold: true } : {}) },
    ]
    const label = [
      `step ${l.n}`,
      l.title,
      STEP_WORD[l.mark],
      ...(l.files === null ? [] : [plural(l.files, 'file')]),
      ...(l.requirements.length === 0 ? [] : [`${l.requirements.length === 1 ? 'requirement' : 'requirements'} ${andList(l.requirements)}`]),
      ...(l.findings ? words({ ...l.findings, fixed: 0, dropped: 0, security: 0, securityAwaiting: 0 }) : []),
      ...(l.isSelected ? ['selected'] : []),
    ].join(', ')
    const gap = Math.max(1, width - widthOf(left) - widthOf(right))
    return { n: l.n, parts: fit([...left, ...pad(gap), ...right], width), label }
  })
}

// ---- Icons (Nerd Fonts v3, codepoints from glyphnames.json 3.5.1)

const ICONS: Record<string, [string, string]> = {
  ts: ['', '#519aba'],
  tsx: ['', '#20c2e3'],
  jsx: ['', '#20c2e3'],
  js: ['', '#cbcb41'],
  json: ['', '#cbcb41'],
  // md-file_document: seti-markdown (U+E609) reads as "download".
  md: ['\u{F0219}', '#519aba'],
  svg: ['', '#ffb13b'],
  css: ['', '#42a5f5'],
  py: ['', '#3572a5'],
  go: ['', '#519aba'],
  rs: ['', '#dea584'],
  yml: ['', '#a074c4'],
  yaml: ['', '#a074c4'],
  sh: ['', '#4eba65'],
  html: ['', '#e37933'],
  lock: ['', '#8b8b8b'],
}
const ANY_FILE: [string, string] = ['', '#8b8b8b']
const TEST_TUBE = '\u{F0668}'

export function fileIcon(name: string): { glyph: string; color: string } {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  const [glyph, color] = ICONS[dot > 0 ? base.slice(dot + 1).toLowerCase() : ''] ?? ANY_FILE
  return { glyph: /\.(test|spec)\./.test(base) ? TEST_TUBE : glyph, color }
}

export const folderIcon = (isOpen: boolean) => ({ glyph: isOpen ? '' : '', color: '#8b8b8b' })

// Icons only for the exact `nerd` option, and only in the terminal.
export const iconsOn = (option: unknown, surface: string) => option === 'nerd' && surface === 'terminal'

// ---- The recorded change

type Progress = '✓' | '○' | '●' | '*' | ''

// A file's progress against the plan: `✓` when every step that names it is built and the file has changed, `○` when
// one isn't built yet or the file is only planned, `*` when no step names it; blank for a file the list doesn't hold,
// or a task with no plan.
const progressOf = (c: ChangedFile | null, ch: TreeChange | null): Progress =>
  !c || !ch?.hasPlan ? '' : c.steps.length === 0 ? '*'
    : c.added !== null && (ch.allBuilt || c.steps.every(n => ch.built.includes(n))) ? '✓' : '○'

// Whether the edit of `path` shows its `●`: always, except in Build on a file some step names whose steps are all
// built, none of them the one being built, where the file keeps its own mark.
export function isEditShown(path: string, ch: TreeChange, isBuilding: boolean, beingBuilt: number | null): boolean {
  const c = ch.files.find(f => f.path === path)
  if (!isBuilding || !c || c.steps.length === 0) return true
  return !c.steps.every(n => (ch.allBuilt || ch.built.includes(n)) && n !== beingBuilt)
}

// The lead marks, in the order the key names them.
const PROGRESS = [
  { glyph: '✓', word: 'built', color: 'success' },
  { glyph: '○', word: 'not yet', color: null },
  { glyph: '●', word: 'editing', color: 'claude' },
  { glyph: '*', word: 'unplanned', color: null },
] as const

const LETTER_WORD: Record<ChangedFile['letter'], string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed' }

const stepList = (ns: number[]) => `${ns.length === 1 ? 'step' : 'steps'} ${ns.join(', ')}`

const lines = (n: number | 'bin' | null) => (typeof n === 'number' ? n : 0)

// `+86 −3`, leaving out a side with no lines; `86 lines added, 3 removed` in words.
const lineParts = (added: number, removed: number): TreePart[] => [
  ...(added ? [{ text: `+${added}`, color: 'success' }] : []),
  ...(added && removed ? [{ text: ' ' }] : []),
  ...(removed ? [{ text: `−${removed}`, color: 'error' }] : []),
]
const lineWords = (added: number, removed: number) =>
  added && removed ? `${plural(added, 'line')} added, ${removed} removed`
  : added ? `${plural(added, 'line')} added` : removed ? `${plural(removed, 'line')} removed` : 'no lines changed'

const isBinary = (c: ChangedFile) => c.added === 'bin' || c.removed === 'bin'

// A file row's line-count column: `bin`, `+86 −3`, or nothing while only planned.
const countParts = (c: ChangedFile | null): TreePart[] =>
  !c || c.added === null ? [] : isBinary(c) ? [{ text: 'bin' }] : lineParts(lines(c.added), lines(c.removed))

// A file's columns in words, for its label: progress, letter, then counts. A file whose steps are all built but that
// isn't changed yet says so with its progress (`step 2 built, not changed yet`), since that's why it's `○`.
function fileWords(c: ChangedFile, ch: TreeChange): string[] {
  const p = progressOf(c, ch)
  const built = c.steps.filter(n => ch.allBuilt || ch.built.includes(n))
  const waiting = c.steps.filter(n => !built.includes(n))
  const progress = p === '' ? [] : p === '*' ? ['unplanned']
    : [...(built.length > 0 ? [`${stepList(built)} built`] : []), ...(waiting.length > 0 ? [`${stepList(waiting)} not built yet`] : [])]
  const letter = c.letter === 'R' && c.oldPath ? `renamed from ${c.oldPath}` : LETTER_WORD[c.letter]
  const counts = c.added === null ? 'not changed yet' : isBinary(c) ? 'binary' : lineWords(lines(c.added), lines(c.removed))
  return c.added === null && p === '○' && waiting.length === 0 ? [...progress, counts, letter] : [...progress, letter, counts]
}

// ---- The tree

type FileNode = { path: string; name: string; findings: TreeFinding[]; file: ChangedFile | null }
type FolderNode = { path: string; name: string; folders: Map<string, FolderNode>; files: Map<string, FileNode> }

// The file node for `path`, made with its folders if it's new; null for a path with no name (no location).
function place(root: FolderNode, path: string): FileNode | null {
  const lead = path.startsWith('/') ? '/' : ''
  const segs = path.slice(lead.length).split('/').filter(s => s !== '')
  const name = segs.pop()
  if (name === undefined) return null
  // A leading `/` stays on the first segment: `/repo2/app/`.
  let dir = root
  segs.forEach((seg, i) => {
    const s = i === 0 ? lead + seg : seg
    let next = dir.folders.get(s)
    if (!next) dir.folders.set(s, next = { path: `${dir.path}${s}/`, name: s, folders: new Map(), files: new Map() })
    dir = next
  })
  const fileName = segs.length === 0 ? lead + name : name
  let file = dir.files.get(fileName)
  if (!file) dir.files.set(fileName, file = { path: `${dir.path}${fileName}`, name: fileName, findings: [], file: null })
  return file
}

// The tree of the recorded change's files and the findings' files, joined by path.
function build(findings: TreeFinding[], files: ChangedFile[] = []): { root: FolderNode; other: TreeFinding[] } {
  const root: FolderNode = { path: '', name: '', folders: new Map(), files: new Map() }
  const other: TreeFinding[] = []
  for (const c of files) {
    const node = place(root, c.path)
    if (node) node.file = c
  }
  for (const f of findings) {
    const node = place(root, f.path)
    if (node) node.findings.push(f)
    else other.push(f)
  }
  return { root, other }
}

const sorted = <T extends { name: string }>(m: Map<string, T>) => [...m.values()].sort((a, b) => byCodePoint(a.name, b.name))

const nodesUnder = (dir: FolderNode): FileNode[] => [...[...dir.folders.values()].flatMap(nodesUnder), ...dir.files.values()]

const under = (dir: FolderNode): TreeFinding[] => nodesUnder(dir).flatMap(f => f.findings)

// More than 15 files, so clean folders start folded.
export const isBigTree = (view: FindingsView | null, change: TreeChange | null | undefined) =>
  !!change && nodesUnder(build(view?.findings ?? [], change.files).root).length > 15

type Entry = {
  kind: 'folder' | 'file' | 'other'
  key: string
  path: string
  name: string
  depth: number
  counts: Counts
  files: number
  findings: TreeFinding[]
  file: ChangedFile | null
  isOpen: boolean
  isHidden: boolean
  // Why a folder is open whatever its fold says: it holds the file being edited, or the selected step's files.
  hold: 'editing' | { step: number } | null
}

const stateWord = (isOpen: boolean) => (isOpen ? 'open' : 'folded')

const TAG_WORD: Record<TreeFinding['tag'], string> = { IMPORTANT: 'important', NIT: 'nit', 'PRE-EXISTING': 'pre-existing' }

const pad = (n: number): TreePart[] => (n > 0 ? [{ text: ' '.repeat(n) }] : [])

// The tree's rows, in order: folders before files, each sorted by name, a folder holding only one folder merged
// with it, and the findings with no location under `other`, last. Rows inside a folded folder or file are left out.
// Folder, file, and `other` rows are `width` wide, ending in one right-aligned column per mark the view has; with a
// security finding in the view, the ✗ and ↻ columns end in one more, a `!` where the count holds one. With a
// recorded change, each row also leads with its progress and git letter, and ends with its line counts and step
// before the marks; with no findings view (Build), there are no marks.
export function treeRows(view: FindingsView | null, o: TreeOptions): TreeRow[] {
  const ch = o.change ?? null
  if (!view && !ch) return []
  const rereview = ch?.rereview ?? []
  const { root, other } = build(view?.findings ?? [], ch?.files ?? [])
  // Measured before the live row goes in, so it never tips the tree past 15 files.
  const isBig = isBigTree(view, ch)
  // The edited file's node, placed as a live row (no file) when the list doesn't hold it.
  const edited = o.edit && ch ? place(root, o.edit.path) : null
  const isEdited = (e: { kind: string; path: string }) => edited !== null && e.kind === 'file' && e.path === edited.path
  const sel = o.selected ?? null
  const isLit = (f: ChangedFile | null) => sel !== null && !!f && f.steps.includes(sel)
  const entries: Entry[] = []
  const walk = (dir: FolderNode, depth: number, isHidden: boolean) => {
    for (const child of sorted(dir.folders)) {
      let node = child
      let name = `${child.name}/`
      while (node.files.size === 0 && node.folders.size === 1) {
        const only = [...node.folders.values()][0]
        if (!only) break
        node = only
        name += `${only.name}/`
      }
      const key = `${o.scope}:tree:${node.path}`
      const nodes = nodesUnder(node)
      // In a big tree a folder starts folded unless it holds an open or ↻ finding, or an unplanned file.
      const hasProblem = () => nodes.some(f => f.findings.some(x => x.state === 'open') || progressOf(f.file, ch) === '*')
      // A folder holding the edited file or the selected step's files is held open; the stored fold is kept for when
      // the hold ends.
      const hold = edited !== null && nodes.includes(edited) ? 'editing' : sel !== null && nodes.some(f => isLit(f.file)) ? { step: sel } : null
      const isOpen = hold !== null || (o.folds[key] ?? (!isBig || hasProblem()))
      entries.push({ kind: 'folder', key, path: node.path, name, depth, counts: countOf(under(node), rereview), files: nodes.length, findings: [], file: null, isOpen, isHidden, hold })
      walk(node, depth + 1, isHidden || !isOpen)
    }
    for (const file of sorted(dir.files)) {
      const key = `${o.scope}:tree:${file.path}`
      const c = countOf(file.findings, rereview)
      const isOpen = o.folds[key] ?? (c.important + c.awaiting + c.nit + c.preExisting + c.dropped > 0 || (o.isHigh && c.fixed > 0))
      entries.push({ kind: 'file', key, path: file.path, name: file.name, depth, counts: c, files: 1, findings: [...file.findings].sort(byLine), file: file.file, isOpen, isHidden, hold: null })
    }
  }
  walk(root, 0, false)
  if (other.length > 0) {
    const key = `${o.scope}:tree::other`
    entries.push({ kind: 'other', key, path: ':other', name: 'other', depth: 0, counts: countOf(other, rereview), files: 0, findings: other, file: null, isOpen: o.folds[key] ?? true, isHidden: false, hold: null })
  }

  // Columns are measured over every row, folded or not, so a fold never moves one.
  const total = countOf(view?.findings ?? [], rereview)
  // With a security finding anywhere in the view, the ✗ and ↻ columns gain a last column for its `!` in every row.
  const hasBang = hasSecurity(total)
  const marks = (view ? MARKS : []).filter(m => total[m.field] > 0).map(m => {
    const bang = hasBang ? m.bang : null
    return { ...m, bang, width: Math.max(...entries.map(e => (e.counts[m.field] ? cellWidth(`${m.glyph}${e.counts[m.field]}`) : 0))) + (bang ? 1 : 0) }
  })
  const blockWidth = marks.reduce((n, m) => n + m.width, 0) + 2 * Math.max(0, marks.length - 1)
  const markParts = (c: Counts): TreePart[] => [
    { text: ' '.repeat(Math.max(0, 6 - blockWidth)) },
    ...marks.flatMap((m, i) => {
      const text = c[m.field] ? `${m.glyph}${c[m.field]}` : ''
      const bang: TreePart[] = m.bang ? [c[m.bang] > 0 ? { text: '!', color: 'error' } : { text: ' ' }] : []
      return [{ text: `${i > 0 ? '  ' : ''}${' '.repeat(m.width - (m.bang ? 1 : 0) - cellWidth(text))}` }, ...(text ? [markPart(m.glyph, m.color, text)] : []), ...bang]
    }),
  ].filter(p => p.text !== '')

  // The change's columns: progress and letter at the start; the unplanned word, line counts, and step before the marks.
  const countText = (e: Entry): TreePart[] => (e.kind === 'folder' ? [{ text: plural(e.files, 'file'), dim: true }] : countParts(e.file))
  const stepText = (e: Entry) => (e.file && e.file.steps.length > 0 ? `s${Math.min(...e.file.steps)}` : '')
  const isUnplanned = (e: Entry) => e.kind === 'file' && (progressOf(e.file, ch) === '*' || (isEdited(e) && !e.file && !!ch?.hasPlan))
  // The word slot: `editing` and `unplanned`, each when it applies.
  const wordsOf = (e: Entry): TreePart[] => [
    ...(isEdited(e) ? [{ text: 'editing', color: 'claude' }] : []),
    ...(isEdited(e) && isUnplanned(e) ? [{ text: ' ' }] : []),
    ...(isUnplanned(e) ? [{ text: 'unplanned', dim: true }] : []),
  ]
  const countWidth = Math.max(7, ...entries.map(e => widthOf(countText(e))))
  const stepWidth = Math.max(2, ...entries.map(e => cellWidth(stepText(e))))
  const markWidth = view ? Math.max(6, blockWidth) : 0
  let hasWord = entries.some(e => wordsOf(e).length > 0)
  let hasStep = true
  let hasCount = true
  const rightWidth = () => {
    const cols = (hasCount ? countWidth : 0) + (hasCount && hasStep ? 1 : 0) + (hasStep ? stepWidth : 0)
    return cols + (view ? (cols > 0 ? 2 : 0) + markWidth : 0)
  }
  // The progress column shows with a plan, or for an edit's `●`.
  const hasProgress = !!ch && (ch.hasPlan || edited !== null)
  const leadWidth = ch ? (hasProgress ? 2 : 0) + 2 : 0
  // The widest file row at its least: the lead, indent and icon, a 4-column name, a gap, the word, and the right block.
  const need = () => Math.max(0, ...entries.filter(e => e.kind === 'file').map(e =>
    leadWidth + 2 * e.depth + 2 + (o.icons ? 3 : 0) + Math.min(4, cellWidth(e.name)) + 1 + (hasWord && wordsOf(e).length > 0 ? widthOf(wordsOf(e)) + 1 : 0) + rightWidth()))
  // What gives way when that doesn't fit, decided once for the view: the word, then the step, then the counts.
  if (ch && need() > o.width) hasWord = false
  if (ch && need() > o.width) hasStep = false
  if (ch && need() > o.width) hasCount = false

  const leadOf = (e: Entry): TreePart[] => {
    if (!ch) return []
    const p = isEdited(e) ? '●' : e.kind === 'file' ? progressOf(e.file, ch) : ''
    const mark = PROGRESS.find(m => m.glyph === p)
    const letter = e.kind === 'file' && e.file ? e.file.letter : ''
    return [
      ...(hasProgress ? [mark ? markPart(mark.glyph, mark.color) : { text: ' ' }, { text: ' ' }] : []),
      letter ? { text: letter, ...(e.file?.added === null ? { dim: true } : {}) } : { text: ' ' },
      { text: ' ' },
    ]
  }
  const rightOf = (e: Entry): TreePart[] => {
    if (!ch) return [...(e.kind === 'folder' ? [{ text: `${plural(e.files, 'file')}  `, dim: true }] : []), ...markParts(e.counts)]
    const count = countText(e)
    const step = stepText(e)
    return [
      ...(hasWord && wordsOf(e).length > 0 ? [...wordsOf(e), { text: ' ' }] : []),
      ...(hasCount ? [...pad(countWidth - widthOf(count)), ...count] : []),
      ...(hasCount && hasStep ? [{ text: ' ' }] : []),
      ...(hasStep ? [...pad(stepWidth - cellWidth(step)), ...(step ? [{ text: step }] : [])] : []),
      ...(view ? [...(hasCount || hasStep ? [{ text: '  ' }] : []), ...markParts(e.counts)] : []),
    ]
  }

  const rows: TreeRow[] = []
  for (const e of entries) {
    if (e.isHidden) continue
    // A file with no findings has nothing to fold.
    const hasFindings = e.findings.length > 0
    const lit = e.kind === 'file' && isLit(e.file)
    // A flashing edit is lit in the claude colour, over a selection's plain highlight.
    const flash = isEdited(e) && !!o.edit?.isFlash
    const fold = `${'  '.repeat(e.depth)}${e.kind === 'file' ? (e.isOpen || !hasFindings ? '  ' : '▸ ') : e.isOpen ? '▾ ' : '▸ '}`
    // A lit file's bar takes the lead's last column, always a space, so nothing on the row moves.
    const lead = lit || flash ? `${fold.slice(0, -1)}▎` : fold
    const leadParts: TreePart[] = flash ? [{ text: fold.slice(0, -1) }, { text: '▎', color: 'claude' }] : [{ text: lead }]
    const cols = leadOf(e)
    const icon = !o.icons || e.kind === 'other' ? null : e.kind === 'folder' ? folderIcon(e.isOpen) : fileIcon(e.name)
    const right = rightOf(e)
    const room = o.width - widthOf(right) - 1 - widthOf(cols) - cellWidth(lead) - (icon ? 3 : 0)
    const name = e.kind === 'folder' ? cutChain(e.name, room) : e.kind === 'file' ? cutMiddle(e.name, room) : e.name
    const nameStyle = flash ? { bold: true, color: 'claude' } : lit ? { bold: true } : {}
    const left = fit([...cols, ...leadParts, ...(icon ? [{ text: icon.glyph, color: icon.color }, { text: ' ' }] : []), { text: name, ...nameStyle }], Math.max(0, o.width - widthOf(right) - 1))
    const gap = Math.max(1, o.width - widthOf(left) - widthOf(right))
    const counts = words(e.counts)
    const label = [
      e.kind === 'folder' ? `${e.path} folder` : e.kind === 'file' ? e.path : 'other',
      ...(isEdited(e) ? ['editing'] : []),
      ...(isEdited(e) && !e.file && isUnplanned(e) ? ['unplanned'] : []),
      ...(lit ? [`in step ${sel}`] : []),
      ...(e.kind === 'folder' ? [plural(e.files, 'file')] : []),
      ...(e.file && ch ? fileWords(e.file, ch) : []),
      ...counts,
      ...(e.kind !== 'file' || hasFindings ? [stateWord(e.isOpen)] : []),
      ...(e.hold === 'editing' ? ['held open while editing'] : e.hold ? [`held open for step ${e.hold.step}`] : []),
    ].join(', ')
    rows.push({ key: e.key, kind: e.kind, isOpen: e.isOpen, label, parts: fit([...left, { text: ' '.repeat(gap) }, ...right], o.width), more: [], copy: null, confidence: null })
    if (e.kind === 'folder' || !e.isOpen) continue

    // Findings sit two columns in from their file's name.
    const indent = ' '.repeat(widthOf(cols) + cellWidth(lead) + (icon ? 3 : 0) + 2)
    const seen = new Map<string, number>()
    for (const f of e.findings) {
      const i = seen.get(String(f.line)) ?? 0
      seen.set(String(f.line), i + 1)
      const key = `${e.key}:${f.line ?? ''}#${i}`
      const isOpen = o.folds[key] ?? false
      const isDropped = f.state === 'dropped'
      const awaits = isAwaiting(f, rereview)
      const mark = f.state === 'fixed' ? MARKS[2] : f.tag === 'IMPORTANT' ? (awaits ? MARKS[1] : MARKS[0]) : f.tag === 'NIT' ? MARKS[3] : MARKS[4]
      const glyph = isDropped ? { text: '·', dim: true } : markPart(mark.glyph, mark.color)
      const where = f.line === null ? '(no location)' : `:${f.line}`
      const status = f.state === 'fixed' ? `${view?.unit} ${f.round} → fixed by ${view?.unit} ${f.fixedBy}` : isDropped ? `dropped on dispute in ${view?.unit} ${f.round}` : ''
      const prefix: TreePart[] = [{ text: indent, dim: isDropped }, glyph, { text: ` ${where} `, dim: true }]
      // A security finding's word before its title: in error while open, muted once fixed or dropped.
      const word: TreePart[] = f.security === null ? [] : [f.state === 'open' ? { text: 'security ', color: 'error' } : { text: 'security ', dim: true }]
      // The title's column: its wrapped lines hang there, and confidenceRow puts the copy path there too.
      const hang = widthOf(prefix) + widthOf(word)
      const room = o.width - hang
      const full = status ? `${status}: ${f.title}` : f.title
      const lines = isOpen ? wrap(full, room, room) : [cutEnd(status || f.title, room)]
      const body = { text: lines[0] ?? '', ...(isDropped ? { dim: true } : {}) }
      const loc = f.path ? `${f.path}${f.line === null ? '' : `:${f.line}`}` : ''
      rows.push({
        key,
        kind: 'finding',
        isOpen,
        label: [`${TAG_WORD[f.tag]} ${loc ? `at ${loc}` : 'with no location'}: ${f.title}`, ...(f.security === null ? [] : [`security: ${f.security}`]), ...(status ? [status] : []), ...(awaits ? ['awaiting re-review'] : []), stateWord(isOpen)].join(', '),
        parts: fit([...prefix, ...word, body], o.width),
        more: lines.slice(1).map(l => `${' '.repeat(hang)}${l}`),
        copy: f.path && f.line !== null ? `${f.path}:${f.line}` : null,
        confidence: f.confidence,
      })
    }
  }
  return rows
}

// The line under an open finding: its confidence, then the `copy path` button's text as the last part, aligned
// with its title and at most `width` columns.
export function confidenceRow(row: TreeRow, width: number): TreePart[] {
  const conf = row.confidence === null ? '' : `confidence ${row.confidence}`
  const button = row.copy === null ? '' : 'copy path'
  const body = [conf, button].filter(Boolean).join('  ')
  if (!body) return []
  const indent = Math.max(0, Math.min(widthOf(row.parts.slice(0, -1)), width - cellWidth(body)))
  return [{ text: `${' '.repeat(indent)}${conf}${conf && button ? '  ' : ''}`, dim: true }, ...(button ? [{ text: button }] : [])]
}

// Key entries after `key: `, wrapping between entries onto lines indented under the first. None, no line.
function keyLines(entries: { glyph: TreePart; word: string }[], width: number): TreePart[][] {
  const key: TreePart[][] = []
  let line: TreePart[] = []
  let w = 0
  for (const m of entries) {
    const entry = cellWidth(`${m.glyph.text} ${m.word}`)
    if (line.length === 0) {
      line = [{ text: 'key: ', dim: true }]
      w = 5
    } else if (w + 2 + entry > width) {
      key.push(line)
      line = [{ text: '     ' }]
      w = 5
    } else {
      line.push({ text: '  ' })
      w += 2
    }
    line.push(m.glyph, { text: ` ${m.word}`, dim: true })
    w += entry
  }
  if (line.length > 0) key.push(line)
  return key
}

// The tree's header, and its key: the marks the view shows, in order, and `! security` while a `!` shows, then on
// their own lines the lead marks the change shows (`✓ built  ○ not yet  ● editing  * unplanned`), the edited row as
// `●` and a live row's `●` too. No mark key when the view has no rows; no header ('') with no view, as in Build; null
// with neither a view nor a change.
export function treeHeader(view: FindingsView | null, width: number, change?: TreeChange | null, edit?: TreeEdit | null): { header: string; key: TreePart[][] } | null {
  if (!view && !change) return null
  const header = view ? `the verifier kept ${view.kept > 0 ? 'these' : 'nothing'} in ${view.unit} ${view.round}` : ''
  const total = countOf(view?.findings ?? [], change?.rereview ?? [])
  const marks = (view ? MARKS : []).filter(m => total[m.field] > 0).map(m => ({ glyph: markPart(m.glyph, m.color), word: m.word }))
  if (view && hasSecurity(total)) marks.push({ glyph: { text: '!', color: 'error' }, word: 'security' })
  const shown = new Set<Progress>((change?.files ?? []).map(f => (edit && f.path === edit.path ? '●' : progressOf(f, change ?? null))))
  if (edit && change) shown.add('●')
  const leads = PROGRESS.filter(m => shown.has(m.glyph)).map(m => ({ glyph: markPart(m.glyph, m.color), word: m.word }))
  return { header, key: [...keyLines(marks, width), ...keyLines(leads, width)] }
}

// The tree's header in Plan (`4 steps · 9 files, 3 new`: the planned files, and how many are new) and in Build
// (`5 of 9 planned files changed · 1 unplanned`, or `3 files changed` with no plan).
export function changeHeader(kind: 'plan' | 'build', change: TreeChange, planSteps: number): string {
  const planned = change.files.filter(f => f.steps.length > 0)
  if (kind === 'plan') {
    const fresh = planned.filter(f => f.letter === 'A').length
    return `${plural(planSteps, 'step')} · ${plural(planned.length, 'file')}${fresh > 0 ? `, ${fresh} new` : ''}`
  }
  const changed = change.files.filter(f => f.added !== null)
  if (!change.hasPlan) return `${plural(changed.length, 'file')} changed`
  const unplanned = changed.filter(f => f.steps.length === 0).length
  return `${planned.filter(f => f.added !== null).length} of ${plural(planned.length, 'planned file')} changed${unplanned > 0 ? ` · ${unplanned} unplanned` : ''}`
}

// How many of the view's open IMPORTANT findings are awaiting re-review.
export const awaitingOf = (view: FindingsView | null, rereview: string[]) => (view ? countOf(view.findings, rereview).awaiting : 0)

// How many of a reviewer's reply's IMPORTANT findings are ones now awaiting re-review, paired as trackFindings
// pairs them: by repo-relative path and Pattern Category.
export function awaitingFrom(reply: string, view: FindingsView | null, rereview: string[], roots: string[]): number {
  const waiting = new Set((view?.findings ?? []).filter(f => isAwaiting(f, rereview)).map(f => `${f.path}\t${category(f.title)}`))
  return keptFindings(reply).filter(k => k.tag === 'IMPORTANT' && waiting.has(`${repoPath(splitLoc(k.loc).path, roots)}\t${category(k.title)}`)).length
}

// The Task card's footprint line once the build has a base: the files changed and their lines (planned-only rows
// and binary lines left out), the latest voted round's kept findings by severity (or `no findings`, or `not
// reviewed yet`), and `as of` the list's commit when HEAD has moved on. `awaiting` of its IMPORTANT findings are
// awaiting re-review (awaitingOf), and read so, as the tree and key read them. Each item's parts, and its words for
// a label.
export function footprint(list: FileList, rounds: Round[], head: string, awaiting = 0): { files: number; parts: TreePart[][]; words: string[] } | null {
  if (list.base === '') return null
  const rows = list.files.filter(f => f.added !== null)
  const added = rows.reduce((n, f) => n + lines(f.added), 0)
  const removed = rows.reduce((n, f) => n + lines(f.removed), 0)
  const item = (text: string, word = text, style: Omit<TreePart, 'text'> = {}) => ({ parts: [{ text, ...style }], word })
  const items: { parts: TreePart[]; word: string }[] = [item(plural(rows.length, 'file'))]
  if (added || removed) items.push({ parts: lineParts(added, removed), word: lineWords(added, removed) })
  const voted = rounds.filter(r => r.findings !== null).at(-1)?.findings
  if (!voted) items.push(item('not reviewed yet', undefined, { dim: true }))
  else if (voted.important + voted.nit + voted.preExisting === 0) items.push(item('no findings', undefined, { color: 'success' }))
  else {
    const waiting = Math.min(awaiting, voted.important)
    if (voted.important > waiting) items.push(item(`${voted.important - waiting} important`, undefined, { color: 'error' }))
    if (waiting) items.push(item(`${waiting} awaiting re-review`, undefined, { color: 'warning' }))
    if (voted.nit) items.push(item(plural(voted.nit, 'nit'), undefined, { dim: true }))
    if (voted.preExisting) items.push(item(`${voted.preExisting} pre`, `${voted.preExisting} pre-existing`, { dim: true }))
  }
  if (isStaleProof(list.head, head)) items.push(item(`as of ${list.head.slice(0, 7)}`, undefined, { dim: true }))
  return { files: rows.length, parts: items.map(i => i.parts), words: items.map(i => i.word) }
}
