#!/usr/bin/env python3
"""Draw the README's diagrams, each in a light and a dark version from one layout so the two never drift apart.

- assets/agent-map-*.svg: which agents each Quorum command starts, when, and the loops that send work back.
- assets/risk-tiers-*.svg: which layers each risk tier gets.
- assets/review-loop-*.svg: one round of the review loop and where it can end.
- assets/swiss-cheese-*.svg: an animation of the layers, each catching the defect the others let through.
- assets/stages-*.svg: an animation of one task moving through the stages, with the stages that send work back.
- assets/run-*.svg: what /quorum:run chains, and every place it stops to ask you.

Run it again after adding, renaming, or rewiring an agent, or changing what a tier gets:
    python3 assets/src/diagrams.py
"""
import os
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
W = 980
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

# GitHub's own light and dark palettes, plus the teal and red the README's animations use.
THEMES = {
    "light": dict(fg="#1f2328", muted="#59636e", line="#d1d9e0", band="#f6f8fa", chip="#ffffff",
                  doc="#eef1f4", go="#0f8a7e", back="#cf222e",
                  low="#1a7f37", medium="#9a6700", high="#cf222e",
                  page="#ffffff", cheese="#fff8c5", rind="#d4a72c", escape="#bc4c00"),
    "dark": dict(fg="#f0f6fc", muted="#9198a1", line="#3d444d", band="#151b23", chip="#0d1117",
                 doc="#212830", go="#3fb9a6", back="#f85149",
                  low="#3fb950", medium="#d29922", high="#f85149",
                  page="#0d1117", cheese="#272115", rind="#9e6a03", escape="#db6d28"),
}

LABEL, TAG = 13, 11          # font sizes: chip label, the small "when it runs" tag under it
CHIP_H, ARROW = 32, 20       # chip height, horizontal arrow length between chips
TAG_H = 17                   # room under a chip for its tag
LEFT, CONTENT, RIGHT = 20, 226, 912   # band edges and where chips start
LANE_IN, LANE_OUT = 934, 960          # right-margin lanes for the loops that send work back


def text_w(s, size):
    """Rough width of proportional text; generous so labels never overflow their chips."""
    narrow = sum(1 for c in s if c in "il.,:;'|·/ ")
    return (len(s) - narrow) * size * 0.57 + narrow * size * 0.3


def mono_w(s, size):
    """Width of monospaced text: every character takes about 0.6 of the font size."""
    return len(s) * size * 0.62


def chip_w(label, tag):
    return max(text_w(label, LABEL) + 20, text_w(tag, TAG) + 12 if tag else 0)


class Svg:
    def __init__(self, t):
        self.t, self.parts = t, []

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, s, size=LABEL, color="fg", weight=400, anchor="start", mono=False, rotate=False):
        fam = MONO if mono else FONT
        rot = f' transform="rotate(-90 {x:.1f} {y:.1f})"' if rotate else ""
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
                 f'fill="{self.t[color]}" text-anchor="{anchor}"{rot}>{escape(s)}</text>')

    def rect(self, x, y, w, h, fill, stroke="line", r=8, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" '
                 f'fill="{self.t[fill]}" stroke="{self.t[stroke]}"{d}/>')

    def arrow(self, d, color="go"):
        self.add(f'<path d="{d}" fill="none" stroke="{self.t[color]}" stroke-width="1.6" '
                 f'stroke-linejoin="round" marker-end="url(#arrow-{color})"/>')

    def chip(self, x, y, label, tag=None, doc=False):
        """An agent, or with doc=True a file or step. Returns its width."""
        w = chip_w(label, tag)
        self.rect(x, y, w, CHIP_H, "doc" if doc else "chip", dash="4 3" if doc else None)
        self.text(x + w / 2, y + 21, label, anchor="middle", weight=400 if doc else 600)
        if tag:
            self.text(x + w / 2, y + CHIP_H + 14, tag, size=TAG, color="muted", anchor="middle")
        return w

    def row(self, x, y, items):
        """Chips left to right, joined by arrows. items: (label, tag, doc). Returns the right edge."""
        for i, (label, tag, doc) in enumerate(items):
            if i:
                self.arrow(f"M{x - ARROW + 3:.1f},{y + CHIP_H / 2} H{x - 3:.1f}")
            x += self.chip(x, y, label, tag, doc) + ARROW
        return x - ARROW

    def svg(self, h, label):
        defs = "".join(
            f'<marker id="arrow-{c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
            f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{self.t[c]}"/></marker>'
            for c in ("go", "back"))
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{h}" viewBox="0 0 {W} {h}" '
                f'role="img" aria-label="{escape(label)}"><defs>{defs}</defs>{"".join(self.parts)}</svg>\n')


