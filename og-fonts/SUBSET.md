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

Result: 37 KB and 13 KB. Silkscreen has no ♥ (U+2665) at any size, so og.js
draws canon's heart as a pixel path rather than asking the font for it.
