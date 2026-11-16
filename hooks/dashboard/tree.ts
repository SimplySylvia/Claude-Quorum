// The findings tree's pure model and layout: join a finding's path to the project root, track kept findings across a
// review's rounds (open, fixed, or dropped on dispute), build the tree of their files, and lay out its rows and key to
// the card's width, with the marks the rows around it share. No `$` here, so tests can call it directly.

import type { Findings, FindingsView, RoundKept, TreeFinding } from '../../types'
import { keptFindings, plural } from './task'

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

export type TreeOptions = { scope: string; width: number; icons: boolean; isHigh: boolean; folds: Record<string, boolean> }

// ---- Paths

const slashes = (text: string) => text.replace(/\\/g, '/')

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
      const seen = { line: x.line, tag: x.f.tag, title: x.f.title, confidence: x.f.confidence, lastSeen: round.n }
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
    const base = { path: it.path, line: it.line, tag: it.tag, title: it.title, confidence: it.confidence }
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

type Counts = Findings & { fixed: number; dropped: number }

const countOf = (fs: TreeFinding[]): Counts => {
  const open = (tag: TreeFinding['tag']) => fs.filter(f => f.state === 'open' && f.tag === tag).length
  return {
    important: open('IMPORTANT'),
    fixed: fs.filter(f => f.state === 'fixed').length,
    nit: open('NIT'),
    preExisting: open('PRE-EXISTING'),
    dropped: fs.filter(f => f.state === 'dropped').length,
  }
}

// The marks, in the order every row and the key use. Dropped findings have none.
const MARKS = [
  { glyph: '✗', field: 'important', word: 'important', color: 'error' },
  { glyph: '✓', field: 'fixed', word: 'fixed this run', color: 'success' },
  { glyph: 'n', field: 'nit', word: 'nit', color: null },
  { glyph: 'p', field: 'preExisting', word: 'pre-existing', color: null },
] as const

const markPart = (glyph: string, color: string | null, text = glyph): TreePart => (color ? { text, color } : { text, dim: true })

// Counts in marks: `✗1 n1 p1`, zero counts left out ('' when all are zero).
export function markText(f: Findings): string {
  return [f.important ? `✗${f.important}` : '', f.nit ? `n${f.nit}` : '', f.preExisting ? `p${f.preExisting}` : ''].filter(Boolean).join(' ')
}

const words = (c: Counts) => [
  c.important ? `${c.important} important` : '',
  c.fixed ? `${c.fixed} fixed` : '',
  c.nit ? plural(c.nit, 'nit') : '',
  c.preExisting ? `${c.preExisting} pre-existing` : '',
  c.dropped ? `${c.dropped} dropped on dispute` : '',
].filter(Boolean)

// Counts in words, for a label: `1 important, 1 nit`, zero counts left out, or `clean`.
export const markWords = (f: Findings) => words({ ...f, fixed: 0, dropped: 0 }).join(', ') || 'clean'

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

// ---- The tree

type FileNode = { path: string; name: string; findings: TreeFinding[] }
type FolderNode = { path: string; name: string; folders: Map<string, FolderNode>; files: Map<string, FileNode> }

function build(findings: TreeFinding[]): { root: FolderNode; other: TreeFinding[] } {
  const root: FolderNode = { path: '', name: '', folders: new Map(), files: new Map() }
  const other: TreeFinding[] = []
  for (const f of findings) {
    const lead = f.path.startsWith('/') ? '/' : ''
    const segs = f.path.slice(lead.length).split('/').filter(s => s !== '')
    const name = segs.pop()
    if (name === undefined) {
      other.push(f)
      continue
    }
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
    if (!file) dir.files.set(fileName, file = { path: `${dir.path}${fileName}`, name: fileName, findings: [] })
    file.findings.push(f)
  }
  return { root, other }
}

const sorted = <T extends { name: string }>(m: Map<string, T>) => [...m.values()].sort((a, b) => byCodePoint(a.name, b.name))

