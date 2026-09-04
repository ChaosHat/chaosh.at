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
