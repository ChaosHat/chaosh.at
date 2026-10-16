// The forum signature: a small night panel — wordmark and tagline on top,
// "latest post · latest essay · @chaosh.at on bluesky" below — drawn as one
// picture and cut into three images that sit flush in a BBCode signature.
// Changing content is the point: a sig that visibly updates reads as a live
// site, not an ad (Hat, 2026-10-15). Coin Return allows three images per
// signature, so the panel is cut in three, and each piece is exactly one item:
// the cuts fall in the middle of the two separators on the bottom row,
// wherever tonight's text puts them. Each piece is a stable image URL wrapped
// in a stable link (/sig/<item>/) that forwards to whatever it shows tonight.
//
// Width is free, height is not. The BBCode pins each image with
// [IMG height=…] — Coin Return's XenForo honours it (Hat tested, 2026-10-16)
// — so the browser derives the width from the PNG and the panel can grow or
// shrink with the essay title every night. The earlier [IMG width=…] froze
// every tile at its widest and left a hole when a title ran short.
//
// The panel has its own dark ground (#0a0c18, a 1px edge) so it reads the
// same on any forum theme. The one aurora is a wisp of the newest day's sky
// between the rows: always the same shape (the `ribbon` form — `rays` and
// `drapery` put streaks behind the text), only its hue follows the day, and
// it is drawn on a fixed canvas and cropped by the panel, never stretched.
//
// Same pipeline as og.js — satori lays out, resvg rasterises — and the same
// rule: everything here may throw, and the config wraps it, so a sig that
// fails costs the sig, never the build.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { DAY_H, daySpread, hashOf, palette, ribbon } from "./aurora.js";
import { wordmarkSvg } from "./button.js";

// Drawn at 2× and shown at 1× by the BBCode's height — a 1× PNG went soft on
// hi-dpi screens (2026-10-15). Changing SIG_H means re-pasting the sig.
export const SIG_H = 52;
export const SIG_SCALE = 2;
export const SIG_ITEMS = ["post", "essay", "bsky"];
export const TAGLINE = "Daily game opinions, occasional essays, and auroras.";

const C = { muted: "#8b8fa3", link: "#b4b1d8", ink: "#eceafa", tag: "#7d8196", ground: "#0a0c18", edge: "#2b3050" };
const PAD = 12;
const EDGE = 1;
const DOT_W = 16;
const FONT_DIR = "og-fonts";
let fonts = null;
const loadFonts = () =>
  (fonts ??= [
    ["alegreya-sans-400.ttf", 400, "normal"],
    ["alegreya-sans-400-italic.ttf", 400, "italic"],
    ["alegreya-sans-700.ttf", 700, "normal"],
  ].map(([file, weight, style]) => ({
    name: "Alegreya Sans",
    weight,
    style,
    data: fs.readFileSync(path.join(FONT_DIR, file)),
  })));

const h = (type, style, children, props = {}) => ({ type, props: { style, children, ...props } });
const svgUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const span = (text, style) => h("span", style, text);

// The wisp. daySky picks its form by date; the sig wants one form always, so
// this is daySky's recipe (same hue hash, palette, posture) with the form
// pinned to ribbon. Drawn WISP_W wide — wider than any panel — and centred,
// so a narrow panel just shows less of its faded ends.
const WISP_W = 600;
const WISP_H = 34;
const wisp = (dateStr) => {
  const pal = palette((hashOf(dateStr) % 360000) / 1000, { lMax: 0.82, spread: daySpread(dateStr) });
  const body = ribbon(pal, { w: WISP_W, h: DAY_H, F: 0, yoff: 0, step: 2, base: 0.7, sweep: 0.105, thick: 0.46 });
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${WISP_W}' height='${WISP_H}' viewBox='0 0 ${WISP_W} ${DAY_H}' preserveAspectRatio='none'>` +
    `<defs><filter id='b' x='-60%' y='-60%' width='220%' height='220%'>` +
    `<feGaussianBlur stdDeviation='${(7 * (DAY_H / 112)).toFixed(1)}'/></filter>` +
    `<radialGradient id='rf' cx='0.5' cy='0.55' r='0.5'>` +
    `<stop offset='0.35' stop-color='#fff'/><stop offset='1' stop-color='#000'/></radialGradient>` +
    `<mask id='rm'><rect width='${WISP_W}' height='${DAY_H}' fill='url(#rf)'/></mask></defs>` +
    `<g mask='url(#rm)' opacity='0.88'>${body}</g></svg>`
  );
};

const wordmark = () =>
  wordmarkSvg(1)
    .replace('class="wordmark" ', 'xmlns="http://www.w3.org/2000/svg" ')
    .replace("currentColor", C.ink);

const label = (t) => span(t, { color: C.muted, marginRight: 4 });
const bold = (t) => span(t, { color: C.link, fontWeight: 700 });
// Fixed-width separator, so its middle — where the cut goes — is known.
const dot = () => h("span", { display: "flex", justifyContent: "center", width: DOT_W, color: C.muted }, "·");

const line = (children, height) =>
  h("div", { display: "flex", alignItems: "center", height, fontFamily: "Alegreya Sans", fontSize: 14, whiteSpace: "nowrap" }, children);

const widthOf = async (...nodes) =>
  Number(/width="([\d.]+)"/.exec(await satori(line(nodes, 22), { height: 22, fonts: loadFonts() }))?.[1]);

