// Link cards: the 1200×630 image a chaosh.at link unfurls into on Bluesky,
// Discord and the rest. Drawn from the same parts as the site — the post's
// pixel band, the page's stars, the comet mark, the subject's cover and its
// shelf icon — so a shared link looks like the page it leads to. satori lays the card out as SVG, resvg rasterises it,
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
import { pixelSheet, pixelBandForm, starTile, dayFrame } from "./aurora.js";
import { cometMarkSvg, COMET_ORIGIN } from "./button.js";
import { encodePng } from "./png.js";

export const OG_W = 1200;
export const OG_H = 630;

const C = {
  night: "#0a0c18",
  ink: "#eceafa",
  gold: "#f5c86b",
  ring: "#05060e",
};

// Pixel Operator Tight is drawn on an 8px lattice (100 units a pixel at 800
// upm), so it only stays crisp at whole multiples of 8. 4× (32px) survives a
// feed (Pixelify Grid sat at 4× its 11px lattice, 44px, until 2026-10-26):
// Bluesky shows the card ~300px wide, a quarter scale, which puts one font
// pixel on one screen pixel. Silkscreen sat at 5× its 8px grid (40px) for the
// same reason; a mockup's 22–24px became 6px there — unreadable — which is
// why the pixel rows are this large (2026-09-23, re-gridded 2026-10-16).
const PX = 4;
const PIXEL = 8 * PX;

// A satori node. Plain objects rather than JSX: there is no build step here.
const h = (type, style, children, props = {}) => ({ type, props: { style, children, ...props } });
const dataUri = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
const svgUri = (svg) => dataUri("image/svg+xml", svg);

// The card's own pixel grid: 240×126 art pixels at ×5 is exactly 1200×630,
// so the band and the stars are one image on one grid. 240 was the masthead's
// width until it went to 192 at ×5 (2026-10-21); the card keeps its own 240-wide
// tile, and so the ray periods (25/56, 21/49) that were tuned for 240.
const GRID = 5;
const GRID_W = OG_W / GRID;
const GRID_H = OG_H / GRID;
// 48 rows (240px) of aurora, the old SVG band's height, at the site's 80%.
const BAND_ROWS = 48;
const BAND_ALPHA = 0.8;
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// The ground as one opaque PNG, already at card size: night, the page's star
// tile, the post's band on top. Upscaled here, nearest-neighbour, so resvg
// draws it 1:1 and never gets the chance to smooth a pixel.
const ground = (date) => {
  const px = new Uint8Array(GRID_W * GRID_H * 3);
  const night = hexRgb(C.night);
  for (let i = 0; i < GRID_W * GRID_H; i += 1) px.set(night, i * 3);
  const st = starTile(date, { n: GRID_W, density: 0.0022 });
  for (let y = 0; y < GRID_H; y += 1)
    for (let x = 0; x < GRID_W; x += 1) {
      const i = (y * st.w + x) * 4;
      if (st.px[i + 3]) px.set(st.px.subarray(i, i + 3), (y * GRID_W + x) * 3);
    }
  // The post band's form and posture, taller, and with the masthead's stars
  // in its bare sky (the band leaves them off because the page has its own).
  const sky = pixelSheet(date, {
    W: GRID_W,
    H: BAND_ROWS,
    frames: 1,
    form: pixelBandForm(date),
    fade: [0.45, 0.6],
    back: { base: 0.6, thick: 0.75, n1: 25, n2: 56, env: 0.65 },
    front: { base: 0.84, thick: 1.0, n1: 21, n2: 49, env: 0.65 },
  });
  for (let i = 0; i < GRID_W * BAND_ROWS; i += 1) {
    if (!sky.px[i * 4 + 3]) continue;
    for (let c = 0; c < 3; c += 1) px[i * 3 + c] = Math.round(sky.px[i * 4 + c] * BAND_ALPHA + px[i * 3 + c] * (1 - BAND_ALPHA));
  }
  const W = OG_W;
  const out = new Uint8Array(W * OG_H * 3);
  for (let y = 0; y < OG_H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const s = (Math.floor(y / GRID) * GRID_W + Math.floor(x / GRID)) * 3;
      out.set(px.subarray(s, s + 3), (y * W + x) * 3);
    }
  return encodePng(out, W, OG_H, 3);
};

// The comet at ×5, the card grid's own scale, nudged left so the NAME (not
// the dotted tail) starts on the text column's edge.
const MARK_SCALE = 5;
const mark = (date) =>
  cometMarkSvg(date, MARK_SCALE).replace('class="wordmark comet-mark" ', 'xmlns="http://www.w3.org/2000/svg" ');