def draw_map(theme):
    s = Svg(THEMES[theme])
    bands, y = {}, 14

    def band(key, num, title, cmd, h, notes=()):
        nonlocal y
        s.rect(LEFT, y, RIGHT - LEFT, h, "band", r=12)
        s.text(LEFT + 18, y + 30, num, size=20, weight=700, color="muted")
        s.text(LEFT + 18, y + 52, title, size=15, weight=700)
        s.text(LEFT + 18, y + 71, cmd, size=11.5, color="muted", mono=True)
        for i, note in enumerate(notes):
            s.text(LEFT + 18, y + 90 + i * 15, note, size=TAG, color="muted")
        bands[key] = (y, h)
        top, y = y, y + h + 28
        return top

    def group(x, y, w, h, label):
        s.rect(x, y, w, h, "band", dash="4 3")
        s.text(x + 12, y + 17, label, size=TAG, color="muted")

    # 0 · Bootstrap: once per repo, no agents.
    t = band("init", "0", "Bootstrap", "/quorum:init-pipeline", 100, ["once per repo"])
    s.row(CONTENT, t + 28, [("CLAUDE.md: Verification Commands", "your stack's checks", True),
                            ("REVIEW.md", "review rules", True),
                            (".claude/hooks/verify-completion.sh", "the fast checks", True)])

    # 1 · Spec & eval: research, the spec, then two spec reviewers in parallel.
    t = band("spec", "1", "Spec & eval", "/quorum:spec-and-eval", 148, ["--bug: reproduce it first",
                                                                       "--deep-research: lenses"])
    cy = t + 34
    x = s.row(CONTENT, cy, [("researcher", "MEDIUM/HIGH, or --research", False),
                            ("rd.md + eval.md", "linted; every check tried once", True)])
    gx = x + ARROW
    s.arrow(f"M{x + 3:.1f},{cy + CHIP_H / 2} H{gx - 3:.1f}")
    reviewers = [("spec-reviewer: feasibility", "does the spec match the code?"),
                 ("spec-reviewer: improver", "clear, testable, covered?")]
    gw = max(chip_w(*r) for r in reviewers) + 24
    group(gx, t + 10, gw, 130, "in parallel")
    for i, (label, tag) in enumerate(reviewers):
        s.chip(gx + 12, t + 34 + i * 52, label, tag)

    # 2 · Plan: the planner writes plan.md, the same reviewers as the review loop check it, then you approve it.
    t = band("plan", "2", "Plan", "/quorum:plan", 204, ["before any code exists"])
    py = t + 40
    pw = s.chip(CONTENT, py, "planner", "writes and revises the plan")
    dx = CONTENT + pw + ARROW
    s.arrow(f"M{CONTENT + pw + 3:.1f},{py + CHIP_H / 2} H{dx - 3:.1f}")
    dw = s.chip(dx, py, "plan.md", "files, reuse, tests, docs, a11y", doc=True)
    vx = RIGHT - 14 - chip_w("you approve", "status BUILDING") - ARROW - chip_w("verifier-voter", "drops false alarms")
    vw = s.chip(vx, py, "verifier-voter", "drops false alarms")
    ax = vx + vw + ARROW
    s.arrow(f"M{vx + vw + 3:.1f},{py + CHIP_H / 2} H{ax - 3:.1f}")
    s.chip(ax, py, "you approve", "status BUILDING", doc=True)
    plan_reviewers = [("logic", "always"), ("architecture", "MEDIUM/HIGH"), ("patterns", "MEDIUM/HIGH"),
                      ("docs", "MEDIUM/HIGH, or docs"), ("tests", "plan adds tests"), ("a11y", "UI work"),
                      ("security", "HIGH")]
    gy = py + CHIP_H + TAG_H + 16
    widths = [chip_w(*r) for r in plan_reviewers]
    gw = sum(widths) + 8 * (len(widths) - 1) + 24
    group(CONTENT, gy, gw, 82, "the review loop's reviewers, in plan mode, in parallel")
    cx = CONTENT + 12
    for (label, tag), w in zip(plan_reviewers, widths):
        s.chip(cx, gy + 26, label, tag)
        cx += w + 8
    s.arrow(f"M{dx + dw / 2:.1f},{py + CHIP_H + TAG_H + 2} V{gy - 3}")
    s.arrow(f"M{vx + vw / 2:.1f},{gy} V{py + CHIP_H + TAG_H + 5}")
    s.arrow(f"M{vx + vw / 2 - 20:.1f},{py - 2} V{t + 16} H{CONTENT + pw / 2:.1f} V{py - 3}", color="back")
    s.text((CONTENT + pw / 2 + vx + vw / 2 - 20) / 2, t + 12, "IMPORTANT left: the planner revises (2 rounds at most)",
           size=TAG, color="back", anchor="middle")

    # 3 · Build: the builder, from the plan, then the prover's proof.
    t = band("build", "3", "Build", "/quorum:build", 130, ["then /quorum:simplify-diff",
                                                         "--worktree: in its own worktree",
                                                         "4+ steps: a builder per step"])
    s.row(CONTENT, t + 28, [("builder", "test first; checks locked, must pass", False),
                            ("prover", "runs every eval.md check", False)])

    # 3–4 · Review loop: reviewers in parallel, the voter, and the builder's fixes.
    t = band("review", "4–5", "Review loop", "/quorum:review-loop", 252,
             ["up to 3 rounds,", "new lines only each round"])
    reviewers = [("code-reviewer: logic", "always"), ("code-reviewer: architecture", "MEDIUM/HIGH"),
                 ("pattern-auditor", "MEDIUM/HIGH"), ("docs-auditor", "MEDIUM/HIGH, or docs change"),
                 ("code-reviewer: tests", "tests change"), ("a11y-auditor: diff", "UI change")]
    cw = max(chip_w(*r) for r in reviewers)
    gx, gy, gw = CONTENT, t + 12, 2 * cw + 36
    group(gx, gy, gw, 228, "reviewers in parallel, checking the code against the plan")
    for i, (label, tag) in enumerate(reviewers):
        cx = gx + 12 + (i % 2) * (cw + 12)
        s.chip(cx + (cw - chip_w(label, tag)) / 2, gy + 30 + (i // 2) * 66, label, tag)
    vx, vy = gx + gw + ARROW + 6, gy + 44
    s.arrow(f"M{gx + gw + 3:.1f},{vy + CHIP_H / 2} H{vx - 3:.1f}")
    vw = s.chip(vx, vy, "verifier-voter", "keeps or drops each finding")
    fy = vy + 104
    fw = s.chip(vx, fy, "builder: fix", "every surviving Pattern Category")
    mid = vx + min(vw, fw) / 2
    s.arrow(f"M{mid:.1f},{vy + CHIP_H + TAG_H + 4} V{fy - 3}", color="back")
    s.text(mid + 8, vy + CHIP_H + TAG_H + 30, "IMPORTANT left", size=TAG, color="back")
    s.arrow(f"M{vx - 3:.1f},{fy + CHIP_H / 2} H{gx + gw + 3:.1f}", color="back")

    # 5 · Security & blind test.
    t = band("blind", "6", "Security & blind test", "/quorum:blind-test", 100, ["MEDIUM/HIGH only"])
    s.row(CONTENT, t + 28, [("security-reviewer", "HIGH", False), ("blind-user", "can't read source", False),
                            ("a11y-auditor: live", "UI change", False), ("friction-triager", "if friction", False),
                            ("prover", "no blockers", False)])

    # 7 · Human gate and PR (6, retro or codify-lesson, is optional and starts no agents).
    t = band("ship", "8", "Human gate & PR", "/quorum:pr-draft", 100, ["7 · retro, codify-lesson:", "optional"])
    s.row(CONTENT, t + 28, [("pr-writer", "cites each requirement's verdict", False),
                            ("you review and merge", "MEDIUM/HIGH wait for you", True)])

    # Any diff: /quorum:review, apart from the task stages (no spine arrow joins it).
    t = band("anydiff", "", "Review any diff", "/quorum:review", 150, ["no task needed,", "one round"])
    ry = t + 28
    right = s.row(CONTENT, ry, [("the review loop's reviewers", "by tier; + security for HIGH", False),
                                ("verifier-voter", "keeps or drops each finding", False),
                                ("builder: fix", "--fix; checks must pass", False)])
    vx = CONTENT + chip_w("the review loop's reviewers", "by tier; + security for HIGH") + ARROW
    vw = chip_w("verifier-voter", "keeps or drops each finding")
    gy = ry + CHIP_H + TAG_H + 22
    s.arrow(f"M{vx + vw / 2:.1f},{ry + CHIP_H + TAG_H + 2} V{gy - 3}")
    s.chip(vx + (vw - chip_w("GitHub review", "--comment, after you approve")) / 2, gy, "GitHub review",
           "--comment, after you approve", doc=True)

    # Research a question: /quorum:research, before any task (also --deep-research inside the spec stage).
    t = band("research", "", "Research a question", "/quorum:research", 216, ["no task; you approve",
                                                                               "the sub-questions"])
    qy = t + 34
    lenses = [("researcher: repo", "never told what's built"), ("researcher: docs", "pinned versions"),
              ("researcher: alternatives", "prior art"), ("researcher: counter", "against the leader")]
    lw = max(chip_w(*r) for r in lenses)
    group(CONTENT, t + 10, lw * 2 + 32, 140, "in parallel, by effort: 2, 3, or up to 6")
    for i, (label, tag) in enumerate(lenses):
        s.chip(CONTENT + 12 + (i % 2) * (lw + 8), qy + (i // 2) * 52, label, tag)
    rx = CONTENT + lw * 2 + 32 + ARROW
    s.arrow(f"M{CONTENT + lw * 2 + 35:.1f},{qy + CHIP_H / 2} H{rx - 3:.1f}")
    col = max(chip_w("quorum-research-check", "re-finds every repo quote"),
              chip_w("source-verifier", "reopens the pages that matter"),
              chip_w("research.md", "viability, candidate tasks, gaps"))
    for i, (label, tag, doc) in enumerate((("quorum-research-check", "re-finds every repo quote", True),
                                           ("source-verifier", "reopens the pages that matter", False),
                                           ("research.md", "viability, candidate tasks, gaps", True))):
        cy = qy + i * 64
        s.chip(rx + (col - chip_w(label, tag)) / 2, cy, label, tag, doc=doc)
        if i:
            s.arrow(f"M{rx + col / 2:.1f},{cy - 64 + CHIP_H + TAG_H + 2} V{cy - 3}")

    # Map a large effort: /quorum:map, before any task; a cleared map hands its tasks to the spec stage.
    t = band("map", "", "Map a large effort", "/quorum:map", 240, ["plans only: a hook", "blocks building"])
    my, step = t + 28, CHIP_H + TAG_H + 22
    s.row(CONTENT, my, [("grilling rounds", "destination, then breadth", True),
                        ("researcher", "per research ticket; deep if weighty", False),
                        ("quorum-map check", "no cycles, full index", True)])
    s.row(CONTENT, my + step, [("researcher: facts", "before a code question", False),
                               ("you decide", "one ticket per run", True),
                               ("spec-reviewer: decision", "checks it against the code", False)])
    s.row(CONTENT, my + 2 * step, [("tasks.md", "once cleared", True),
                                   ("reviewers: map mode", "architecture, patterns, security", False),
                                   ("verifier-voter", "you approve", False),
                                   ("--from-map", "once blockers merge", True)])

    # Forward flow between bands, down the left of the content column.
    spine = CONTENT - 20
    for upper, lower, label in (("init", "spec", None), ("spec", "plan", "IMPORTANT spec findings fixed"),
                                ("plan", "build", "plan approved"), ("build", "review", None),
                                ("review", "blind", "converged · LOW: prover, then READY"), ("blind", "ship", None)):
        uy, uh = bands[upper]
        s.arrow(f"M{spine},{uy + uh - 8} V{bands[lower][0] + 8}")
        if label:
            s.text(spine + 10, uy + uh + 18, label, size=TAG, color="go", weight=600)

    # Loops that send work back, outside the bands so they never cross a chip.
    ry, rh = bands["review"]
    by, bh = bands["blind"]
    sy, sh = bands["spec"]
    enter = ry + rh - 18
    s.arrow(f"M{RIGHT},{by + bh / 2} H{LANE_IN} V{enter} H{RIGHT + 3}", color="back")
    s.text(LANE_IN + 14, (by + bh / 2 + enter) / 2, "blockers", size=TAG, color="back", anchor="middle", rotate=True)
    leave = ry + 40
    s.arrow(f"M{RIGHT},{leave} H{LANE_OUT} V{sy + sh / 2} H{RIGHT + 3}", color="back")
    s.text(LANE_OUT + 14, (leave + sy + sh / 2) / 2, "HALTED after round 3 → redesign", size=TAG, color="back",
           anchor="middle", rotate=True)

    # Legend
    ly = y + 2
    s.arrow(f"M{LEFT + 4},{ly + 6} H{LEFT + 32}")
    s.text(LEFT + 40, ly + 10, "moves the task forward", size=TAG + 0.5, color="muted")
    s.arrow(f"M{LEFT + 212},{ly + 6} H{LEFT + 240}", color="back")
    s.text(LEFT + 248, ly + 10, "sends work back", size=TAG + 0.5, color="muted")
    s.rect(LEFT + 392, ly - 3, 26, 18, "chip", r=5)
    s.text(LEFT + 426, ly + 10, "agent", size=TAG + 0.5, color="muted")
    s.rect(LEFT + 490, ly - 3, 26, 18, "doc", r=5, dash="4 3")
    s.text(LEFT + 524, ly + 10, "file or step", size=TAG + 0.5, color="muted")
    s.text(LEFT + 632, ly + 10, "grey text under a chip: when it runs", size=TAG + 0.5, color="muted")
    ly += 24
    s.text(LEFT + 4, ly + 10, "/quorum:run", size=TAG + 0.5, mono=True, weight=600)
    s.text(LEFT + 4 + mono_w("/quorum:run", TAG + 0.5) + 8, ly + 10,
           "follows bands 1 to 8 in order by itself, stopping only where you decide (see the run diagram)",
           size=TAG + 0.5, color="muted")
    return s.svg(int(ly + 26), "Quorum agent map: the agents each command starts, when they run, the loops "
                                "that send work back, /quorum:review for any diff, /quorum:research, and "
                                "/quorum:map for an effort too big for one task")


def wrap(text, size, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and text_w(trial, size) > width:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + [line]


# What each tier gets. Each row: (layer, [(mark, detail) for LOW, MEDIUM, HIGH]); mark is yes, some, or no.
TIERS = [
    ("LOW", "low", "A user can't reach it",
     "Copy and docs, isolated tests, internal refactors, code behind an off-by-default flag"),
    ("MEDIUM", "medium", "Anything a user can see or run",
     "A user-facing workflow, a command, flag, endpoint, page, or output format, state logic"),
    ("HIGH", "high", "Data, money, or security at stake",
     "Auth, money, deleting or migrating data, security boundaries, core state machines, build pipelines"),
]
LAYERS = [
    ("Research", [("some", "only with --research"), ("yes", "repo precedent + docs"), ("yes", "repo precedent + docs")]),
    ("Spec review", [("yes", "2 spec reviewers"), ("yes", "2 spec reviewers"), ("yes", "2 spec reviewers")]),
    ("Plan review", [("some", "1 reviewer, +1 per tests/UI/docs"), ("yes", "4–6 reviewers + voter"),
                     ("yes", "5–7, with security")]),
    ("Code review", [("some", "1 reviewer, +1 per tests/UI/docs change"), ("yes", "4–6 reviewers + voter"),
                     ("yes", "4–6 reviewers + voter")]),
    ("Security pass", [("no", "none"), ("some", "if security_on_medium"), ("yes", "every finding blocks")]),
    ("Blind test", [("no", "none"), ("yes", "+ live a11y, friction triage"), ("yes", "+ live a11y, friction triage")]),
    ("Human review", [("no", "not needed if green"), ("some", "focused review"), ("yes", "architectural sign-off")]),
]


def draw_tiers(theme):
    s = Svg(THEMES[theme])
    t = THEMES[theme]
    gap, top, cw = 16, 8, (W - 2 * LEFT - 2 * 16) / 3
    head, row_h = 124, 44
    ch = head + len(LAYERS) * row_h + 10
    for i, (name, color, breaks, typical) in enumerate(TIERS):
        x = LEFT + i * (cw + gap)
        s.rect(x, top, cw, ch, "band", r=12)
        s.add(f'<rect x="{x:.1f}" y="{top}" width="{cw:.1f}" height="5" rx="2.5" fill="{t[color]}"/>')
        s.text(x + 18, top + 36, name, size=20, weight=700, color=color)
        s.text(x + 18, top + 58, breaks, size=13, weight=600)
        for j, line in enumerate(wrap(typical, TAG + 0.5, cw - 36)[:3]):
            s.text(x + 18, top + 78 + j * 15, line, size=TAG + 0.5, color="muted")
        for k, (layer, marks) in enumerate(LAYERS):
            mark, detail = marks[i]
            ry = top + head + k * row_h
            s.add(f'<line x1="{x + 14:.1f}" y1="{ry:.1f}" x2="{x + cw - 14:.1f}" y2="{ry:.1f}" stroke="{t["line"]}"/>')
            cx, cy = x + 28, ry + 22
            if mark == "yes":
                s.add(f'<circle cx="{cx:.1f}" cy="{cy}" r="9" fill="{t["go"]}"/>'
                      f'<path d="M{cx - 4:.1f},{cy} l3,3 l5,-6" fill="none" stroke="{t["chip"]}" stroke-width="2" '
                      f'stroke-linecap="round" stroke-linejoin="round"/>')
            elif mark == "some":
                s.add(f'<circle cx="{cx:.1f}" cy="{cy}" r="8" fill="none" stroke="{t["go"]}" stroke-width="2"/>'
                      f'<path d="M{cx:.1f},{cy - 8} a8,8 0 0,1 0,16 z" fill="{t["go"]}"/>')
            else:
                s.add(f'<circle cx="{cx:.1f}" cy="{cy}" r="8.5" fill="none" stroke="{t["line"]}" stroke-width="1.5"/>'
                      f'<path d="M{cx - 4:.1f},{cy} h8" stroke="{t["muted"]}" stroke-width="2" stroke-linecap="round"/>')
            s.text(x + 46, ry + 18, layer, size=12.5, weight=600, color="fg" if mark != "no" else "muted")
            s.text(x + 46, ry + 34, detail, size=TAG, color="muted")
    ly = top + ch + 22
    for j, (mark, label) in enumerate((("yes", "always"), ("some", "partly, or only sometimes"), ("no", "never"))):
        lx = LEFT + 4 + j * 150 + (40 if j > 1 else 0)
        if mark == "yes":
            s.add(f'<circle cx="{lx + 8}" cy="{ly}" r="7" fill="{t["go"]}"/>')
        elif mark == "some":
            s.add(f'<circle cx="{lx + 8}" cy="{ly}" r="6.5" fill="none" stroke="{t["go"]}" stroke-width="2"/>'
                  f'<path d="M{lx + 8},{ly - 6.5} a6.5,6.5 0 0,1 0,13 z" fill="{t["go"]}"/>')
        else:
            s.add(f'<circle cx="{lx + 8}" cy="{ly}" r="7" fill="none" stroke="{t["line"]}" stroke-width="1.5"/>')
        s.text(lx + 22, ly + 4, label, size=TAG + 0.5, color="muted")
    s.text(W - LEFT, ly + 4, "When in doubt between two tiers, Quorum picks the higher one.", size=TAG + 0.5,
           color="muted", anchor="end")
    ly += 24
    s.text(LEFT + 4, ly + 4, "/quorum:run --fast", size=TAG + 0.5, mono=True, weight=600)
    s.text(LEFT + 4 + mono_w("/quorum:run --fast", TAG + 0.5) + 8, ly + 4,
           "LOW only: no spec reviewers and no plan round, 1 code reviewer + voter; the checks and the proof stay.",
           size=TAG + 0.5, color="muted")
    return s.svg(int(ly + 16), "Quorum risk tiers: what LOW, MEDIUM, and HIGH tasks get. /quorum:run --fast gives "
                 "a LOW task no spec reviewers, no plan round, and one code reviewer plus the voter.")


def draw_loop(theme):
    s = Svg(THEMES[theme])
    t = THEMES[theme]
    w = 780
    cx, bw = 290, 350                     # main column centre and box width
    bx = cx - bw / 2
    ox, ow = 510, 250                     # outcome boxes on the right
    lane = 48                             # left lane for the "next round" loop

    def box(y, title, sub, fill="chip", stroke="line", dash=None, x=bx, width=bw, color="fg"):
        s.rect(x, y, width, 50, fill, stroke=stroke, dash=dash)
        s.text(x + width / 2, y + 21, title, weight=700, anchor="middle", color=color)
        s.text(x + width / 2, y + 38, sub, size=TAG, color="muted", anchor="middle")

    def down(y1, y2, color="go", label=None):
        s.arrow(f"M{cx},{y1 + 2} V{y2 - 3}", color=color)
        if label:
            s.text(cx + 8, (y1 + y2) / 2 + 4, label, size=TAG, color=color, weight=600)

    def diamond(y, label):
        hw, hh = 92, 32
        s.add(f'<polygon points="{cx},{y} {cx + hw},{y + hh} {cx},{y + 2 * hh} {cx - hw},{y + hh}" '
              f'fill="{t["chip"]}" stroke="{t["line"]}"/>')
        s.text(cx, y + hh + 4.5, label, size=12.5, weight=700, anchor="middle")
        return y + hh, y + 2 * hh

    y = 14
    box(y, "Pick the diff range", "round 1: the whole branch · later: only new lines",
        fill="doc", dash="4 3")
    range_mid = y + 25
    down(y + 50, y + 76)
    y += 76
    gh = 150
    s.rect(bx - 30, y, bw + 60, gh, "band", dash="4 3")
    s.text(bx - 18, y + 18, "reviewers in parallel, each with a fresh context", size=TAG, color="muted")
    chips = [("logic", "always"), ("architecture", "MEDIUM/HIGH"), ("patterns", "MEDIUM/HIGH"),
             ("docs", "MEDIUM/HIGH, or docs"), ("tests", "tests change"), ("a11y", "UI change")]
    colw = (bw + 36) / 3
    for i, (label, tag) in enumerate(chips):
        ccx = bx - 18 + colw * (i % 3) + colw / 2
        cy = y + 30 + (i // 3) * 58
        cw = chip_w(label, tag)
        s.chip(ccx - cw / 2, cy, label, tag)
    down(y + gh, y + gh + 26)
    y += gh + 26
    box(y, "verifier-voter", "opens each cited file:line, drops false alarms")
    down(y + 50, y + 76)
    y += 76
    mid, bottom = diamond(y, "IMPORTANT left?")
    s.arrow(f"M{cx + 92},{mid} H{ox - 3}")
    s.text(cx + 104, mid - 7, "no", size=TAG, color="go", weight=600)
    s.rect(ox, mid - 34, ow, 68, "chip", stroke="go")
    s.text(ox + ow / 2, mid - 12, "CONVERGED", weight=700, anchor="middle", color="go")
    s.text(ox + ow / 2, mid + 6, "LOW: prover, then READY", size=TAG, color="muted", anchor="middle")
    s.text(ox + ow / 2, mid + 21, "MEDIUM/HIGH: on to /quorum:blind-test", size=TAG, color="muted", anchor="middle")
    down(bottom, bottom + 30, color="back", label="yes")
    y = bottom + 30
    mid, bottom = diamond(y, "Round 3 done?")
    s.arrow(f"M{cx + 92},{mid} H{ox - 3}", color="back")
    s.text(cx + 104, mid - 7, "yes", size=TAG, color="back", weight=600)
    s.rect(ox, mid - 34, ow, 68, "chip", stroke="back")
    s.text(ox + ow / 2, mid - 12, "HALTED", weight=700, anchor="middle", color="back")
    s.text(ox + ow / 2, mid + 6, "post-mortem and two redesigns", size=TAG, color="muted", anchor="middle")
    s.text(ox + ow / 2, mid + 21, "then /quorum:spec-and-eval --redesign", size=TAG, color="muted", anchor="middle")
    down(bottom, bottom + 30, color="back", label="no")
    y = bottom + 30
    box(y, "builder: fix", "every instance of each Pattern Category")
    fix_mid = y + 25
    s.arrow(f"M{bx - 3},{fix_mid} H{lane} V{range_mid} H{bx - 3}", color="back")
    s.text(lane - 10, (range_mid + fix_mid) / 2, "next round", size=TAG, color="back", anchor="middle",
           rotate=True)
    s.arrow(f"M{ox + ow},{fix_mid} H{bx + bw + 3}", color="back")
    s.text(ox + ow, fix_mid - 8, "blind-test blockers: fixed first", size=TAG, color="back", anchor="end")
    h = int(y + 50 + 14)
    return (s.svg(h, "One round of the Quorum review loop: pick the diff range, reviewers in parallel, the "
                     "verifier-voter, then converged, halted after round 3, or a builder fix and another round")
            .replace(f'width="{W}" height="{h}" viewBox="0 0 {W} {h}"', f'width="{w}" height="{h}" viewBox="0 0 {w} {h}"'))


# The Swiss cheese layers, and one defect each layer exists to catch. stop is the layer that catches it (None: it
# escapes); start is the layer it first appears after (the false alarm comes from the reviewers).
LAYERS_SC = ["Spec review", "Plan review", "Checks & proof", "Reviewers", "Voter", "Security pass", "Blind test", "Human gate"]
DEFECTS = [
    ("A spec that can't meet its goal", 0, -1, "back"),
    ("A plan that rebuilds a helper or skips docs", 1, -1, "back"),
    ("Failing test or type error", 2, -1, "back"),
    ("Regression test that can't fail", 2, -1, "back"),
    ("Unhandled edge case", 3, -1, "back"),
    ("False alarm from a reviewer", 4, 3, "muted"),
    ("Missing auth check", 5, -1, "back"),
    ("Dead-end screen or keyboard trap", 6, -1, "back"),
    ("Right code, wrong design", 7, -1, "back"),
    ("Holes line up: it escapes", None, -1, "escape"),
]


def draw_cheese(theme):
    s = Svg(THEMES[theme])
    t = THEMES[theme]
    x0, gap, slab, top, row = 334, 78, 32, 92, 36
    lx = [x0 + i * gap for i in range(len(LAYERS_SC))]
    end_x = lx[-1] + 86
    bottom = top + len(DEFECTS) * row
    cycle, speed = 18.0, 300.0             # seconds per loop, pixels per second
    hold_end, fade_end = cycle - 1.4, cycle - 0.6

    # Layers: tall slabs with a hole wherever a defect's path passes, plus a few that lead nowhere.
    for i, (x, name) in enumerate(zip(lx, LAYERS_SC)):
        s.text(x, 34, str(i + 1), size=13, weight=700, anchor="middle")
        s.text(x, 52, name, size=TAG, color="muted", anchor="middle")
        s.rect(x - slab / 2, top - 26, slab, bottom - top + 30, "cheese", stroke="rind", r=12)
        for k, (_, stop, start, _) in enumerate(DEFECTS):
            y = top + k * row
            passes = (stop is None or i < stop) and i > start
            if passes:
                s.add(f'<ellipse cx="{x}" cy="{y}" rx="11" ry="9" fill="{t["page"]}" stroke="{t["rind"]}" '
                      f'stroke-opacity=".35"/>')
        for k in range(len(DEFECTS) - 1):
            if (i * 3 + k) % 7 == 0:
                s.add(f'<circle cx="{x + (5 if k % 2 else -5)}" cy="{top + k * row + row / 2}" r="4" '
                      f'fill="{t["page"]}" stroke="{t["rind"]}" stroke-opacity=".35"/>')

    css = ["svg .dot, svg .ring { transform-box: fill-box; transform-origin: center; }"]
    reduced = []
    for k, (label, stop, start, color) in enumerate(DEFECTS):
        y = top + k * row
        s.text(x0 - 82, y + 4, label, size=12.5, anchor="end", color="muted" if color == "muted" else "fg")
        sx = (lx[start] + slab / 2 + 16) if start >= 0 else x0 - 66
        ex = end_x if stop is None else lx[stop] - slab / 2 - 8
        s.add(f'<line x1="{sx}" y1="{y}" x2="{ex}" y2="{y}" stroke="{t["line"]}" stroke-dasharray="2 5"/>')
        dx = ex - sx
        t0 = 0.5 + k * 1.35
        t1 = t0 + dx / speed
        pct = lambda sec: f"{100 * sec / cycle:.2f}%"
        css.append(
            f"@keyframes m{k} {{ 0%, {pct(t0)} {{ transform: translateX(0); opacity: 0; }} "
            f"{pct(t0 + 0.25)} {{ opacity: 1; animation-timing-function: cubic-bezier(.45,0,.25,1); }} "
            f"{pct(t1)} {{ transform: translateX({dx:.1f}px); opacity: 1; }} "
            + ("" if stop is None else
               f"{pct(t1 + 0.12)} {{ transform: translateX({dx - 5:.1f}px); }} "
               f"{pct(t1 + 0.3)} {{ transform: translateX({dx:.1f}px); }} "
               f"{pct(t1 + 0.9)} {{ opacity: .55; }} ")
            + f"{pct(hold_end)} {{ transform: translateX({dx:.1f}px); opacity: {1 if stop is None else .55}; }} "
            f"{pct(fade_end)}, 100% {{ transform: translateX({dx:.1f}px); opacity: 0; }} }}")
        css.append(f".d{k} {{ animation: m{k} {cycle}s infinite; }}")
        ring = "go" if color == "back" else color
        css.append(
            f"@keyframes r{k} {{ 0%, {pct(t1 - 0.01)} {{ opacity: 0; transform: scale(.6); }} "
            f"{pct(t1 + 0.05)} {{ opacity: .9; transform: scale(1); }} "
            f"{pct(t1 + 0.9)}, 100% {{ opacity: 0; transform: scale(2.2); }} }}")
        css.append(f".r{k} {{ animation: r{k} {cycle}s infinite; }}")
        reduced.append(f".d{k} {{ animation: none; transform: translateX({dx:.1f}px); "
                       f"opacity: {1 if stop is None else .7}; }} .r{k} {{ animation: none; opacity: 0; }}")
        s.add(f'<circle class="ring r{k}" cx="{ex}" cy="{y}" r="11" fill="none" stroke="{t[ring]}" '
              f'stroke-width="2" opacity="0"/>')
        s.add(f'<circle class="dot d{k}" cx="{sx}" cy="{y}" r="8" fill="{t[color]}" opacity="0"/>')
        if stop is None:
            s.text(W - 6, y - 16, "rollback plan", size=TAG, weight=600, color="escape", anchor="end")
    css.append("@media (prefers-reduced-motion: reduce) { " + " ".join(reduced) + " }")
    s.add("<style>" + " ".join(css) + "</style>")

    cap = bottom + 32
    s.text(W / 2, cap, "Each defect travels right until a layer has no hole in its path. Grey is noise the voter "
           "filters, not a bug.", size=TAG + 0.5, color="muted", anchor="middle")
    return s.svg(int(cap + 14), "Animation: eight layers (spec review, plan review, checks and proof, reviewers, "
                 "voter, security pass, blind test, human gate), each stopping a different kind of defect; a reviewer's false alarm "
                 "is filtered by the voter, and one defect escapes where the holes line up, which is what the "
                 "rollback plan is for")


# One MEDIUM task on the fixture app, with two planted bugs. Each step: (stage index, caption, sent back to stage).
STAGES = [("0", "Bootstrap"), ("1", "Spec & eval"), ("2", "Plan"), ("3", "Build"), ("4–5", "Review loop"),
          ("6", "Security + blind"), ("7", "Codify"), ("8", "Human gate")]
STEPS = [
    (0, "init-pipeline: Makefile found; lint and test become the fast checks", None),
    (1, "spec-and-eval: MEDIUM, a new command; research, rd.md, eval.md, two spec reviewers", None),
    (2, "plan: the pattern auditor finds the plan's new loader duplicates load(); revised and approved", None),
    (3, "build: the builder follows plan.md on feat/csv-export; the prover records passing checks", None),
    (4, "review round 1: the logic reviewer finds export ignores DATA_FILE; the voter keeps it", 3),
    (3, "the builder fixes every place that ignores DATA_FILE; the checks pass again", None),
    (4, "review round 2 reads only the fix: nothing IMPORTANT left, converged", None),
    (5, "blind test: exporting \"Acme, Inc.\" splits the row in two; a blocker", 4),
    (4, "the review loop fixes the blocker first, then reviews the fix: converged", None),
    (5, "blind test, run 2: the goal is reached; friction is triaged into follow-ups", None),
    (6, "codify-lesson: \"All CSV output goes through csv.writer\" joins REVIEW.md", None),
    (7, "human gate: proof, rollback plan, and a PR description; waiting for your review", None),
]


def draw_stages(theme):
    s = Svg(THEMES[theme])
    t = THEMES[theme]
    n = len(STAGES)
    gap, top, bh = 14, 64, 58
    bw = (W - 2 * LEFT - (n - 1) * gap) / n
    cx = [LEFT + i * (bw + gap) + bw / 2 for i in range(n)]
    step, hold = 2.4, 2.2                          # seconds per step, and on the last frame
    cycle = len(STEPS) * step + hold
    pct = lambda sec: f"{100 * max(0, min(sec, cycle)) / cycle:.2f}%"
    css = ["svg .tok { transform-box: view-box; }"]
    reduced = []

    def windows(name, spans, on=1.0, fade=0.3, final=None):
        """Opacity keyframes: visible during each (start, end) span; final is the still frame's opacity."""
        frames = ["0% { opacity: 0; }"]
        for a, b in spans:
            frames += [f"{pct(a)} {{ opacity: 0; }}", f"{pct(a + fade)} {{ opacity: {on}; }}",
                       f"{pct(b - fade)} {{ opacity: {on}; }}", f"{pct(b)} {{ opacity: 0; }}"]
        frames.append("100% { opacity: 0; }")
        css.append(f"@keyframes {name} {{ {' '.join(frames)} }} .{name} {{ animation: {name} {cycle}s infinite; }}")
        reduced.append(f".{name} {{ animation: none; opacity: {final if final is not None else 0}; }}")

    last = len(STEPS) - 1
    end = cycle - 0.4
    for i, (num, name) in enumerate(STAGES):
        x = cx[i] - bw / 2
        s.rect(x, top, bw, bh, "chip", r=10)
        # done: from the end of the first step that passed this stage, to the end of the loop
        first = next((k for k, (st, _, back) in enumerate(STEPS) if st == i and back is None), None)
        if first is not None:
            s.add(f'<rect class="done{i}" x="{x:.1f}" y="{top}" width="{bw:.1f}" height="{bh}" rx="10" '
                  f'fill="{t["go"]}" fill-opacity=".1" stroke="{t["go"]}" stroke-opacity=".45" opacity="0"/>')
            windows(f"done{i}", [((first + 1) * step - 0.3, end)], final=1)
        act = [(k * step, (k + 1) * step + (hold if k == last else 0)) for k, (st, _, back) in enumerate(STEPS)
               if st == i and back is None]
        s.add(f'<rect class="act{i}" x="{x:.1f}" y="{top}" width="{bw:.1f}" height="{bh}" rx="10" fill="none" '
              f'stroke="{t["go"]}" stroke-width="2.5" opacity="0"/>')
        windows(f"act{i}", act, final=1 if i == STEPS[last][0] else 0)
        red = [(k * step, (k + 1) * step) for k, (st, _, back) in enumerate(STEPS) if st == i and back is not None]
        if red:
            s.add(f'<rect class="red{i}" x="{x:.1f}" y="{top}" width="{bw:.1f}" height="{bh}" rx="10" '
                  f'fill="{t["back"]}" fill-opacity=".1" stroke="{t["back"]}" stroke-width="2.5" opacity="0"/>')
            windows(f"red{i}", red)
        s.text(cx[i], top + 25, num, size=14, weight=700, anchor="middle")
        s.text(cx[i], top + 43, name, size=TAG + 0.5, color="muted", anchor="middle")

    # Red arcs under the boxes for the steps that send work back.
    for k, (st, _, back) in enumerate(STEPS):
        if back is None:
            continue
        x1, x2, y = cx[st], cx[back], top + bh + 4
        s.add(f'<path class="arc{k}" d="M{x1:.1f},{y} C{x1:.1f},{y + 40} {x2:.1f},{y + 40} {x2:.1f},{y + 3}" '
              f'fill="none" stroke="{t["back"]}" stroke-width="1.8" marker-end="url(#arrow-back)" opacity="0"/>')
        s.add(f'<text class="arc{k}" x="{(x1 + x2) / 2:.1f}" y="{y + 44}" font-family="{FONT}" font-size="{TAG}" '
              f'font-weight="600" fill="{t["back"]}" text-anchor="middle" opacity="0">sent back</text>')
        windows(f"arc{k}", [(k * step + 0.6, (k + 1) * step)])

    # The task: a dot that glides to each step's stage.
    moves = []
    for k, (st, _, _) in enumerate(STEPS):
        a = k * step
        moves.append(f"{pct(a - 0.6) if k else '0%'} {{ transform: translateX({cx[STEPS[k - 1][0]] - cx[0] if k else 0:.1f}px); "
                     f"animation-timing-function: cubic-bezier(.45,0,.25,1); }}")
        moves.append(f"{pct(a)} {{ transform: translateX({cx[st] - cx[0]:.1f}px); }}")
    final_dx = cx[STEPS[last][0]] - cx[0]
    moves.append(f"100% {{ transform: translateX({final_dx:.1f}px); }}")
    css.append(f"@keyframes tokmove {{ {' '.join(moves)} }} "
               f"@keyframes tokfade {{ 0% {{ opacity: 0; }} {pct(0.4)} {{ opacity: 1; }} {pct(end - 0.3)} {{ opacity: 1; }} "
               f"100% {{ opacity: 0; }} }} "
               f".tok {{ animation: tokmove {cycle}s infinite, tokfade {cycle}s infinite; }}")
    reduced.append(f".tok {{ animation: none; transform: translateX({final_dx:.1f}px); opacity: 1; }}")
    s.add(f'<circle class="tok" cx="{cx[0]:.1f}" cy="{top - 16}" r="8" fill="{t["go"]}" opacity="0"/>')
    s.add(f'<circle class="tok" cx="{cx[0]:.1f}" cy="{top - 16}" r="13" fill="none" stroke="{t["go"]}" '
          f'stroke-opacity=".35" stroke-width="2" opacity="0"/>')

    # Captions, one per step.
    cap_y = top + bh + 78
    for k, (_, caption, back) in enumerate(STEPS):
        a, b = k * step, (k + 1) * step + (hold if k == last else 0)
        color = t["back"] if back is not None else t["fg"]
        s.add(f'<text class="cap{k}" x="{W / 2}" y="{cap_y}" font-family="{FONT}" font-size="13.5" '
              f'fill="{color}" text-anchor="middle" opacity="0"><tspan font-weight="700">Step {k + 1} of '
              f'{len(STEPS)}:</tspan> {escape(caption)}</text>')
        windows(f"cap{k}", [(a, b)], fade=0.25, final=1 if k == last else 0)
    s.text(W / 2, cap_y + 26, "Teal: the stage passed · Red: a stage caught a problem and sent the work back",
           size=TAG + 0.5, color="muted", anchor="middle")
    css.append("@media (prefers-reduced-motion: reduce) { " + " ".join(reduced) + " }")
    s.add("<style>" + " ".join(css) + "</style>")
    return s.svg(int(cap_y + 40), "Animation: one task moving through Quorum's stages, from bootstrap to the human "
                 "gate. Plan review catches a duplicated helper before any code; the review loop sends a bug back to "
                 "the builder, and the blind test sends a blocker back to "
                 "the review loop, before the task reaches the human gate.")


# /quorum:run: the stages it chains, and where it stops. Each stage: (name, [(kind, text)]), kind "ask" (it asks
# you and waits) or "halt" (it stops; you decide what next).
RUN_STAGES = [
    ("Spec", [("ask", "one proposal: slug, tier, research, docs; models once per repo. --yes: all but HIGH"),
              ("ask", "a follow-up round only if your answers open new questions")]),
    ("Plan", [("ask", "mockup sign-off (UI)"),
              ("ask", "plan approval, with its open questions. --yes approves a clean plan, except HIGH")]),
    ("Build", []),
    ("Simplify", []),
    ("Review loop", [("halt", "HALTED after the round cap")]),
    ("Blind test", [("halt", "HALTED if fixes don't converge")]),
    ("PR draft", [("ask", "MEDIUM/HIGH: your review. Never pushes or opens the PR")]),
]


def draw_run(theme):
    s = Svg(THEMES[theme])
    t = THEMES[theme]
    n, gap = len(RUN_STAGES), 22
    bw = (W - 2 * LEFT - (n - 1) * gap) / n
    bh, by = 44, 74

    def badge(cx, cy, kind):
        if kind == "ask":
            s.add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="9" fill="{t["medium"]}"/>'
                  f'<rect x="{cx - 4:.1f}" y="{cy - 4.5:.1f}" width="2.6" height="9" fill="{t["chip"]}"/>'
                  f'<rect x="{cx + 1.4:.1f}" y="{cy - 4.5:.1f}" width="2.6" height="9" fill="{t["chip"]}"/>')
        else:
            s.add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="9" fill="{t["back"]}"/>'
                  f'<rect x="{cx - 3.5:.1f}" y="{cy - 3.5:.1f}" width="7" height="7" fill="{t["chip"]}"/>')

    s.text(LEFT + 4, 26, "/quorum:run", size=15, weight=700, mono=True)
    s.text(LEFT + 4 + mono_w("/quorum:run", 15) + 14, 26,
           "follows each stage's own steps in order, and goes on by itself between them", size=13, color="muted")

    bottom = by + bh
    for i, (name, gates) in enumerate(RUN_STAGES):
        x = LEFT + i * (bw + gap)
        s.rect(x, by, bw, bh, "chip")
        s.text(x + bw / 2, by + 27, name, size=LABEL, weight=600, anchor="middle")
        if i:
            s.arrow(f"M{x - gap + 3:.1f},{by + bh / 2} H{x - 3:.1f}")
        gy, above = by + bh + 26, by + bh
        for kind, text in gates:
            s.add(f'<line x1="{x + bw / 2:.1f}" y1="{above:.1f}" x2="{x + bw / 2:.1f}" y2="{gy - 9:.1f}" '
                  f'stroke="{t["line"]}" stroke-dasharray="3 3"/>')
            badge(x + bw / 2, gy, kind)
            lines = wrap(text, TAG, bw + 4)
            for j, line in enumerate(lines):
                s.text(x + bw / 2, gy + 24 + j * 14, line, size=TAG, color="back" if kind == "halt" else "fg",
                       anchor="middle")
            above = gy + 24 + (len(lines) - 1) * 14 + 6
            gy += 24 + len(lines) * 14 + 18
            bottom = max(bottom, gy)

    # Blind-test blockers go back to the review loop, over the top of the boxes.
    rx = LEFT + 4 * (bw + gap) + bw / 2
    bx = LEFT + 5 * (bw + gap) + bw / 2
    s.arrow(f"M{bx:.1f},{by - 2} V{by - 16} H{rx:.1f} V{by - 3}", color="back")
    s.text((rx + bx) / 2, by - 21, "blockers", size=TAG, color="back", anchor="middle")

    ly = bottom + 8
    badge(LEFT + 12, ly, "ask")
    s.text(LEFT + 28, ly + 4, "stops and asks you", size=TAG + 0.5, color="muted")
    badge(LEFT + 182, ly, "halt")
    s.text(LEFT + 198, ly + 4, "stops: you decide what next", size=TAG + 0.5, color="muted")
    s.text(W - LEFT, ly + 4, "LOW tasks skip the blind test and end READY.", size=TAG + 0.5, color="muted",
           anchor="end")
    ly += 24
    s.text(LEFT + 4, ly + 4, "--until <stage> stops after a stage; /quorum:run again continues from the task's status, "
           "so it mixes with the single-stage commands.", size=TAG + 0.5, color="muted")
    for flag, text in (("--fast", "LOW only: spec without reviewers, no plan stage, build, one reviewer, proof, PR draft."),
                       ("--worktree", "builds in its own git worktree, .claude/worktrees/<slug>; this one stays free "
                                      "for another task."),
                       ("--bug", "reproduces it first; done only when the proof shows it fixed and failing without "
                                 "the fix."),
                       ("--deep-research", "lensed researchers in parallel, every claim checked against its source."),
                       ("--map", "starts the next ready task of a cleared /quorum:map, from the map's decisions.")):
        ly += 22
        s.text(LEFT + 4, ly + 4, flag, size=TAG + 0.5, mono=True, weight=600)
        s.text(LEFT + 4 + mono_w("--deep-research", TAG + 0.5) + 10, ly + 4, text, size=TAG + 0.5, color="muted")
    return s.svg(int(ly + 16), "/quorum:run: spec, plan, build, simplify, review loop, blind test, PR draft, in order. "
                 "It stops to ask at the spec (one proposal of slug, tier, research, and docs, and the models the first time in a repo; --yes accepts all but a HIGH tier; a follow-up round only if your answers open new questions) "
                 "and the plan (mockup sign-off for UI, plan approval with the plan's open questions; --yes approves a clean plan except for HIGH), "
                 "and for your review of MEDIUM and HIGH tasks after the PR draft. It stops if the review loop or the "
                 "blind test halts. Blind-test blockers go back to the review loop. It never pushes or opens the PR. "
                 "--fast takes a LOW task through without spec reviewers or a plan stage, with one reviewer; "
                 "--worktree builds the task in its own git worktree; --bug reproduces the bug first and proves it "
                 "fixed; --deep-research runs lensed researchers in parallel and checks every claim; --map starts "
                 "the next ready task of a cleared map.")


# From a problem to merged code: a map, then its tasks. Each column: (number, title, command, loop label, boxes);
# a box is (title, detail, kind): kind "ask" stops for you, "agent" is work Quorum's agents do, "step" is a file or
# a check.
FLOW = [
    ("1", "Chart it", "/quorum:map <problem>", None, [
        ("Destination", "grilled until it's one or two concrete lines, plus what's out of scope", "ask"),
        ("Survey", "breadth-first: every open decision, and what each waits on", "ask"),
        ("Tickets and fog", "at most 8 questions; research tickets start at once, in parallel", "agent"),
    ]),
    ("2", "Decide", "/quorum:map <slug>", "next ticket, next session", [
        ("Claim a ticket", "the first one waiting on nothing still open", "step"),
        ("You decide", "a researcher first gathers the facts a code question rests on", "ask"),
        ("Check it", "the Feasibility Critic tests it against the code and earlier decisions", "agent"),
    ]),
    ("3", "Hand off", "once nothing is left to decide", None, [
        ("tasks.md", "vertical slices: a tier, what each waits on, the decisions behind it", "step"),
        ("Review it", "architecture, patterns, security for HIGH, then the voter", "agent"),
        ("You approve", "kept findings come with a recommended fix", "ask"),
    ]),
    ("4", "Build each task", "/quorum:run --map <slug>", "next ready task, once its blockers merge", [
        ("Spec from decisions", "decisions.md becomes requirements; nothing decided is asked again", "step"),
        ("The pipeline", "plan, build, review loop, blind test, proof: every gate", "agent"),
        ("PR, then you merge", "it drafts the PR; you review and merge it", "ask"),
    ]),
]


def draw_flow(theme):
    s = Svg(THEMES[theme])
    t = THEMES[theme]
    n, gap, margin = len(FLOW), 44, 38
    cw = (W - LEFT - margin - (n - 1) * gap) / n
    top, vgap = 92, 26
    lines = max(len(wrap(d, TAG, cw - 22)) for _, _, _, _, boxes in FLOW for _, d, _ in boxes)
    bh = 34 + lines * 14 + 8

    def badge(cx, cy):
        s.add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="8" fill="{t["medium"]}"/>'
              f'<rect x="{cx - 3.6:.1f}" y="{cy - 4:.1f}" width="2.4" height="8" fill="{t["chip"]}"/>'
              f'<rect x="{cx + 1.2:.1f}" y="{cy - 4:.1f}" width="2.4" height="8" fill="{t["chip"]}"/>')

    s.text(LEFT + 4, 24, "From a problem to merged code", size=15, weight=700)
    s.text(LEFT + 4 + text_w("From a problem to merged code", 15) + 14, 24,
           "a map settles the decisions, then each task goes through the whole pipeline", size=13, color="muted")
    last = top + 2 * (bh + vgap)
    bottom = last + bh
    for i, (num, title, cmd, loop, boxes) in enumerate(FLOW):
        x = LEFT + i * (cw + gap)
        s.text(x, 56, f"{num} · {title}", size=14, weight=700)
        s.text(x, 74, cmd, size=11, color="muted", mono=cmd.startswith("/"))
        for j, (name, detail, kind) in enumerate(boxes):
            y = top + j * (bh + vgap)
            s.rect(x, y, cw, bh, "doc" if kind == "step" else "chip", dash="4 3" if kind == "step" else None)
            s.text(x + 12, y + 22, name, size=LABEL, weight=600)
            if kind == "ask":
                badge(x + cw - 16, y + 17)
            for k, line in enumerate(wrap(detail, TAG, cw - 22)):
                s.text(x + 12, y + 41 + k * 14, line, size=TAG, color="muted")
            if j:
                s.arrow(f"M{x + cw / 2:.1f},{y - vgap + 2:.1f} V{y - 3:.1f}")
        if i:  # from the previous column's last box, up through the gap, to this column's first
            mid = x - gap * 0.35
            s.arrow(f"M{x - gap + 2:.1f},{last + bh * 0.65:.1f} H{mid:.1f} V{top + bh * 0.35:.1f} H{x - 3:.1f}")
        if loop:  # back up just right of the column, to its first box
            lx = x + cw + 12
            s.arrow(f"M{x + cw:.1f},{last + bh * 0.35:.1f} H{lx:.1f} V{top + bh * 0.65:.1f} H{x + cw + 3:.1f}",
                    color="back")
            for k, line in enumerate(wrap(loop, TAG, cw * 0.62)):
                s.text(x + cw, bottom + 18 + k * 14, line, size=TAG, color="back", anchor="end")

    # The way out of charting, and the retro at the end, under the last column.
    s.text(LEFT, bottom + 18, "fits one task? charting stops and points", size=TAG, color="muted")
    s.text(LEFT, bottom + 32, "you to /quorum:spec-and-eval", size=TAG, color="muted")
    rx = LEFT + 3 * (cw + gap)
    ry = bottom + 62
    retro = wrap("checks, rules, and pointers for the next effort", TAG, cw - 22)
    rh = 30 + len(retro) * 14 + 6
    s.rect(rx, ry, cw, rh, "doc", dash="4 3")
    s.text(rx + 12, ry + 21, "5 · Learn: /quorum:retro", size=LABEL, weight=600)
    for k, line in enumerate(retro):
        s.text(rx + 12, ry + 39 + k * 14, line, size=TAG, color="muted")
    s.arrow(f"M{rx + cw * 0.2:.1f},{bottom + 2:.1f} V{ry - 3:.1f}")
    ly = ry + rh + 30
    badge(LEFT + 10, ly - 4)
    s.text(LEFT + 26, ly, "stops for you", size=TAG + 0.5, color="muted")
    s.rect(LEFT + 130, ly - 13, 24, 16, "chip", r=4)
    s.text(LEFT + 162, ly, "Quorum's agents", size=TAG + 0.5, color="muted")
    s.rect(LEFT + 290, ly - 13, 24, 16, "doc", r=4, dash="3 2")
    s.text(LEFT + 322, ly, "a file or a check", size=TAG + 0.5, color="muted")
    s.text(W - LEFT, ly, "A map session plans only: a hook blocks it from changing the code.", size=TAG + 0.5,
           color="muted", anchor="end")
    return s.svg(int(ly + 14), "From a problem to merged code. 1, chart it with /quorum:map and the problem: the "
                 "destination, grilled until it's one or two concrete lines, plus what's out of scope; a "
                 "breadth-first survey of every open decision; then at most 8 tickets, with research tickets "
                 "started at once, in parallel. If it fits one task, charting stops and points to "
                 "/quorum:spec-and-eval. 2, decide, with /quorum:map and the map's slug, one ticket per session: "
                 "claim the first ticket waiting on nothing still open; you decide, after a researcher gathers the "
                 "facts a code question rests on; the Feasibility Critic checks the decision against the code and "
                 "earlier decisions; then the next ticket, in the next session. 3, hand off, once nothing is left to "
                 "decide: tasks.md, vertical slices with a tier, what each waits on, and the decisions behind it; a "
                 "review by the architecture reviewer, the pattern auditor, the security reviewer for HIGH tasks, "
                 "and the voter; then you approve it. 4, build each task with /quorum:run --map: the spec comes from "
                 "decisions.md; the whole pipeline runs, plan, build, review loop, blind test, proof; it drafts the "
                 "PR and you merge it; then the next task whose blockers have merged. 5, learn with /quorum:retro. "
                 "A map session plans only: a hook blocks it from changing the code.")


if __name__ == "__main__":
    for name in THEMES:
        for base, draw in (("agent-map", draw_map), ("risk-tiers", draw_tiers), ("review-loop", draw_loop),
                           ("swiss-cheese", draw_cheese), ("stages", draw_stages), ("run", draw_run),
                           ("map-flow", draw_flow)):
            path = os.path.join(OUT, f"{base}-{name}.svg")
            with open(path, "w") as f:
                f.write(draw(name))
            print("wrote", os.path.relpath(path))
