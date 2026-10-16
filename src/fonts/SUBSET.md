# Regenerating the Alegreya Sans subset

Sources: `ofl/alegreyasans/AlegreyaSans-{Regular,Italic,Bold}.ttf` from
github.com/google/fonts. Three static files — Alegreya Sans is not variable,
so 400, 400 italic and 700 are three separate faces and three separate loads.

The range is deliberately wider than what the site currently prints. The prose
is effectively ASCII plus `·×éüō—’“”←→`, but a subset cut to *that* fails
silently the first time a post says "café" or "Pokémon" — the glyph vanishes
into whatever `system-ui` resolves to, mid-word, and nothing reports it. Latin
Extended-A plus General Punctuation is a fixed, documented set that covers
anything Hat plausibly types, and costs ~3KB per face over Google's own `latin`.

    RANGES="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2000-206F,U+2070-209F,U+20A0-20BF,U+2122,U+2190-2193,U+2212,U+25CF,U+FB00-FB04"

    pyftsubset AlegreyaSans-Regular.ttf \
      --unicodes="$RANGES" \
      --layout-features='kern,liga,clig,calt,ccmp,locl,mark,mkmk,rlig,rclt,frac,numr,dnom' \
      --flavor=woff2 --no-hinting --desubroutinize \
      --output-file=alegreya-sans-400.woff2

Same for `-Italic.ttf` → `-400-italic.woff2` and `-Bold.ttf` → `-700.woff2`.

Result: 17.0 / 17.9 / 17.0 KB, 52 KB for all three. For scale, `chrono-trigger.jpg`
on the front page is 177 KB. Weight was never the constraint here; the covers are.

# Regenerating Pixelify Grid

Source: `ofl/pixelifysans/PixelifySans[wght].ttf` from github.com/google/fonts
(v1.000; the same file fonts.gstatic.com serves). It goes through
`pixelify-grid.py` (repo root) before subsetting, and is not shipped stock.

Why: stock Pixelify draws each pixel as a ~101-unit square on a ~90.9-unit
pitch (11 to the 1000-unit em), its lattice starting at x=60, y=-12. No CSS
size puts its stems on device pixels: measured in Chromium at 1×, a one-pixel
stem covers 2–3 columns at 11, 12, 16 and 22px, and no column is fully lit.
The script snaps every point onto an exact lattice (UPM 1100, 100 units a
pixel, ink one pixel in, no right bearing), so 11px and 22px render pure
0/255. Kerning and mark anchors snap with it. It also redraws 2, 5 and Z
(stock, 5 is an S with a closed top-right, and 2 and Z share a bottom-left
kick, so "15 Oct" read "1S Oct" and "Zelda" read "2elda"), redraws the quotes
(their half-pixel tails snapped flat, so ' ’ ‘ all became one backtick) and
the parentheses (in bold
they read as braces), and = ~ @ ° © ® ™ (drawn stock on a half-pixel grid), adds ← and →, and
builds 700 as a pixel bold — the 400 OR'd one pixel right — because the
stock bold's 1.4-pixel stems can't sit on any lattice. Family is renamed
"Pixelify Grid". OFL 1.1, no Reserved Font Name, so the modified copy may
ship; the licence travels as `OFL-pixelify-sans.txt`.

    python pixelify-grid.py 'PixelifySans[wght].ttf' grid-400.ttf          # pinned to wght 400
    python pixelify-grid.py 'PixelifySans[wght].ttf' grid-700.ttf --bold
The pixel subset is `RANGES` minus the glyphs Pixelify draws on a half-pixel
grid and nothing redraws: superscripts and subscripts, ¼ ½ ¾, ‰, ª º, ₧. Left
out, they fall back to the system face rather than render as blobs.

    PIXEL_RANGES="U+0020-007E,U+00A0-00A9,U+00AB-00B1,U+00B4-00B8,U+00BB,U+00BF-00FF,U+0100-017F,U+2000-202F,U+2031-206F,U+20A0-20A6,U+20A8-20BF,U+2122,U+2190-2193,U+2212,U+25CF,U+FB00-FB04"

    pyftsubset grid-400.ttf --unicodes="$PIXEL_RANGES" \
      --layout-features='kern,liga,clig,calt,ccmp,locl,mark,mkmk' \
      --flavor=woff2 --no-hinting --desubroutinize \
      --output-file=pixelify-grid-400.woff2

Same for `grid-700.ttf` → `pixelify-grid-700.woff2`. The script pins the
variable font to wght 400 itself; a static Regular (e.g. the file
fonts.gstatic.com serves) works too and gives the same glyphs.

Result: 6.3 / 7.9 KB.