// The shelf's own icons: pixelarticons for status, the eyed star for canon.
// Read from src/img/icons and recoloured; a status with no icon gets none.
const iconSvg = (name, color, size) => {
  const file = path.join("src", "img", "icons", `${name}.svg`);
  if (!fs.existsSync(file)) return null;
  return fs
    .readFileSync(file, "utf8")
    .replace(/fill="#000"/g, `fill="${color}"`)
    .replace("<svg ", `<svg width="${size}" height="${size}" `);
};

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

// spec: { sky, kicker?, title, chip?: { text, more?, color, status?, canon? }, cover? }
//   sky    — the date the band, stars, comet and frame colour are drawn from
//   cover  — { file, canon, box? }: a JPEG or PNG path (satori reads no webp/avif), and whether its subject is canon
//            (gold frame). Game covers are 600×900, so `cover` fit never
//            letterboxes; a tabletop box (`box` = its width/height) gets a
//            frame of its own shape, sitting on the same bottom line. Not always the chip's subject: the chip names the
//            first subject, the cover is the first one that HAS a cover.
// Every field is plain text — never HTML — and nothing is read from "today",
// so a card changes only when its post does.
export const cardTree = async (spec) => {
  const { sky, kicker, title, chip, cover } = spec;
  const wide = !cover;
  const textW = wide ? 1080 : 700;
  // The day's frame colour, the one every box on the site wears that night.
  const frame = dayFrame(sky);
  // The text column runs 240 → 580 (340px). A kicker row costs 64 of it and
  // the chip 100 (80 tall with its ring, plus the gap space-between leaves).
  const room = 340 - (kicker ? 64 : 0) - (chip ? 100 : 0);
  const { size, ...wrap } = await fitTitle(title, textW, room);

  const head = [
    kicker ? h("div", { fontFamily: "Pixel Operator Tight", fontSize: PIXEL, color: frame, marginBottom: 20 }, kicker) : null,
    h("div", { ...titleStyle(size), ...wrap, color: C.ink }, title),
  ].filter(Boolean);

  const icon = chip && iconSvg(chip.canon ? "canon" : chip.status ?? "active", chip.color, 12 * PX);
  const chipRow = chip
    ? h(
        "div",
        {
          display: "flex",
          alignItems: "center",
          alignSelf: "flex-start",
          maxWidth: textW,
          fontFamily: "Pixel Operator Tight",
          fontSize: PIXEL,
          color: chip.color,
          // The plain frame, as on the site's picture boxes: border, then ring.
          border: `${PX}px solid ${chip.color}`,
          boxShadow: `0 0 0 ${PX}px ${C.ring}`,
          background: C.night,
          padding: `${PX * 2}px ${PX * 3}px`,
        },
        [
          icon
            ? h("img", { marginRight: PX * 3, flexShrink: 0 }, undefined, {
                src: svgUri(icon),
                width: 12 * PX,
                height: 12 * PX,
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
      background: C.night,
    },
    [
      h("img", { position: "absolute", left: 0, top: 0 }, undefined, { src: dataUri("image/png", ground(sky)), width: OG_W, height: OG_H }),
      // Top-left over the band, like the masthead. At the bottom (the first
      // mockup's spot) it collided with the chip.
      h("img", { position: "absolute", left: 60 - COMET_ORIGIN[0] * MARK_SCALE, top: 20 }, undefined, {
        src: svgUri(mark(sky)),
        width: 99 * MARK_SCALE,
        height: 28 * MARK_SCALE,
      }),
      h(
        "div",
        {
          position: "absolute",
          left: 60,
          top: 240,
          bottom: 50,
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
              right: 60,
              top: cover.box ? 540 - (Math.round(290 / cover.box) + 10) : 90,
              width: 300,
              height: cover.box ? Math.round(290 / cover.box) + 10 : 450,
              display: "flex",
              // The plain frame in the day's hue, gold for canon.
              border: `5px solid ${cover.canon ? C.gold : frame}`,
              boxShadow: `0 0 0 5px ${C.ring}`,
            },
            [
              h("img", { width: 290, height: cover.box ? Math.round(290 / cover.box) : 440, objectFit: "cover" }, undefined, {
                src: dataUri(/\.png$/i.test(cover.file) ? "image/png" : "image/jpeg", fs.readFileSync(cover.file)),
                width: 290,
                height: cover.box ? Math.round(290 / cover.box) : 440,
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
  ["Pixel Operator Tight", "pixel-operator-tight-400.ttf", 400],
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
