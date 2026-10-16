"""Snap Pixelify Sans (Regular) onto an exact pixel lattice.

Stock Pixelify draws each pixel as a ~101-unit square on a ~90.9-unit pitch
(11 per 1000-unit em), origin at x=60, y=-12, so no CSS size puts a stem on
whole device pixels. This rebuilds every glyph on a 100-unit pitch at
UPM 1100 (11 pixels per em, exact), ink starting 1 pixel in, 0 right bearing.
Optionally emits a pixel bold: the glyph OR'd with itself one pixel right.
"""
import re
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import DecomposingRecordingPen

P = 1000 / 11
X0, Y0 = 60, -12
U = 100

def sx(x): return round((x - X0) / P) * U + U
def sy(y): return round((y - Y0) / P) * U
def sd(d): return round(d / P) * U

# Stock Pixelify's 5 has a round top closed on the right: beside an S it is
# the same glyph, so "15 Oct" reads "1S Oct". Its 2 kicks up at the bottom
# left and reads as a Z, and its Z has the same kick, so with the 2 fixed
# "Zelda" read "2elda". All three redrawn, 5 wide by 7 tall like the other
# figures; top row first.
REDRAW = {
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "two": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "five": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    # Stock quotes hang half-pixel tails that the snap flattens, leaving ' ’ ‘
    # one identical backtick. Redrawn whole-pixel, hung from cap height.
    "quotesingle": ["#", "#", ".", ".", ".", ".", "."],
    "quotedbl": ["#.#", "#.#", "...", "...", "...", "...", "..."],
    "quoteright": ["##", ".#", "#.", "..", "..", "..", ".."],
    "quoteleft": [".#", "#.", "##", "..", "..", "..", ".."],
    "quotedblright": ["##.##", ".#..#", "#..#.", ".....", ".....", ".....", "....."],
    "quotedblleft": [".#..#", "#..#.", "##.##", ".....", ".....", ".....", "....."],
    # Drawn stock on a half-pixel grid, which no snap can keep. Rarer ones
    # (super/subscripts, fractions, ‰, ª º) are left out of the subset.
    "equal": [".....", ".....", ".....", "#####", ".....", "#####", "....."],
    "asciitilde": [".....", ".....", ".....", ".#...", "#.#.#", "...#.", "....."],
    "at": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
    "degree": [".#.", "#.#", ".#.", "...", "...", "...", "..."],
    "copyright": [".#####.", "#.....#", "#.###.#", "#.#...#", "#.###.#", "#.....#", ".#####."],
    "registered": [".#####.", "#.....#", "#.##..#", "#.#.#.#", "#.##..#", "#.#.#.#", ".#####."],
    "trademark": ["###.#...#", ".#..##.##", ".#..#.#.#", ".........", ".........", ".........", "........."],
}

# Glyphs Pixelify lacks (and Silkscreen lacked) that the site prints in its
# pixel voice: "read the rest →", "← newer". Drawn from baseline to x-height.
ADD = {
    "arrowright": (0x2192, ["..#..", "...#.", "#####", "...#.", "..#.."]),
    "arrowleft": (0x2190, ["..#..", ".#...", "#####", ".#...", "..#.."]),
}

def bitmap(rows):
    """Horizontal runs as rectangles, on the snapped lattice."""
    out = []
    for r, row in enumerate(rows):
        y0 = (len(rows) - 1 - r) * U
        for m in re.finditer("#+", row):
            x0, x1 = U + m.start() * U, U + m.end() * U
            out.append([(x0, y0), (x0, y0 + U), (x1, y0 + U), (x1, y0)])
    return out