const under = (dir: FolderNode): TreeFinding[] => [...[...dir.folders.values()].flatMap(under), ...[...dir.files.values()].flatMap(f => f.findings)]

const filesUnder = (dir: FolderNode): number => dir.files.size + [...dir.folders.values()].reduce((n, d) => n + filesUnder(d), 0)

type Entry = {
  kind: 'folder' | 'file' | 'other'
  key: string
  path: string
  name: string
  depth: number
  counts: Counts
  files: number
  findings: TreeFinding[]
  isOpen: boolean
  isHidden: boolean
}

const stateWord = (isOpen: boolean) => (isOpen ? 'open' : 'folded')

const TAG_WORD: Record<TreeFinding['tag'], string> = { IMPORTANT: 'important', NIT: 'nit', 'PRE-EXISTING': 'pre-existing' }

// The tree's rows, in order: folders before files, each sorted by name, a folder holding only one folder merged
// with it, and the findings with no location under `other`, last. Rows inside a folded folder or file are left out.
// Folder, file, and `other` rows are `width` wide, ending in one right-aligned column per mark the view has.
export function treeRows(view: FindingsView, o: TreeOptions): TreeRow[] {
  const { root, other } = build(view.findings)
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
      const isOpen = o.folds[key] ?? true
      entries.push({ kind: 'folder', key, path: node.path, name, depth, counts: countOf(under(node)), files: filesUnder(node), findings: [], isOpen, isHidden })
      walk(node, depth + 1, isHidden || !isOpen)
    }
    for (const file of sorted(dir.files)) {
      const key = `${o.scope}:tree:${file.path}`
      const c = countOf(file.findings)
      const isOpen = o.folds[key] ?? (c.important + c.nit + c.preExisting + c.dropped > 0 || (o.isHigh && c.fixed > 0))
      entries.push({ kind: 'file', key, path: file.path, name: file.name, depth, counts: c, files: 1, findings: [...file.findings].sort(byLine), isOpen, isHidden })
    }
  }
  walk(root, 0, false)
  if (other.length > 0) {
    const key = `${o.scope}:tree::other`
    entries.push({ kind: 'other', key, path: ':other', name: 'other', depth: 0, counts: countOf(other), files: 0, findings: other, isOpen: o.folds[key] ?? true, isHidden: false })
  }

  // Columns are measured over every row, folded or not, so a fold never moves one.
  const total = countOf(view.findings)
  const marks = MARKS.filter(m => total[m.field] > 0).map(m => ({
    ...m,
    width: Math.max(...entries.map(e => (e.counts[m.field] ? cellWidth(`${m.glyph}${e.counts[m.field]}`) : 0))),
  }))
  const blockWidth = marks.reduce((n, m) => n + m.width, 0) + 2 * Math.max(0, marks.length - 1)
  const markParts = (c: Counts): TreePart[] => [
    { text: ' '.repeat(Math.max(0, 6 - blockWidth)) },
    ...marks.flatMap((m, i) => {
      const text = c[m.field] ? `${m.glyph}${c[m.field]}` : ''
      return [{ text: `${i > 0 ? '  ' : ''}${' '.repeat(m.width - cellWidth(text))}` }, ...(text ? [markPart(m.glyph, m.color, text)] : [])]
    }),
  ].filter(p => p.text !== '')

  const rows: TreeRow[] = []
  for (const e of entries) {
    if (e.isHidden) continue
    const lead = `${'  '.repeat(e.depth)}${e.kind === 'file' ? (e.isOpen ? '  ' : '▸ ') : e.isOpen ? '▾ ' : '▸ '}`
    const icon = !o.icons || e.kind === 'other' ? null : e.kind === 'folder' ? folderIcon(e.isOpen) : fileIcon(e.name)
    const right: TreePart[] = [...(e.kind === 'folder' ? [{ text: `${plural(e.files, 'file')}  `, dim: true }] : []), ...markParts(e.counts)]
    const room = o.width - widthOf(right) - 1 - cellWidth(lead) - (icon ? 3 : 0)
    const name = e.kind === 'folder' ? cutChain(e.name, room) : e.kind === 'file' ? cutMiddle(e.name, room) : e.name
    const left = fit([{ text: lead }, ...(icon ? [{ text: icon.glyph, color: icon.color }, { text: ' ' }] : []), { text: name }], Math.max(0, o.width - widthOf(right) - 1))
    const gap = Math.max(1, o.width - widthOf(left) - widthOf(right))
    const counts = words(e.counts)
    const label = [e.kind === 'folder' ? `${e.path} folder` : e.kind === 'file' ? e.path : 'other', ...(e.kind === 'folder' ? [plural(e.files, 'file')] : []), ...counts, stateWord(e.isOpen)].join(', ')
    rows.push({ key: e.key, kind: e.kind, isOpen: e.isOpen, label, parts: fit([...left, { text: ' '.repeat(gap) }, ...right], o.width), more: [], copy: null, confidence: null })
    if (e.kind === 'folder' || !e.isOpen) continue

    // Findings sit two columns in from their file's name.
    const indent = ' '.repeat(cellWidth(lead) + (icon ? 3 : 0) + 2)
    const seen = new Map<string, number>()
    for (const f of e.findings) {
      const i = seen.get(String(f.line)) ?? 0
      seen.set(String(f.line), i + 1)
      const key = `${e.key}:${f.line ?? ''}#${i}`
      const isOpen = o.folds[key] ?? false
      const isDropped = f.state === 'dropped'
      const mark = f.state === 'fixed' ? MARKS[1] : f.tag === 'IMPORTANT' ? MARKS[0] : f.tag === 'NIT' ? MARKS[2] : MARKS[3]
      const glyph = isDropped ? { text: '·', dim: true } : markPart(mark.glyph, mark.color)
      const where = f.line === null ? '(no location)' : `:${f.line}`
      const status = f.state === 'fixed' ? `${view.unit} ${f.round} → fixed by ${view.unit} ${f.fixedBy}` : isDropped ? `dropped on dispute in ${view.unit} ${f.round}` : ''
      const prefix: TreePart[] = [{ text: indent, dim: isDropped }, glyph, { text: ` ${where} `, dim: true }]
      const room = o.width - widthOf(prefix)
      const full = status ? `${status}: ${f.title}` : f.title
      const lines = isOpen ? wrap(full, room, room) : [cutEnd(status || f.title, room)]
      const body = { text: lines[0] ?? '', ...(isDropped ? { dim: true } : {}) }
      const loc = f.path ? `${f.path}${f.line === null ? '' : `:${f.line}`}` : ''
      rows.push({
        key,
        kind: 'finding',
        isOpen,
        label: [`${TAG_WORD[f.tag]} ${loc ? `at ${loc}` : 'with no location'}: ${f.title}`, ...(status ? [status] : []), stateWord(isOpen)].join(', '),
        parts: fit([...prefix, body], o.width),
        more: lines.slice(1).map(l => `${' '.repeat(widthOf(prefix))}${l}`),
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

// The tree's header, and its key: the marks the view shows, in order, after `key: `, wrapping between entries onto
// lines indented under the first. No key when the view has no rows.
export function treeHeader(view: FindingsView | null, width: number): { header: string; key: TreePart[][] } | null {
  if (!view) return null
  const header = `the verifier kept ${view.kept > 0 ? 'these' : 'nothing'} in ${view.unit} ${view.round}`
  const total = countOf(view.findings)
  const key: TreePart[][] = []
  let line: TreePart[] = []
  let w = 0
  for (const m of MARKS.filter(m => total[m.field] > 0)) {
    const entry = cellWidth(`${m.glyph} ${m.word}`)
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
    line.push(markPart(m.glyph, m.color), { text: ` ${m.word}`, dim: true })
    w += entry
  }
  if (line.length > 0) key.push(line)
  return { header, key }
}
