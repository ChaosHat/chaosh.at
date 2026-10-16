// The forum signature: one line of text — wordmark, the three newest dailies,
// the Bluesky handle, the newest essay — cut into six tiles that sit flush in a BBCode signature
// and read as a single line. Each tile is a stable image URL the build redraws
// nightly, wrapped in a stable link (/sig/<tile>/) that forwards to whatever
// the tile shows tonight. Changing dates are the point: a sig that visibly
// updates reads as a live site, not an ad (Hat, 2026-10-15).
//
// Deliberately quiet. The first mockup — five framed tiles, each on its own
// day's sky, pixel-font dates — was "a little much" (Hat); this is text on a
// transparent ground, dark-forum colours, with one wisp of the newest day's
// sky behind the wordmark as the only aurora.
//
// Same pipeline as og.js — satori lays out, resvg rasterises — and the same
// rule: everything here may throw, and the config wraps it, so a sig that
// fails costs the sig, never the build.
import fs from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { daySky } from "./aurora.js";
import { wordmarkSvg } from "./button.js";

// Drawn at 2× and shown at 1× by the BBCode's [IMG width=…] — a 1× PNG went
// soft on hi-dpi screens (Hat, 2026-10-15; Coin Return's XenForo honours the
// width attribute). The width is typed once into the signature but the
// content changes nightly, so every tile has a FIXED width: the widest it can
// ever need, transparent where the text runs short. The essay goes last so
// its slack trails off the end of the line instead of opening a gap.
export const SIG_H = 24;
export const SIG_SCALE = 2;
export const SIG_TILES = ["home", "d1", "d2", "d3", "bsky", "essay"];

const C = { muted: "#8b8fa3", link: "#b4b1d8", ink: "#eceafa" };
const FONT_DIR = "og-fonts";
let fonts = null;
const loadFonts = () =>
  (fonts ??= [
    ["Alegreya Sans", "alegreya-sans-400.ttf", 400],
    ["Alegreya Sans", "alegreya-sans-700.ttf", 700],
    // Tabular digits (see og-fonts/SUBSET.md) — dates only.
    ["Sig Digits", "alegreya-sans-700-sigdigits.ttf", 700],
  ].map(([name, file, weight]) => ({
    name,
    weight,
    style: "normal",
    data: fs.readFileSync(path.join(FONT_DIR, file)),
  })));

const h = (type, style, children, props = {}) => ({ type, props: { style, children, ...props } });
const svgUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const span = (text, style) => h("span", style, text);

// The newest day's sky, faded out at every edge by a radial mask, so it sits
// on the forum's background as a wisp rather than a box.
const wisp = (dateStr, w, ht) => {
  const sky = daySky(dateStr).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${ht}' viewBox='0 0 480 96' preserveAspectRatio='none'>` +
    `<defs><radialGradient id='rf' cx='0.5' cy='0.55' r='0.5'>` +
    `<stop offset='0.35' stop-color='#fff'/><stop offset='1' stop-color='#000'/></radialGradient>` +
    `<mask id='rm'><rect width='480' height='96' fill='url(#rf)'/></mask></defs>` +
    `<g mask='url(#rm)'>${sky}</g></svg>`
  );
};

const wordmark = () =>
  wordmarkSvg(1)
    .replace('class="wordmark" ', 'xmlns="http://www.w3.org/2000/svg" ')
    .replace("currentColor", C.ink);

const row = (children) =>
  h(
    "div",
    {
      display: "flex",
      alignItems: "center",
      height: SIG_H,
      position: "relative",
      fontFamily: "Alegreya Sans",
      fontSize: 14,
      whiteSpace: "nowrap",
    },
    children,
  );

const render = async (tree, width) => {
  const svg = await satori(tree, { width, height: SIG_H, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: "zoom", value: SIG_SCALE } }).render().asPng();
};

// The essay title is the one free-length thing on the line, so it decides the
// line's width. Capped at ESSAY_MAX px: cut at a word, "…" appended, trailing
// period dropped (a full stop mid-line reads as the line ending). At the cap
// the whole sig stays ~620px however an essay is titled (Hat, 2026-10-15).
export const ESSAY_MAX = 200;
const titleSpan = (text) => span(text, { color: C.link, fontWeight: 700 });
const widthOf = async (...nodes) =>
  Number(/width="([\d.]+)"/.exec(await satori(row(nodes), { height: SIG_H, fonts: loadFonts() }))?.[1]);
const fitTitle = async (title) => {
  const clean = title.trim().replace(/\.$/, "");
  if ((await widthOf(titleSpan(clean))) <= ESSAY_MAX) return clean;
  const words = clean.split(/\s+/);
  for (let n = words.length - 1; n > 0; n -= 1) {
    const cut = `${words.slice(0, n).join(" ").replace(/[\s,;:.\-—–]+$/, "")}…`;
    if ((await widthOf(titleSpan(cut))) <= ESSAY_MAX) return cut;
  }
  return `${words[0]}…`;
};

