// Link cards: the 1200×630 image a chaosh.at link unfurls into on Bluesky,
// Discord and the rest. Drawn from the same parts as the site — the post's
// day sky, the wordmark, the subject's cover — so a shared link looks like
// the page it leads to. satori lays the card out as SVG, resvg rasterises it,
// jpeg-js encodes it: no browser and no native image library, the same rule
// button.js keeps, so the build stays a pure function of its inputs.
//
// Everything here may throw. The config imports this module dynamically and
// wraps every render, so a card that fails costs that page its image, never
// the build — the third door into "one post takes the site down" (2026-09-23),
// closed by construction rather than by care.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
import { daySky } from "./aurora.js";
import { wordmarkSvg } from "./button.js";

export const OG_W = 1200;
export const OG_H = 630;

const C = {
  night: "#0a0c18",
  header: "#07080f",
  edge: "#2b3050",
  ink: "#eceafa",
  muted: "#a9a6ce",
  gold: "#f5c86b",
};

// Silkscreen is drawn on an 8px grid (125 units a pixel at 1000 upm), so it
// only stays crisp at whole multiples of 8. 5× is the smallest that survives a
// feed: Bluesky shows the card ~300px wide, a quarter scale, and 40px becomes
// ~10px. The mockup's 22–24px became 6px there — unreadable — which is why
// the pixel rows are this large (2026-09-23).
const PX = 5;
const PIXEL = 8 * PX;

// A satori node. Plain objects rather than JSX: there is no build step here.
const h = (type, style, children, props = {}) => ({ type, props: { style, children, ...props } });
const dataUri = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
const svgUri = (svg) => dataUri("image/svg+xml", svg);

// Silkscreen has no ♥ (nor does Alegreya), so canon's heart is drawn on the
// same pixel grid as the chip text beside it, the way the wordmark is.
const HEART = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
const heartSvg = (color) => {
  let d = "";
  HEART.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === "#") d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 6" width="${7 * PX}" height="${6 * PX}" ` +
    `shape-rendering="crispEdges"><path fill="${color}" d="${d}"/></svg>`
  );
};

const wordmark = () =>
  wordmarkSvg(4)
    .replace('class="wordmark" ', 'xmlns="http://www.w3.org/2000/svg" ')
    .replace("currentColor", C.ink);

// The title is measured, not guessed from its length: laid out alone at each
// size with a greedy wrap (satori computes a height it isn't given), it takes
// the largest size that fits in three lines. Only a title that fits nowhere
// is clamped with "…", at the smallest size.
//
// And only an unclamped title is balanced. satori's balance and lineClamp
// together miscompute (0.26): "I'm into s&m, if the s is for super and the
// m is for magical" fits three lines at 60px either way, but with both set it
// came out as three short lines and an ellipsis.
const TITLE_SIZES = [76, 68, 60, 54];
const TITLE_LEADING = 1.02;
const titleStyle = (size) => ({
  display: "block",
  fontFamily: "Alegreya Sans",
  fontWeight: 700,
  fontSize: size,
  lineHeight: TITLE_LEADING,
  letterSpacing: "-0.02em",
});
// `room` is the height the kicker and chip leave: three lines at 76px beside
// both would run into the chip, so a title fits when it is ≤3 lines AND its
// lines fit the room.
const fitTitle = async (title, width, room) => {
  const linesAt = (size) => Math.floor(room / (size * TITLE_LEADING));
  for (const size of TITLE_SIZES) {
    const probe = h("div", { display: "flex", width }, h("div", { ...titleStyle(size), width }, title));
    const svg = await satori(probe, { width, fonts: loadFonts() });
    const lines = Math.round(Number(/height="([\d.]+)"/.exec(svg)?.[1]) / (size * TITLE_LEADING));
    if (lines <= Math.min(3, linesAt(size))) return { size, textWrap: "balance" };
  }
  const size = TITLE_SIZES.at(-1);
  return { size, textWrap: "wrap", lineClamp: Math.max(1, Math.min(3, linesAt(size))) };
};

