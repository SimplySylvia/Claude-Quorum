#!/usr/bin/env python3
"""Draw the README's diagrams, each in a light and a dark version from one layout so the two never drift apart.

- assets/agent-map-*.svg: which agents each Quorum command starts, when, and the loops that send work back.
- assets/risk-tiers-*.svg: which layers each risk tier gets.
- assets/review-loop-*.svg: one round of the review loop and where it can end.

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
                  low="#1a7f37", medium="#9a6700", high="#cf222e"),
    "dark": dict(fg="#f0f6fc", muted="#9198a1", line="#3d444d", band="#151b23", chip="#0d1117",
                 doc="#212830", go="#3fb9a6", back="#f85149",
                  low="#3fb950", medium="#d29922", high="#f85149"),
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
    t = band("spec", "1", "Spec & eval", "/quorum:spec-and-eval", 148)
    cy = t + 34
    x = s.row(CONTENT, cy, [("researcher", "MEDIUM/HIGH, or --research", False),
                            ("rd.md + eval.md", "you pick the approach", True)])
    gx = x + ARROW
    s.arrow(f"M{x + 3:.1f},{cy + CHIP_H / 2} H{gx - 3:.1f}")
    reviewers = [("spec-reviewer: feasibility", "does the spec match the code?"),
                 ("spec-reviewer: improver", "clear, testable, covered?")]
    gw = max(chip_w(*r) for r in reviewers) + 24
    group(gx, t + 10, gw, 130, "in parallel")
    for i, (label, tag) in enumerate(reviewers):
        s.chip(gx + 12, t + 34 + i * 52, label, tag)

    # 2 · Build: the builder, then the prover's proof.
    t = band("build", "2", "Build", "/quorum:build", 100, ["then /quorum:simplify-diff"])
    s.row(CONTENT, t + 28, [("builder", "can't finish until the checks pass", False),
                            ("prover", "runs every eval.md check", False)])

    # 3–4 · Review loop: reviewers in parallel, the voter, and the builder's fixes.
    t = band("review", "3–4", "Review loop", "/quorum:review-loop", 252,
             ["up to 3 rounds,", "new lines only each round"])
    reviewers = [("code-reviewer: logic", "always"), ("code-reviewer: architecture", "MEDIUM/HIGH"),
                 ("pattern-auditor", "MEDIUM/HIGH"), ("docs-auditor", "MEDIUM/HIGH, or docs change"),
                 ("code-reviewer: tests", "tests change"), ("a11y-auditor: diff", "UI change")]
    cw = max(chip_w(*r) for r in reviewers)
    gx, gy, gw = CONTENT, t + 12, 2 * cw + 36
    group(gx, gy, gw, 228, "reviewers in parallel, by tier and by what changed")
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
    t = band("blind", "5", "Security & blind test", "/quorum:blind-test", 100, ["MEDIUM/HIGH only"])
    s.row(CONTENT, t + 28, [("security-reviewer", "HIGH", False), ("blind-user", "can't read source", False),
                            ("a11y-auditor: live", "UI change", False), ("friction-triager", "if friction", False),
                            ("prover", "no blockers", False)])

    # 7 · Human gate and PR (6, codify-lesson, is optional and starts no agents).
    t = band("ship", "7", "Human gate & PR", "/quorum:pr-draft", 100, ["6 · codify-lesson: optional"])
    s.row(CONTENT, t + 28, [("pr-writer", "spec + proof → PR description", False),
                            ("you review and merge", "MEDIUM/HIGH wait for you", True)])

    # Forward flow between bands, down the left of the content column.
    spine = CONTENT - 20
    for upper, lower, label in (("init", "spec", None), ("spec", "build", "IMPORTANT spec findings fixed"), ("build", "review", None),
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
    return s.svg(int(ly + 26), "Quorum agent map: the agents each command starts, when they run, and the loops "
                                "that send work back")


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
    return s.svg(int(ly + 16), "Quorum risk tiers: what LOW, MEDIUM, and HIGH tasks get")


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


if __name__ == "__main__":
    for name in THEMES:
        for base, draw in (("agent-map", draw_map), ("risk-tiers", draw_tiers), ("review-loop", draw_loop)):
            path = os.path.join(OUT, f"{base}-{name}.svg")
            with open(path, "w") as f:
                f.write(draw(name))
            print("wrote", os.path.relpath(path))