// Tile contents, shared by the drawing and the width probe so the two can't
// drift apart.
const homeKids = (newest) => [
  h("img", { position: "absolute", left: -8, top: -4 }, undefined, {
    src: svgUri(wisp(newest, 92, 32)),
    width: 92,
    height: 32,
  }),
  h("img", { marginLeft: 2, marginRight: 8 }, undefined, { src: svgUri(wordmark()), width: 72, height: 8 }),
  span("· daily:", { color: C.muted, marginRight: 6 }),
];
const dateKids = (text, comma) =>
  [span(text, { color: C.link, fontWeight: 700, fontFamily: "Sig Digits" }), comma ? span(",", { color: C.muted, marginRight: 5 }) : null].filter(Boolean);
const bskyKids = (handle) => [
  span("· bluesky:", { color: C.muted, marginLeft: 6, marginRight: 5 }),
  span(`@${handle}`, { color: C.link, fontWeight: 700 }),
];
const essayLabel = () => span("· essay:", { color: C.muted, marginLeft: 6, marginRight: 5 });

// Each tile's fixed width (CSS px). Dates are always MM/DD in tabular digits,
// so one probe is every date's width — no slack, nothing clips. (Sizing for
// the widest proportional digit left up to 16px holes after "1/5"; Hat chose
// zero-padding over that, 2026-10-15.) Nothing here depends on tonight's posts.
let widths = null;
export const sigWidths = async (bluesky) =>
  (widths ??= await (async () => {
    const date = Math.ceil(await widthOf(...dateKids("00/00", true)));
    return {
      home: Math.ceil(await widthOf(...homeKids("2026-01-01"))),
      d1: date,
      d2: date,
      // The last date carries no comma, so it is narrower — sized like the
      // others it left a hole before "· bluesky".
      d3: Math.ceil(await widthOf(...dateKids("00/00", false))),
      bsky: bluesky ? Math.ceil(await widthOf(...bskyKids(bluesky))) : 0,
      essay: Math.ceil((await widthOf(essayLabel())) + ESSAY_MAX),
    };
  })());

const pad = (n) => String(n).padStart(2, "0");
const shortDate = (d) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;

// dailies: newest first, [{ date: Date, url }] (only the first three are used)
// essay:   { title, url } | null
// bluesky: handle without the @ (site.yaml `bluesky`) | null
// -> { files: Map<rel, Buffer|string>, links: Map<tile, url> }
export const sigFiles = async ({ dailies, essay, bluesky, siteUrl = "" }) => {
  const files = new Map();
  const links = new Map();
  const days = dailies.slice(0, 3);
  if (days.length === 0) return { files, links };
  const newest = days[0].date.toISOString().slice(0, 10);

  const W = await sigWidths(bluesky);

  files.set("sig/home.png", await render(row(homeKids(newest)), W.home));
  links.set("home", "/");

  for (const [i, day] of days.entries()) {
    const t = `d${i + 1}`;
    files.set(`sig/${t}.png`, await render(row(dateKids(shortDate(day.date), i < days.length - 1)), W[t]));
    links.set(t, day.url);
  }

  // The one tile that never changes; it rides along so the line has a way to
  // follow, not just to read (Hat, 2026-10-15).
  if (bluesky) {
    files.set("sig/bsky.png", await render(row(bskyKids(bluesky)), W.bsky));
    links.set("bsky", `https://bsky.app/profile/${bluesky}`);
  }

  if (essay) {
    files.set("sig/essay.png", await render(row([essayLabel(), titleSpan(await fitTitle(essay.title))]), W.essay));
    links.set("essay", essay.url);
  }

  const abs = (to) => (to.startsWith("/") ? siteUrl + to : to);
  // The link pages: same shape as src/redirect.njk — a refresh for people,
  // noindex so the stubs stay out of search.
  for (const [tile, to] of links)
    files.set(
      `sig/${tile}/index.html`,
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta http-equiv="refresh" content="0; url=${to}">` +
        `<link rel="canonical" href="${abs(to)}"><meta name="robots" content="noindex">` +
        `<title>chaosh.at</title></head><body><p><a href="${to}">${abs(to)}</a></p></body></html>`,
    );

  return { files, links };
};

// The BBCode Hat pastes once. Tiles must be flush — any whitespace between
// the tags renders as a gap in the line. The widths are what pin the 2× PNGs
// to 1× on the page; if they ever change (font, labels, ESSAY_MAX), the sig
// must be re-pasted.
export const sigBbcode = async (siteUrl, bluesky, tiles = SIG_TILES) => {
  const W = await sigWidths(bluesky);
  return tiles
    .filter((t) => W[t])
    .map((t) => `[URL=${siteUrl}/sig/${t}/][IMG width="${W[t]}px"]${siteUrl}/sig/${t}.png[/IMG][/URL]`)
    .join("");
};
