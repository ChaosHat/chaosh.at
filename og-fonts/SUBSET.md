# Link-card fonts

TTF, not WOFF2: satori (og.js) reads TTF/OTF/WOFF only. Same faces and the
same `RANGES` as `src/fonts/SUBSET.md`, cut from the same google/fonts
sources. They live outside `src/` so they never ship to the site; they are
build inputs, like `hues.lock.json`.

    pyftsubset AlegreyaSans-Bold.ttf --unicodes="$RANGES" \
      --layout-features='kern,liga,clig,calt,ccmp,locl,mark,mkmk,rlig,rclt' \
      --no-hinting --desubroutinize --output-file=alegreya-sans-700.ttf
    pyftsubset Silkscreen-Regular.ttf --unicodes="$RANGES" \
      --layout-features='kern,liga,clig,calt,ccmp,locl' \
      --no-hinting --output-file=silkscreen-400.ttf

The regular face (`alegreya-sans-400.ttf`, for sig.js) was not re-cut: it is
`src/fonts/alegreya-sans-400.woff2` decompressed to TTF with fontTools
(`f.flavor = None`), so it is the site's own subset byte-for-byte in glyphs.

Result: 37 KB and 13 KB (400: 38 KB). Silkscreen has no ♥ (U+2665) at any size, so og.js
draws canon's heart as a pixel path rather than asking the font for it.

`alegreya-sans-700-sigdigits.ttf` (sig.js dates only) is `alegreya-sans-700.ttf`
with tabular digits forced in: Alegreya Sans ships no `tnum`, so every digit's
advance is set to the widest (zero, 521 units) and its outline centred in it.
The sig's date tiles have a fixed width typed once into the forum signature,
so every date has to be exactly as wide as every other (2026-10-15):

    for n in [cmap[ord(c)] for c in "0123456789"]:
        adv, lsb = hmtx[n]; dx = (521 - adv) // 2
        glyf[n].coordinates.translate((dx, 0)); glyf[n].recalcBounds(glyf)
        hmtx[n] = (521, lsb + dx)
