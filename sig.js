// The forum signature: a small night panel in the site's pixel art — the
// comet mark and tagline on top, then three columns (latest post, latest
// essay, Bluesky), each a label over a title — drawn as one picture and cut
// into three images that sit flush in a BBCode signature. Changing content is
// the point: a sig that visibly updates reads as a live site, not an ad (Hat,
// 2026-10-15). Coin Return allows three images per signature, so the panel is
// cut in three, one column each, the cuts in the middle of the column gaps.
// Each piece is a stable image URL wrapped in a stable link (/sig/<item>/)
// that forwards to whatever it shows tonight.
//
// Width is free, height is not. The BBCode pins each image with
// [IMG height=…] — Coin Return's XenForo honours it (Hat tested, 2026-10-16)
// — so the browser derives the width from the PNG and the panel can grow or
// shrink with the titles every night. The earlier [IMG width=…] froze every
// tile at its widest and left a hole when a title ran short.
//
// The look (2026-10-19, the hi-bit pass; layout from the 2026-10-16 mock
// rounds): everything sits on one 1px art grid, drawn at 2×. The ground is
// night with the masthead's own pixel curtains rising from the bottom
// (aurora.js pixelSheet, the newest post's day), the frame is the day's frame
// hue like every box on the site, the mark is COMET_MARK at 1× in the top
// left — its fireball stops just above the label row — and the type is
// Pixelify Grid at 11px, its native size, with the site's one-pixel night
// outline so it holds on any band. Labels take the day's hue, titles ink.
//
// The background is our own raster; satori lays out only the text, resvg
// rasterises it, and the two are composited with the text's alpha snapped to
// whole pixels. Everything here may throw, and the config wraps it, so a sig
// that fails costs the sig, never the build.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { dayFrame, daySpread, hashOf, palette, pixelSheet } from "./aurora.js";
import { COMET_MARK } from "./button.js";

// Changing SIG_H means re-pasting the sig.
export const SIG_H = 63;
export const SIG_SCALE = 2;
export const SIG_ITEMS = ["post", "essay", "bsky"];
export const TAGLINE = "Daily game opinions, occasional essays, and auroras.";

const NIGHT = [10, 12, 24];
const INK = [236, 234, 250];
const C = { tag: "#9a9db4", title: "#eceafa" };
const PAD = 9; // text inset from the frame
const GAP = 18; // between columns; the cuts fall in its middle
const MARK_X = 5;
const MARK_Y = 2;
const TAG_X = MARK_X + COMET_MARK[0].length + 4;
const FONT_DIR = "og-fonts";
let fonts = null;
const loadFonts = () =>
  (fonts ??= [
    { name: "Pixelify Grid", weight: 400, style: "normal", data: fs.readFileSync(path.join(FONT_DIR, "pixelify-grid-400.ttf")) },
  ]);

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const h = (type, style, children, props = {}) => ({ type, props: { style, children, ...props } });
const span = (text, style) => h("span", style, text);
// 11px is Pixelify Grid's own pixel: one font pixel per art pixel.
const line = (children, height) =>
  h("div", { display: "flex", alignItems: "center", height, fontFamily: "Pixelify Grid", fontSize: 11, whiteSpace: "nowrap" }, children);
const widthOf = async (text) =>
  Number(/width="([\d.]+)"/.exec(await satori(line([span(text, {})], 16), { height: 16, fonts: loadFonts() }))?.[1]);