// The essay title is the one free-length thing in the panel. Capped at
// ESSAY_MAX px: cut at a word, "…" appended, trailing period dropped (a full
// stop mid-line reads as the line ending). Quoted, so it reads as a title.
export const ESSAY_MAX = 200;
const quoted = (t) => `“${t}”`;
const fitTitle = async (title) => {
  const clean = title.trim().replace(/\.$/, "");
  if ((await widthOf(bold(clean))) <= ESSAY_MAX) return clean;
  const words = clean.split(/\s+/);
  for (let n = words.length - 1; n > 0; n -= 1) {
    const cut = `${words.slice(0, n).join(" ").replace(/[\s,;:.\-—–]+$/, "")}…`;
    if ((await widthOf(bold(cut))) <= ESSAY_MAX) return cut;
  }
  return `${words[0]}…`;
};

// Columns [a, b) of an RGBA raster as a PNG.
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body), body.length + 4);
  return out;
};
const slicePng = (rgba, width, height, a, b) => {
  const w = b - a;
  const raw = Buffer.alloc((w * 4 + 1) * height);
  for (let y = 0; y < height; y += 1)
    raw.set(rgba.subarray((y * width + a) * 4, (y * width + b) * 4), y * (w * 4 + 1) + 1); // filter byte 0: none
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

// dailies: newest first, [{ date: Date, url }] (only the first is used)
// essay:   { title, url }
// bluesky: handle without the @ (site.yaml `bluesky`)
// -> { files: Map<rel, Buffer|string>, links: Map<item, url> }
export const sigFiles = async ({ dailies, essay, bluesky, siteUrl = "" }) => {
  const files = new Map();
  const links = new Map();
  // Three images are pasted once; drawing two would leave a broken one.
  if (!dailies.length || !essay || !bluesky) throw new Error("sig needs a daily, an essay and a bluesky handle");
  const newest = dailies[0];

  // The bottom row in three groups; the cuts go mid-separator between them.
  const groups = [
    [label("latest post"), bold(shortDate(newest.date))],
    [label("latest essay"), bold(quoted(await fitTitle(essay.title)))],
    [bold(`@${bluesky}`), span(" on bluesky", { color: C.muted, marginLeft: 4 })],
  ];
  const gw = await Promise.all(groups.map((g) => widthOf(...g)));
  const row2 = [...groups[0], dot(), ...groups[1], dot(), ...groups[2]];
  const top = [
    h("img", { marginRight: 10 }, undefined, { src: svgUri(wordmark()), width: 72, height: 8 }),
    span(TAGLINE, { color: C.tag, fontSize: 13, fontStyle: "italic" }),
  ];
  const inner = Math.max(await widthOf(...top), gw[0] + gw[1] + gw[2] + 2 * DOT_W);
  const W = Math.ceil(inner) + 2 * (PAD + EDGE);

  const panel = h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      width: W,
      height: SIG_H,
      padding: `0 ${PAD}px`,
      position: "relative",
      background: C.ground,
      border: `${EDGE}px solid ${C.edge}`,
      borderRadius: 6,
      overflow: "hidden",
    },
    [
      // Centred between the rows (6px above the panel's middle, where row 1
      // meets row 2), dimmed so the grey labels stay readable on any hue.
      h("img", { position: "absolute", left: (W - WISP_W) / 2, top: (SIG_H - WISP_H) / 2 - 6, opacity: 0.7 }, undefined, {
        src: svgUri(wisp(newest.date.toISOString().slice(0, 10))),
        width: WISP_W,
        height: WISP_H,
      }),
      line(top, 18),
      line(row2, 22),
    ],
  );
  const svg = await satori(panel, { width: W, height: SIG_H, fonts: loadFonts() });

  // Cut points in whole CSS px, so at 2× every piece meets its neighbour on
  // the pixel grid and the three read as one picture. The panel is rendered
  // once and its pixels sliced: cropping by viewBox made resvg panic (a Rust
  // abort, not a throw — it takes the whole build down) at most offsets,
  // 2026-10-16.
  const x1 = Math.round(EDGE + PAD + gw[0] + DOT_W / 2);
  const x2 = Math.round(EDGE + PAD + gw[0] + DOT_W + gw[1] + DOT_W / 2);
  const cuts = [0, x1, x2, W].map((x) => x * SIG_SCALE);
  const img = new Resvg(svg, { fitTo: { mode: "zoom", value: SIG_SCALE } }).render();
  const urls = [newest.url, essay.url, `https://bsky.app/profile/${bluesky}`];
  for (const [i, item] of SIG_ITEMS.entries()) {
    files.set(`sig/${item}.png`, slicePng(img.pixels, img.width, img.height, cuts[i], cuts[i + 1]));
    links.set(item, urls[i]);
  }

  const abs = (to) => (to.startsWith("/") ? siteUrl + to : to);
  // The link pages: same shape as src/redirect.njk — a refresh for people,
  // noindex so the stubs stay out of search.
  for (const [item, to] of links)
    files.set(
      `sig/${item}/index.html`,
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta http-equiv="refresh" content="0; url=${to}">` +
        `<link rel="canonical" href="${abs(to)}"><meta name="robots" content="noindex">` +
        `<title>chaosh.at</title></head><body><p><a href="${to}">${abs(to)}</a></p></body></html>`,
    );

  return { files, links };
};

// The BBCode Hat pastes once. Pieces must be flush — any whitespace between
// the tags renders as a gap in the panel. Only the height is pinned, so
// nightly width changes need no re-paste; changing SIG_H does.
export const sigBbcode = (siteUrl) =>
  SIG_ITEMS.map((t) => `[URL=${siteUrl}/sig/${t}/][IMG height="${SIG_H}px"]${siteUrl}/sig/${t}.png[/IMG][/URL]`).join("");
