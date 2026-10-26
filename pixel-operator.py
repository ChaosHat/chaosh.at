"""Pixel Operator 8, tightened, with the glyphs the site needs.

Pixel Operator 8 (Jayvee Enaguas, CC0) is already drawn on an exact lattice:
UPM 800, 100 units a pixel, so 8, 16, 24 and 32px render pure 0/255 with no
snapping. Two changes only:
- Every advance loses one pixel. Stock letters sit two pixels apart, which
  reads as a typewriter; one apart is how the SNES menus set it.
- ← and →, which it lacks and the site prints ("all →", "← newer"),
  drawn baseline to x-height like the rest of the lowercase.
Family is renamed "Pixel Operator Tight" so it can't be confused with stock.

    python pixel-operator.py PixelOperator8.ttf tight-400.ttf
    python pixel-operator.py PixelOperator8-Bold.ttf tight-700.ttf
    python pixel-operator.py PixelOperator.ttf fine-400.ttf "Pixel Operator Fine"
"""
import re
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen

U = 100
FAMILY = "Pixel Operator Tight"
FINE = "Pixel Operator Fine"  # the 16px-grid sibling: same hand, more detail

ADD = {
    "arrowright": (0x2192, ["..#..", "...#.", "#####", "...#.", "..#.."]),
    "arrowleft": (0x2190, ["..#..", ".#...", "#####", ".#...", "..#.."]),
}

def bitmap(rows, bold=False):
    pen = TTGlyphPen(None)
    for r, row in enumerate(rows):
        y0 = (len(rows) - 1 - r) * U
        for m in re.finditer("#+", row):
            x0, x1 = U + m.start() * U, U + m.end() * U + (U if bold else 0)
            for p in [(x0, y0), (x0, y0 + U), (x1, y0 + U), (x1, y0)]:
                (pen.lineTo if p != (x0, y0) else pen.moveTo)(p)
            pen.closePath()
    return pen.glyph()

def build(src, dst, family=FAMILY):
    f = TTFont(src)
    bold = f["OS/2"].usWeightClass >= 600
    order = f.getGlyphOrder()
    for name, (cp, rows) in ADD.items():
        if name in order:
            continue
        order.append(name)
        f["glyf"].glyphs[name] = bitmap(rows, bold)
        f["hmtx"][name] = ((len(rows[0]) + 2 + bold) * U, U)
        for t in f["cmap"].tables:
            if t.isUnicode():
                t.cmap[cp] = name
    f.setGlyphOrder(order)
    f["glyf"].glyphOrder = order
    f["maxp"].numGlyphs = len(order)
    for name in order:
        adv, lsb = f["hmtx"][name]
        if adv >= 2 * U:
            f["hmtx"][name] = (adv - U, lsb)
        f["glyf"][name].recalcBounds(f["glyf"])
    style = "Bold" if bold else "Regular"
    for rec in f["name"].names:
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID == 4:
            rec.string = f"{family} {style}" if bold else family
        elif rec.nameID == 6:
            rec.string = family.replace(" ", "") + "-" + style
    f.save(dst)

if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2], *sys.argv[3:4])