// Titles are the free-length things in the panel. Capped at TITLE_MAX px: cut
// at a word, "…" appended, trailing period dropped (a full stop mid-line reads
// as the line ending). Quoted, so they read as titles.
export const TITLE_MAX = 190;
const quoted = (t) => `“${t}”`;
const fitTitle = async (title) => {
  const clean = title.trim().replace(/\.$/, "");
  if ((await widthOf(quoted(clean))) <= TITLE_MAX) return quoted(clean);
  const words = clean.split(/\s+/);
  for (let n = words.length - 1; n > 0; n -= 1) {
    const cut = quoted(`${words.slice(0, n).join(" ").replace(/[\s,;:.\-—–]+$/, "")}…`);
    if ((await widthOf(cut)) <= TITLE_MAX) return cut;
  }
  return quoted(`${words[0]}…`);
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

// The night behind the type, at 1×: night, the masthead's curtains rising
// from the bottom (lit edge just under the panel, dimmed and faded hard toward
// the top so the type above stays readable), stars, the comet mark, the frame.
const background = (dateStr, W) => {
  const bg = new Uint8Array(W * SIG_H * 3);
  for (let i = 0; i < W * SIG_H; i += 1) bg.set(NIGHT, i * 3);
  // Ray periods scaled from the masthead's 240 columns, so a ray is as many
  // pixels wide here as there.
  const sc = W / 240;
  const sky = pixelSheet(dateStr, {
    W,
    H: SIG_H,
    frames: 1,
    lMax: 0.7,
    fade: [0.15, 1],
    back: { base: 0.85, thick: 0.75, n1: Math.round(25 * sc), n2: Math.round(56 * sc), env: 0.65 },
    front: { base: 1.04, thick: 0.95, n1: Math.round(21 * sc), n2: Math.round(49 * sc), env: 0.65 },
  });
  for (let i = 0; i < W * SIG_H; i += 1) if (sky.px[i * 4 + 3]) bg.set(sky.px.subarray(i * 4, i * 4 + 3), i * 3);
  const put = (x, y, c) => {
    if (x >= 0 && x < W && y >= 0 && y < SIG_H) bg.set(c, (y * W + x) * 3);
  };
  const pal = palette((hashOf(dateStr) % 360000) / 1000, { lMax: 0.85, spread: daySpread(dateStr) });
  const fill = { n: NIGHT, i: INK, d: hexRgb(pal.deep), m: hexRgb(pal.mid), g: hexRgb(pal.glow), e: hexRgb(pal.edge) };
  COMET_MARK.forEach((row, y) => [...row].forEach((c, x) => c !== "." && put(MARK_X + x, MARK_Y + y, fill[c])));
  const frame = hexRgb(dayFrame(dateStr));
  for (let x = 0; x < W; x += 1) {
    put(x, 0, frame);
    put(x, SIG_H - 1, frame);
  }
  for (let y = 0; y < SIG_H; y += 1) {
    put(0, y, frame);
    put(W - 1, y, frame);
  }
  return bg;
};

// Text over background at SIG_SCALE: text alpha snapped to whole pixels (it
// is a pixel face on its own grid, so a half-covered pixel is an edge, not a
// stroke), and one art pixel of night around every stroke — the site's
// on-aurora outline.
const composite = (bg, text, W) => {
  const S = SIG_SCALE;
  const w = W * S;
  const hh = SIG_H * S;
  const out = new Uint8Array(w * hh * 4);
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < hh && text[(y * w + x) * 4 + 3] >= 128;
  const ring = [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let y = 0; y < hh; y += 1)
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const a = text[i * 4 + 3];
      let rgb;
      if (a >= 128) rgb = [0, 1, 2].map((c) => Math.min(255, Math.round((text[i * 4 + c] * 255) / a)));
      else if (ring.some(([dx, dy]) => on(x + dx, y + dy))) rgb = NIGHT;
      else {
        const b = (Math.floor(y / S) * W + Math.floor(x / S)) * 3;
        rgb = bg.subarray(b, b + 3);
      }
      out.set(rgb, i * 4);
      out[i * 4 + 3] = 255;
    }
  return out;
};

// dailies: newest first, [{ date: Date, url, title? }] (only the first is used)
// essay:   { title, url, date }
// bluesky: handle without the @ (site.yaml `bluesky`)
// -> { files: Map<rel, Buffer|string>, links: Map<item, url> }
export const sigFiles = async ({ dailies, essay, bluesky, siteUrl = "" }) => {
  const files = new Map();
  const links = new Map();
  // Three images are pasted once; drawing two would leave a broken one.
  if (!dailies.length || !essay || !bluesky) throw new Error("sig needs a daily, an essay and a bluesky handle");
  const newest = dailies[0];
  const dateStr = newest.date.toISOString().slice(0, 10);
  const hue = dayFrame(dateStr);

  const cols = [
    [`latest post · ${shortDate(newest.date)}`, newest.title ? await fitTitle(newest.title) : "(untitled)"],
    [`latest essay · ${shortDate(essay.date)}`, await fitTitle(essay.title)],
    ["bluesky", `@${bluesky}`],
  ];
  const cw = await Promise.all(cols.map(async ([l, v]) => Math.max(await widthOf(l), await widthOf(v))));
  const left = 1 + PAD;
  const W = Math.ceil(Math.max(TAG_X + (await widthOf(TAGLINE)), left + cw[0] + cw[1] + cw[2] + 2 * GAP) + PAD + 1);

  const col = (i, text, color) => h("div", { display: "flex", width: cw[i] + (i < 2 ? GAP : 0) }, span(text, { color }));
  const panel = h("div", { display: "flex", flexDirection: "column", width: W, height: SIG_H, paddingLeft: left, paddingTop: 4 }, [
    line([h("div", { width: TAG_X - left }, ""), span(TAGLINE, { color: C.tag })], 16),
    h("div", { height: 6 }, ""),
    line(cols.map(([l], i) => col(i, l, hue)), 16),
    line(cols.map(([, v], i) => col(i, v, C.title)), 16),
  ]);
  const svg = await satori(panel, { width: W, height: SIG_H, fonts: loadFonts() });
  // The text is rendered once and its pixels sliced: cropping by viewBox made
  // resvg panic (a Rust abort, not a throw — it takes the whole build down)
  // at most offsets, 2026-10-16.
  const text = new Resvg(svg, { fitTo: { mode: "zoom", value: SIG_SCALE } }).render().pixels;
  const img = composite(background(dateStr, W), text, W);

  // Cut points in whole CSS px, mid-gap, so at 2× every piece meets its
  // neighbour on the pixel grid and the three read as one picture.
  const x1 = Math.round(left + cw[0] + GAP / 2);
  const x2 = Math.round(left + cw[0] + GAP + cw[1] + GAP / 2);
  const cuts = [0, x1, x2, W].map((x) => x * SIG_SCALE);
  const urls = [newest.url, essay.url, `https://bsky.app/profile/${bluesky}`];
  for (const [i, item] of SIG_ITEMS.entries()) {
    files.set(`sig/${item}.png`, slicePng(img, W * SIG_SCALE, SIG_H * SIG_SCALE, cuts[i], cuts[i + 1]));
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