def regrid(src, dst, bold=False, family=None):
    f = TTFont(src)
    if "fvar" in f:  # the google/fonts variable file: pin it to Regular
        f = instantiateVariableFont(f, {"wght": 400})
    order = f.getGlyphOrder()
    for name, (cp, rows) in ADD.items():
        if name not in order:
            order.append(name)
            f["glyf"].glyphs[name] = TTGlyphPen(None).glyph()
            f["hmtx"][name] = (586, 60)
            for t in f["cmap"].tables:
                if t.isUnicode():
                    t.cmap[cp] = name
    f.setGlyphOrder(order)
    f["glyf"].glyphOrder = order
    f["maxp"].numGlyphs = len(order)
    gs = f.getGlyphSet()
    glyf, hmtx = f["glyf"], f["hmtx"]
    new = {}
    for name in f.getGlyphOrder():
        rec = DecomposingRecordingPen(gs)
        gs[name].draw(rec)
        contours, cur = [], []
        for op, args in rec.value:
            if op == "moveTo":
                cur = [args[0]]
            elif op in ("lineTo", "qCurveTo", "curveTo"):
                cur.extend(a for a in args if a is not None)
            elif op in ("closePath", "endPath"):
                if cur:
                    contours.append(cur)
                cur = []
        snapped = []
        for c in contours:
            # Each contour snaps from its own corner: marks and some symbols
            # are drawn at a different sub-pixel phase than the letters, and
            # one global origin collapses them (é and è both became ė).
            x0 = min(x for x, _ in c)
            y0 = min(y for _, y in c)
            ox, oy = sx(x0), sy(y0)
            pts = [(ox + sd(x - x0), oy + sd(y - y0)) for x, y in c]
            # drop repeats created by snapping the 10-unit overlaps together
            out = [p for i, p in enumerate(pts) if p != pts[i - 1]]
            if len(out) >= 3:
                snapped.append(out)
        drawn = REDRAW.get(name) or ADD.get(name, (0, None))[1]
        if drawn:
            snapped = bitmap(drawn)
        if bold:
            snapped += [[(x + U, y) for x, y in c] for c in snapped]
        pen = TTGlyphPen(None)
        for c in snapped:
            pen.moveTo(c[0])
            for p in c[1:]:
                pen.lineTo(p)
            pen.closePath()
        g = pen.glyph()
        adv = hmtx[name][0]
        nadv = 0 if adv == 0 else max(U, round((adv - 121) / P) * U + U)
        if drawn:
            nadv = (len(drawn[0]) + 1) * U
        if bold and nadv:
            nadv += U
        new[name] = (g, nadv)
    for name, (g, nadv) in new.items():
        glyf[name] = g
        g.recalcBounds(glyf)
        if bold and g.numberOfContours > 0:
            g.flags[0] |= 0x40  # OVERLAP_SIMPLE: the smear overlaps itself
        hmtx[name] = (nadv, getattr(g, "xMin", 0))
    f["head"].unitsPerEm = 1100
    os2, hh = f["OS/2"], f["hhea"]
    os2.sxHeight, os2.sCapHeight = 500, 700
    asc, desc = 1000, -300
    hh.ascent, hh.descent, hh.lineGap = asc, desc, 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = asc, desc, 0
    os2.usWinAscent, os2.usWinDescent = asc, -desc
    if bold:
        os2.usWeightClass = 700
    # kerning and mark anchors onto the same lattice
    for lk in f["GPOS"].table.LookupList.Lookup:
        for st in lk.SubTable:
            st = getattr(st, "ExtSubTable", st)
            if lk.LookupType == 2 or getattr(st, "LookupType", 0) == 2:
                if st.Format == 1:
                    for ps in st.PairSet:
                        for pv in ps.PairValueRecord:
                            if pv.Value1 and getattr(pv.Value1, "XAdvance", None):
                                pv.Value1.XAdvance = sd(pv.Value1.XAdvance)
                else:
                    for c1 in st.Class1Record:
                        for c2 in c1.Class2Record:
                            if c2.Value1 and getattr(c2.Value1, "XAdvance", None):
                                c2.Value1.XAdvance = sd(c2.Value1.XAdvance)
            for attr in ("MarkArray", "BaseArray", "Mark1Array", "Mark2Array"):
                arr = getattr(st, attr, None)
                if not arr:
                    continue
                recs = getattr(arr, "MarkRecord", None) or getattr(arr, "BaseRecord", None) or getattr(arr, "Mark2Record", None) or getattr(arr, "Mark1Record", None) or []
                for r in recs:
                    anchors = [getattr(r, "MarkAnchor", None)] + list(getattr(r, "BaseAnchor", []) or []) + list(getattr(r, "Mark2Anchor", []) or [])
                    for a in anchors:
                        if a is not None:
                            a.XCoordinate, a.YCoordinate = sx(a.XCoordinate), sy(a.YCoordinate)
    for t in ("prep", "gasp"):
        if t in f and t == "prep":
            del f[t]
    if family:
        for n in f["name"].names:
            if n.nameID in (1, 4, 16):
                n.string = family + (" Bold" if bold and n.nameID == 4 else "")
    f.save(dst)

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    regrid(src, dst, bold="--bold" in sys.argv, family="Pixelify Grid")