// spec: { sky, kicker?, title, chip?: { text, more?, color, canon? }, cover? }
//   sky    — the date string (or any seed) daySky draws from
//   cover  — { file, canon }: a JPEG or PNG path (satori reads no webp/avif), and whether its subject is canon
//            (gold frame). Covers are 600×900, so `cover` fit never
//            letterboxes. Not always the chip's subject: the chip names the
//            first subject, the cover is the first one that HAS a cover.
// Every field is plain text — never HTML — and nothing is read from "today",
// so a card changes only when its post does.
export const cardTree = async (spec) => {
  const { sky, kicker, title, chip, cover } = spec;
  const wide = !cover;
  const textW = wide ? 1056 : 700;
  // The text column runs 236 → 574 (338px). A kicker row costs 64 of it and
  // the chip 92 (66 tall, plus the gap space-between must leave).
  const room = 338 - (kicker ? 64 : 0) - (chip ? 92 : 0);
  const { size, ...wrap } = await fitTitle(title, textW, room);

  const head = [
    kicker ? h("div", { fontFamily: "Silkscreen", fontSize: PIXEL, color: C.muted, marginBottom: 16 }, kicker) : null,
    h("div", { ...titleStyle(size), ...wrap, color: C.ink }, title),
  ].filter(Boolean);

  const chipRow = chip
    ? h(
        "div",
        {
          display: "flex",
          alignItems: "center",
          alignSelf: "flex-start",
          maxWidth: textW,
          fontFamily: "Silkscreen",
          fontSize: PIXEL,
          color: chip.color,
          border: `${PX - 2}px solid ${chip.color}`,
          padding: `${PX * 2}px ${PX * 3}px`,
        },
        [
          chip.canon
            ? h("img", { marginRight: PX * 3, flexShrink: 0 }, undefined, {
                src: svgUri(heartSvg(chip.color)),
                width: 7 * PX,
                height: 6 * PX,
              })
            : null,
          // The name gives way to the ellipsis; "+N" never does — it is the
          // count of everything else the post is about.
          h("div", { display: "block", flexShrink: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, chip.text),
          chip.more ? h("div", { flexShrink: 0, marginLeft: PX * 3 }, `+${chip.more}`) : null,
        ].filter(Boolean),
      )
    : null;

  return h(
    "div",
    {
      width: OG_W,
      height: OG_H,
      display: "flex",
      position: "relative",
      background: `linear-gradient(180deg, ${C.header} 0%, ${C.night} 45%)`,
    },
    [
      // daySky is 480×96 (5:1), so 1200×240 is the same band undistorted.
      h("img", { position: "absolute", left: 0, top: 0 }, undefined, { src: svgUri(daySky(sky)), width: OG_W, height: 240 }),
      // Top-left, over the dark top of the sky, like the masthead. At the
      // bottom (the mockup's spot) it collided with the chip.
      h("img", { position: "absolute", left: 72, top: 56 }, undefined, { src: svgUri(wordmark()), width: 288, height: 32 }),
      h(
        "div",
        {
          position: "absolute",
          left: 72,
          top: 236,
          bottom: 56,
          width: textW,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        },
        [h("div", { display: "flex", flexDirection: "column" }, head), chipRow].filter(Boolean),
      ),
      cover
        ? h(
            "div",
            {
              position: "absolute",
              right: 72,
              top: 96,
              width: 298,
              height: 444,
              display: "flex",
              border: `3px solid ${cover.canon ? C.gold : C.edge}`,
              boxShadow: `0 0 0 6px ${C.night}`,
            },
            [
              h("img", { width: 292, height: 438, objectFit: "cover" }, undefined, {
                src: dataUri(/\.png$/i.test(cover.file) ? "image/png" : "image/jpeg", fs.readFileSync(cover.file)),
                width: 292,
                height: 438,
              }),
            ],
          )
        : null,
    ].filter(Boolean),
  );
};

const FONT_DIR = "og-fonts";
const FONT_FILES = [
  ["Alegreya Sans", "alegreya-sans-700.ttf", 700],
  ["Silkscreen", "silkscreen-400.ttf", 400],
];
let fonts = null;
const loadFonts = () =>
  (fonts ??= FONT_FILES.map(([name, file, weight]) => ({
    name,
    weight,
    style: "normal",
    data: fs.readFileSync(path.join(FONT_DIR, file)),
  })));

// The cache key is everything the pixels depend on: the laid-out tree (which
// embeds the sky, the cover bytes and every string), this file (layout code
// outside the tree), and the fonts. Anything else changing cannot change the
// card. ~60 cards cost ~8s cold against a half-second build, so --serve
// rebuilds would crawl without it; CI starts cold and pays it once.
const SELF = fs.readFileSync(new URL(import.meta.url));
const QUALITY = 80;
const keyOf = (tree) => {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(tree));
  hash.update(SELF);
  for (const f of loadFonts()) hash.update(f.data);
  hash.update(String(QUALITY));
  return hash.digest("hex").slice(0, 20);
};

// JPEG, not PNG: a cover and a blurred sky are photographic, and PNG came out
// at ~450KB a card. q80 lands 45–130KB. jpeg-js is pure JS, so no sharp.
export const renderCard = async (spec, { cacheDir = null } = {}) => {
  const tree = await cardTree(spec);
  const cached = cacheDir && path.join(cacheDir, `${keyOf(tree)}.jpg`);
  if (cached && fs.existsSync(cached)) return fs.readFileSync(cached);

  const svg = await satori(tree, { width: OG_W, height: OG_H, fonts: loadFonts() });
  // loadSystemFonts off: every glyph is already a path, and scanning the
  // system's fonts per render more than doubled resvg's time.
  const img = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  const out = Buffer.from(jpeg.encode({ data: img.pixels, width: img.width, height: img.height }, QUALITY).data);

  if (cached) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cached, out);
  }
  return out;
};
