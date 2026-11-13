import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { load as parseYaml } from "js-yaml";
import MarkdownIt from "markdown-it";
import { pixelSubject, pixelBand, pixelBandForm, pixelLayers, pixelLightSheet, PIXEL_LIGHT_BELOW, starTile, dayFrame, palette, hashOf } from "./aurora.js";
import { encodePng, encodePngIndexed } from "./png.js";
import { buttonFiles, cometMarkSvg, wordmarkSvg } from "./button.js";
import { sigFiles } from "./sig.js";
import { assignSlots, huesFrom, readLock } from "./hues.js";
import { cloudHtml, cloudStack, cloudYear, vocabulary } from "./wordcloud.js";

// One markdown-it instance renders everything: whole daily posts, the fragments
// sliced out of them, and standing essays. Same instance => a fragment on a
// subject page is byte-identical to the same text on its daily post.
const md = new MarkdownIt({ html: true, linkify: true });

// Obsidian image embeds: ![[foo.png]], ![[foo.png|alt text]], ![[foo.png|640]]
// (digits = width, like Obsidian). publish.py copies the referenced file to
// src/img/posts/<safe name> (<safe name>.webp for a PNG since 2026-11-11 —
// see publishedNames) and REFUSES any post whose image it can't find, so
// a rendered embed never 404s. The safe-name transform and extension list
// mirror image_safe_name()/IMAGE_EXTS in chaosh_subjects.py — if one changes,
// change both. Non-image embeds (![[Some Note]] transclusion) are left as
// literal text here; publish.py refuses those posts before they get this far.
// Exported (with normalise/essaySlug/splitSections below) for parity.mjs,
// which diffs these against their Python mirrors in chaosh_subjects.py.
const IMAGE_EMBED = /^!\[\[([^\]]+?)\]\]/;
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
export const imageSafeName = (name) => name.replace(/[^A-Za-z0-9._-]+/g, "-");
// Placement hints: ![[shot.jpg|left]], |right, |full — the author's word on
// where an image goes, overriding the automatic choice (width number, then
// alternation). Never alt text. Same words Minimal/ITS use for image floats.
// (2026-10-23, after the 10-22 daily's second shot was stranded.)
const PLACE_HINT = /^(left|right|full)$/i;
// The file an embed is published as (2026-11-11): a PNG publish.py has
// processed since this date is <safe name>.webp, recorded as the "name" of
// its src/img/manifest.json entry; every other image is its safe name, as
// before. Filled from the manifest in eleventy.before (below), so the page,
// its figures, the lightbox's data-full and both feeds all take the src
// this rule writes. The embed's own name stays the key everywhere else.
const publishedNames = new Map(); // safe name -> published file, only where they differ

md.inline.ruler.before("image", "obsidian_image", (state, silent) => {
  const m = IMAGE_EMBED.exec(state.src.slice(state.pos));
  if (!m) return false;
  const parts = m[1].split("|").map((p) => p.trim());
  const name = parts[0].split("/").pop();
  if (!IMAGE_EXT.test(name)) return false;
  if (!silent) {
    const width = parts.slice(1).map((p) => /^(\d+)(?:x\d+)?$/.exec(p)).find(Boolean);
    const place = parts.slice(1).map((p) => PLACE_HINT.exec(p)?.[0].toLowerCase()).find(Boolean);
    const alt = parts.slice(1).find((p) => p && !/^\d+(x\d+)?$/.test(p) && !PLACE_HINT.test(p)) ?? "";
    const token = state.push("image", "img", 0);
    if (place) token.meta = { place };
    const safe = imageSafeName(name);
    token.attrs = [["src", `/img/posts/${publishedNames.get(safe) ?? safe}`], ["alt", alt]];
    if (width) token.attrs.push(["width", width[1]]);
    token.children = [];
    if (alt) {
      const text = new state.Token("text", "", 0);
      text.content = alt;
      token.children.push(text);
    }
    token.content = alt;
  }
  state.pos += m[0].length;
  return true;
});

// Figures. Obsidian has no caption syntax, so the Manual's convention is an
// italic line in its own paragraph directly under the image:
//   ![[ripley-power-loader.jpg|Ripley in the power loader]]
//   *The Varia suit is truly a triumph of miniaturization.*
// This folds that pair into <figure><img><figcaption>…</figcaption></figure>,
// and a lone image paragraph into a bare <figure>, so the CSS styles one thing
// and feed readers get a real caption instead of two paragraphs. The wrapping
// <em> is dropped — the italic was the signal, not the styling (the caption
// face is the pixel face, which has no italic); emphasis inside it survives.
// Runs after "inline" so the children are parsed. (2026-09-08, Metroid Dread.)
//
// Two styles, chosen by Obsidian's own width number so the vault preview
// approximates the page. Default (no width, or under FIG_FULL_PX) is a
// magazine float: half the column, hung into the margin, prose wrapping
// beside it — the accent shot. A width of FIG_FULL_PX or more is the full
// column — the "look at this" shot, where a pixel screenshot at half size
// would lose the thing being pointed at. Which side a float takes is decided
// by obsidian_float_sides below, shared with asides. The width attr stays on the <img> either way (harmless: the CSS
// sizes the image to its figure).
const FIG_FULL_PX = 700;
const isImageParagraph = (t, i) =>
  t[i]?.type === "paragraph_open" &&
  t[i + 1]?.type === "inline" &&
  t[i + 1].children.length === 1 &&
  t[i + 1].children[0].type === "image" &&
  t[i + 2]?.type === "paragraph_close";
const isCaptionParagraph = (t, i) => {
  if (t[i]?.type !== "paragraph_open" || t[i + 1]?.type !== "inline" || t[i + 2]?.type !== "paragraph_close") return false;
  const c = t[i + 1].children;
  return c.length >= 3 && c[0].type === "em_open" && c[c.length - 1].type === "em_close" &&
    c.slice(1, -1).every((x) => x.level > 0);
};
// An image whose next line is more text, with no blank line between, used to
// share one paragraph with it and render as an inline <img> beside a line of
// prose: no figure, no column, no lightbox, while Obsidian shows the two
// forms the same (the 2026-10-11 and 10-18 dailies). So a paragraph that
// OPENS with an image line is cut after it, as if the blank line were there:
// the image becomes its own paragraph (a figure, below) and the rest a
// paragraph of its own — a caption if it's wholly italic, prose otherwise.
// Repeats, so image lines stacked one under another each become a figure.
// Prose first and an image on the next line is left alone: the Manual calls
// that inline. Tight-list paragraphs (hidden) are left alone too. (2026-11-11.)
const splitImageLines = (state) => {
  const t = state.tokens;
  const out = [];
  for (let i = 0; i < t.length; i++) {
    const kids = t[i + 1]?.children;
    if (t[i].type !== "paragraph_open" || t[i].hidden || t[i + 1]?.type !== "inline" ||
        t[i + 2]?.type !== "paragraph_close" || kids.length < 3 || kids[0].type !== "image" ||
        (kids[1].type !== "softbreak" && kids[1].type !== "hardbreak")) {
      out.push(t[i]);
      continue;
    }
    const [open, inline, close] = t.slice(i, i + 3);
    const lead = new state.Token("inline", "", 0);
    lead.children = [kids[0]];
    lead.content = inline.content.split("\n")[0];
    lead.map = open.map && [open.map[0], open.map[0] + 1];
    const leadOpen = new state.Token("paragraph_open", "p", 1);
    const leadClose = new state.Token("paragraph_close", "p", -1);
    leadOpen.block = leadClose.block = true;
    leadOpen.level = leadClose.level = open.level;
    lead.level = inline.level;
    leadOpen.map = lead.map;
    out.push(leadOpen, lead, leadClose);
    // The rest goes back round: it may open with another image line.
    inline.children = kids.slice(2);
    inline.content = inline.content.slice(inline.content.indexOf("\n") + 1);
    if (open.map) open.map = [open.map[0] + 1, open.map[1]];
    i--;
  }
  state.tokens = out;
};

md.core.ruler.push("obsidian_figure", (state) => {
  splitImageLines(state);
  const t = state.tokens;
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (!isImageParagraph(t, i)) { out.push(t[i]); continue; }
    const open = new state.Token("figure_open", "figure", 1);
    const close = new state.Token("figure_close", "figure", -1);
    open.block = close.block = true;
    open.map = t[i].map;
    open.level = t[i].level;
    const img = t[i + 1].children[0];
    const width = Number(img.attrGet("width"));
    const place = img.meta?.place;
    if (place === "full" || (!place && width >= FIG_FULL_PX)) {
      open.attrSet("class", "fig-full");
    } else {
      open.attrSet("class", "fig-float");
      if (place) open.meta = { side: place };
    }
    out.push(open, t[i + 1]);
    i += 2;
    if (isCaptionParagraph(t, i + 1)) {
      const capOpen = new state.Token("figcaption_open", "figcaption", 1);
      const capClose = new state.Token("figcaption_close", "figcaption", -1);
      capOpen.block = capClose.block = true;
      const inline = t[i + 2];
      inline.children = inline.children.slice(1, -1);
      out.push(capOpen, inline, capClose);
      i += 3;
    }
    out.push(close);
  }
  state.tokens = out;
});

// Asides. Written in the vault as an Obsidian callout, so the editor previews
// it as a box too:
//   > [!aside] New to Fortune's Weave?
//   > Two paragraphs of primer for readers who haven't played.
// The blockquote becomes <aside class="aside">; text after the marker on the
// first line becomes its title (<p class="aside-title">), and a bare
// `[!aside]` has none. Obsidian's fold markers ([!aside]- / [!aside]+) are
// accepted and ignored — the page never folds. Only `aside` is claimed; any
// other callout type stays a plain blockquote. (2026-10-14, the Fortune's
// Weave primer.)
// `[!aside|left]` / `[!aside|right]` (Obsidian's callout-metadata slot) pins
// the side, like an image's placement hint.
const ASIDE_MARK = /^\[!aside(?:\|(left|right))?\][+-]?[ \t]*/i;
// Any other callout type (`> [!note] Title`) stays a plain blockquote, but
// without its marker: until 2026-11-11 the page printed "[!note] Title" as
// typed. The marker goes, and the title, when there is one, becomes the
// quote's first line as a paragraph of its own; a bare `[!note]` leaves the
// body alone. No box, no icon, no fold — only aside is claimed.
const CALLOUT_MARK = /^\[![a-z][\w-]*(?:\|[^\]]*)?\][+-]?[ \t]*/i;
const plainCallout = (state, t, i, inline, first, m) => {
  first.content = first.content.slice(m[0].length);
  const kids = inline.children;
  const br = kids.findIndex((c) => c.type === "softbreak" || c.type === "hardbreak");
  const title = br < 0 ? kids : kids.slice(0, br);
  const body = br < 0 ? [] : kids.slice(br + 1);
  const hasTitle = title.some((c) => c.type !== "text" || c.content.trim());
  if (!hasTitle && !body.length) t.splice(i + 1, 3);
  else if (!hasTitle) inline.children = body;
  else if (body.length) {
    inline.children = title;
    const open = new state.Token("paragraph_open", "p", 1);
    const close = new state.Token("paragraph_close", "p", -1);
    const rest = new state.Token("inline", "", 0);
    open.block = close.block = true;
    open.level = close.level = t[i + 1].level;
    rest.children = body;
    rest.content = "";
    t.splice(i + 4, 0, open, rest, close);
  }
};
md.core.ruler.push("obsidian_aside", (state) => {
  const t = state.tokens;
  for (let i = 0; i < t.length; i++) {
    if (t[i].type !== "blockquote_open" || t[i + 1]?.type !== "paragraph_open") continue;
    const inline = t[i + 2];
    const first = inline?.children?.[0];
    const m = first?.type === "text" && ASIDE_MARK.exec(first.content);
    if (!m) {
      const c = first?.type === "text" && CALLOUT_MARK.exec(first.content);
      if (c) plainCallout(state, t, i, inline, first, c);
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < t.length; j++) {
      if (t[j].type === "blockquote_open") depth++;
      else if (t[j].type === "blockquote_close" && --depth === 0) break;
    }
    t[i].tag = t[j].tag = "aside";
    t[i].attrSet("class", "aside");
    if (m[1]) t[i].meta = { side: m[1].toLowerCase() };
    first.content = first.content.slice(m[0].length);
    // The title is the first line; the rest of that paragraph is body.
    const kids = inline.children;
    const br = kids.findIndex((c) => c.type === "softbreak" || c.type === "hardbreak");
    const title = br < 0 ? kids : kids.slice(0, br);
    const body = br < 0 ? [] : kids.slice(br + 1);
    const hasTitle = title.some((c) => c.type !== "text" || c.content.trim());
    if (!hasTitle && !body.length) {
      t.splice(i + 1, 3); // marker alone on its line: drop the empty paragraph
    } else if (!hasTitle) {
      inline.children = body;
    } else {
      inline.children = title;
      t[i + 1].attrSet("class", "aside-title");
      if (body.length) {
        const open = new state.Token("paragraph_open", "p", 1);
        const close = new state.Token("paragraph_close", "p", -1);
        const rest = new state.Token("inline", "", 0);
        open.block = close.block = true;
        rest.children = body;
        rest.content = "";
        t.splice(i + 4, 0, open, rest, close);
      }
    }
  }
});

// Float sides. Floated figures and asides are one sequence, so they take
// turns: right, left, right… per rendered document (so per section in a
// daily). It starts right because an essay's lone card floats left through
// the opening paragraphs. Decided here rather than with :nth-of-type so full
// figures don't count and a figure and an aside don't each run their own
// alternation and land facing each other across a strip of prose. The CSS
// clears every float, so at most one sits beside the text at any height;
// alternation is what keeps the page from leaning, clearing is what keeps it
// from colliding. Only top-level blocks count — a figure inside an aside
// rides with the aside. (2026-10-14.)
// Two floats back to back in the source can't both have prose beside them:
// the second clears the first, so either the first stands beside empty
// space or (before this) the paragraph after them jogged sideways halfway
// down when the second appeared. A magazine anchors every box to a
// paragraph, so the renderer does too — a float that directly follows
// another float moves below the next paragraph or list. Never across a
// heading: that would move it into another section. (2026-10-14, Leda's
// picture and the Fortune's Weave primer, written one after the other.)
// Since the margin column (style.css, 2026-10-23) post prose puts every
// float in one right-hand column and ignores the side classes; they still
// steer a float outside post prose, and the swaps still decide which
// paragraph a box sits beside.
const isFloatOpen = (tok) =>
  tok.level === 0 &&
  ((tok.type === "figure_open" && tok.attrGet("class") === "fig-float") ||
    (tok.type === "blockquote_open" && tok.attrGet("class") === "aside"));
const topBlocks = (tokens) => {
  const blocks = [];
  for (let i = 0; i < tokens.length; i++) {
    let j = i;
    if (tokens[i].nesting === 1) {
      let depth = 0;
      for (; j < tokens.length; j++) {
        depth += tokens[j].nesting;
        if (depth === 0) break;
      }
    }
    blocks.push(tokens.slice(i, j + 1));
    i = j;
  }
  return blocks;
};
const ANCHOR = new Set(["paragraph_open", "bullet_list_open", "ordered_list_open"]);

md.core.ruler.push("obsidian_float_sides", (state) => {
  const blocks = topBlocks(state.tokens);
  for (let k = 1; k < blocks.length - 1; k++) {
    if (isFloatOpen(blocks[k][0]) && isFloatOpen(blocks[k - 1][0]) && ANCHOR.has(blocks[k + 1][0].type)) {
      [blocks[k], blocks[k + 1]] = [blocks[k + 1], blocks[k]];
      k++;
    }
  }
  // A float that ends its section has no prose after it to sit beside, so it
  // hung below the last line with empty space next to it (the 10-22 robocobo
  // shot). It moves up past the paragraph before it instead — almost always
  // the one it was about. Never across a heading. (2026-10-23.)
  const isSectionEnd = (b) => !b || (b[0].type === "heading_open" && b[0].tag === "h2");
  for (let k = 1; k < blocks.length; k++) {
    if (isFloatOpen(blocks[k][0]) && isSectionEnd(blocks[k + 1]) && ANCHOR.has(blocks[k - 1][0].type)) {
      [blocks[k - 1], blocks[k]] = [blocks[k], blocks[k - 1]];
    }
  }
  state.tokens = blocks.flat();
  // The count restarts at every ## because a daily renders whole and is then
  // split into fragments, each with its cover on the left: carried across
  // sections, the Lazarus shot came in as a left float and hung over the
  // cover card (2026-10-19). Restarting puts each section's first float on
  // the right, and a section reads the same on the day as on its /s/ page,
  // which renders it alone.
  // A placement hint (|left / |right, [!aside|left]) wins; an unhinted float
  // takes the side opposite the float before it, so the alternation carries
  // on from wherever the author put the last one. (2026-10-23.)
  let prev = "left";
  for (const tok of state.tokens) {
    if (tok.level !== 0) continue;
    if (tok.type === "heading_open" && tok.tag === "h2") prev = "left";
    const cls = tok.attrGet("class") ?? "";
    const isFloat =
      (tok.type === "figure_open" && cls === "fig-float") ||
      (tok.type === "blockquote_open" && cls === "aside");
    if (!isFloat) continue;
    const side = tok.meta?.side ?? (prev === "left" ? "right" : "left");
    prev = side;
    tok.attrSet("class", `${cls} ${cls === "aside" ? "aside" : "fig"}-${side}`);
  }
});

// `title:` as typed is YAML, so `title: 1984` arrives as a number and
// `title: 2026-01-01` as a Date, and consumers assumed a string: the forum
// sig died on `title.trim` and skipped all three /sig/ images (2026-11-11).
// Coerced once, where a title enters — a daily's computed data
// (daily.11tydata.js) and an essay's entry (buildEssayList) — so nothing
// downstream has to. A date reads back as the YYYY-MM-DD that was typed
// (YAML dates are UTC midnight); blank or missing stays blank, "untitled".
export const titleText = (t) => {
  if (t == null) return "";
  if (t instanceof Date) return Number.isNaN(t.getTime()) ? "" : t.toISOString().slice(0, 10);
  return String(t).trim();
};

// Headings are matched loosely so "DQXIS", "dqxi s" and "Dragon Quest XI S"
// all land on the same subject.
export const normalise = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// An essay's filename is a working label, not plumbing: "Atlus Narrative
// Issues.md" publishes at /e/atlus-narrative-issues/ without being renamed.
// Mirrors essay_slug() in chaosh_subjects.py — if one changes, change both.
export const essaySlug = (stem) => normalise(stem).replace(/ /g, "-");

// Split raw markdown on "## " only. H3+ travels with its parent section, and
// prose above the first H2 belongs to the day, not to any subject. Module
// scope (it closes over nothing) so parity.mjs can diff it against the
// Python side's H2_RE scan.
export const splitSections = (raw) => {
  const sections = [];
  let current = null;
  for (const line of String(raw).split("\n")) {
    const m = /^##(?!#)\s*(.*)$/.exec(line);
    if (m) {
      current = { heading: m[1].trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return sections;
};

// The lit-days strip on subject pages: one square per day a subject was
// written about, gaps in between left dark. It shows writing RHYTHM as shape —
// a 19-day unbroken run, a scatter ending in a cluster — where the sky's
// brightness tiers carry recency. Essays count, same as for the tiers.
//
// Gaps longer than STRIP_FOLD days fold into a single labelled break ("2y")
// instead of a wall of dark squares, so a replay two years on shows both
// playthroughs and the distance between them, and a board game picked up a
// few times a year reads as a chain of short runs (Hat's call, 2026-10-05).
// Short gaps stay as squares: those ARE the rhythm.
//
// STRIP_MAX caps the squares, keeping the most recent; `clipped` tells the
// template the oldest history was cut. With `tail`, the strip runs on to the
// newest day that COULD be lit — dark squares if the silence is short, one
// folded break ending in a hollow end square if it's long — so a stalled game
// shows that it stalled. Fewer than two lit days is no pattern at all: null,
// no strip.
//
// That newest day is yesterday in New York, not the build's today: publish.py
// holds a daily until its day is over, so today is never lit at build time and
// ending the tail there put a false dark square on every active subject (the
// strip's first night, 2026-10-06). New York, not UTC: an evening push builds
// after UTC midnight, which would have pushed the tail a day further still.
export const STRIP_FOLD = 30;
export const STRIP_MAX = 90;
export const STRIP_TAIL = true;
const DAY_MS = 86400000;
const dayKey = (d) => d.toISOString().slice(0, 10);
const dayOf = (key) => new Date(`${key}T00:00:00Z`).getTime();
export const lastShippable = (now = new Date()) => {
  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  return new Date(dayOf(ny) - DAY_MS);
};
export const gapLabel = (days) =>
  days < 56 ? `${Math.round(days / 7)}w`
  : days < 730 ? `${Math.round(days / 30.4)}mo`
  : `${Math.round(days / 365)}y`;

// Ray height on a lit day tracks how much was written that day: log-scaled so
// a long day reads taller without dwarfing everything, floor so a one-liner
// still shows, cap so an essay day doesn't punch through the page. ~10px for a
// one-line note, ~18px for a solid paragraph, 28px at the cap (Hat, 2026-10-05).
export const rayHeight = (words) =>
  Math.round(Math.min(28, 6 + 5 * Math.log2(1 + words / 15)));

// `entries`: [{ date, words }] — several on one day sum.
export const foldStrip = (entries, { tail = false, through = lastShippable() } = {}) => {
  const words = new Map();
  for (const { date, words: w } of entries) {
    const key = dayKey(date);
    words.set(key, (words.get(key) ?? 0) + (w ?? 0));
  }
  const lit = [...words.keys()].sort();
  if (lit.length < 2) return null;

  // Runs: maximal stretches with no gap over STRIP_FOLD.
  const runs = [[lit[0]]];
  for (const key of lit.slice(1)) {
    const prev = runs.at(-1).at(-1);
    if ((dayOf(key) - dayOf(prev)) / DAY_MS > STRIP_FOLD) runs.push([key]);
    else runs.at(-1).push(key);
  }

  const segments = [];
  runs.forEach((run, i) => {
    if (i > 0) {
      const gap = (dayOf(run[0]) - dayOf(runs[i - 1].at(-1))) / DAY_MS - 1;
      segments.push({ gap: gapLabel(gap) });
    }
    const set = new Set(run);
    const days = [];
    for (let t = dayOf(run[0]); t <= dayOf(run.at(-1)); t += DAY_MS) {
      const key = dayKey(new Date(t));
      days.push(set.has(key)
        ? { key, lit: true, words: words.get(key), h: rayHeight(words.get(key)) }
        : { key, lit: false });
    }
    segments.push({ days });
  });

  if (tail) {
    const endKey = dayKey(through);
    const since = (dayOf(endKey) - dayOf(lit.at(-1))) / DAY_MS;
    if (since > STRIP_FOLD) {
      segments.push({ gap: gapLabel(since - 1), tail: true });
      segments.push({ days: [{ key: endKey, lit: false, today: true }] });
    } else if (since > 0) {
      const last = segments.at(-1).days;
      for (let t = dayOf(lit.at(-1)) + DAY_MS; t <= dayOf(endKey); t += DAY_MS) {
        last.push({ key: dayKey(new Date(t)), lit: false });
      }
      last.at(-1).today = true;
    }
  }

  // Cap from the newest end backwards; a run that straddles the cap is cut
  // from its left, and a break left dangling at the front goes with it.
  let budget = STRIP_MAX;
  let clipped = false;
  const kept = [];
  for (const seg of segments.slice().reverse()) {
    if (budget <= 0) { clipped = true; break; }
    if (seg.days) {
      if (seg.days.length > budget) {
        kept.unshift({ days: seg.days.slice(-budget) });
        clipped = true;
        budget = 0;
        continue;
      }
      budget -= seg.days.length;
    }
    kept.unshift(seg);
  }
  while (kept[0]?.gap) kept.shift();
  // A running index across every square, for the CSS shimmer's travelling
  // delay — the wave crosses folded breaks without restarting.
  let i = 0;
  for (const seg of kept) for (const d of seg.days ?? []) d.i = i++;

  return { segments: kept, clipped, first: lit[0], last: lit.at(-1) };
};

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  // The stylesheet is cached for hours while pages revalidate, so a deploy
  // could pair new markup with old CSS. base.njk links it as
  // /css/style.css?v=<this>: the first 10 hex of the file's sha256, read at
  // build time, so the URL changes exactly when the contents do.
  eleventyConfig.addGlobalData("cssVersion", () =>
    crypto.createHash("sha256").update(fs.readFileSync(path.join("src", "css", "style.css"))).digest("hex").slice(0, 10));
  eleventyConfig.addPassthroughCopy({ "src/fonts": "fonts" });
  // src/fonts/SUBSET.md (how the woff2s were cut) is a note, not a page: as a
  // template it published at /fonts/SUBSET/ and ran through Nunjucks, where
  // a `{{` in a shell snippet would have stopped the build (2026-11-11). Out
  // of template processing; the passthrough above still copies it verbatim
  // to /fonts/SUBSET.md beside the fonts and licences it documents.
  eleventyConfig.ignores.add("src/fonts/**");
  // Cloudflare Pages control files, and the fediverse host-meta (see
  // src/_redirects for why it's a static file and not a redirect).
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });
  eleventyConfig.addPassthroughCopy({ "src/_headers": "_headers" });
  // Favicons (2026-10-19): the masthead's comet, simplified — 16 hand-drawn,
  // 32 from the same funnel drawing, 180 the 32 at ×5 on a night tile. Fixed
  // colours (one day's sky, baked), not per-day: browsers cache these hard.
  for (const f of ["favicon.ico", "favicon-16.png", "favicon-32.png", "apple-touch-icon.png"])
    eleventyConfig.addPassthroughCopy({ [`src/favicon/${f}`]: f });
  eleventyConfig.addPassthroughCopy({ "src/.well-known/host-meta": ".well-known/host-meta" });
  // Post images only — src/img/manifest.json is publish.py book-keeping and
  // deliberately not copied. (Read below since 2026-11-11, never served.)
  // src/img/posts/thumb/ rides along: the thumbnails are served beside the
  // full files, at /img/posts/thumb/<name>.webp.
  eleventyConfig.addPassthroughCopy({ "src/img/posts": "img/posts" });
  eleventyConfig.addPassthroughCopy({ "src/img/covers": "img/covers" });
  // Friends' 88×31s for /links/, hosted here rather than hotlinked: a copy
  // survives their site moving and costs them no bandwidth. links.yaml points
  // at /img/buttons/<name>.
  eleventyConfig.addPassthroughCopy({ "src/img/buttons": "img/buttons" });
  // Badge icons: pixelarticons (MIT) plus the drawn canon star.
  eleventyConfig.addPassthroughCopy({ "src/img/icons": "img/icons" });

  // ------------------------------------------------------------ post images
  // Thumbnails, dimensions and lazy loading (2026-11-11, code check finding
  // 1). Every post image was its full 1600px file (~2 MB a PNG screenshot)
  // with no size and no loading hint, even as a 256px column figure or a
  // 52px phone tile: /games/ and /log/ pulled ~95 MB, home 15.5 MB.
  // publish.py now writes a ~640px WebP beside each one
  // (src/img/posts/thumb/<name>.webp) and records both files' pixel sizes
  // in src/img/manifest.json. A column figure (fig-float: the image column,
  // the tile rail, a figure in an aside) shows the thumbnail, sized, lazy,
  // with the full file in data-full for the lightbox (base.njk); a |full
  // figure keeps the full file and gains its size and the hints. The page's
  // first figure is never lazy — it is often in the first screen.
  // Done as a transform on finished HTML pages rather than in the markdown
  // rule, on purpose: the same md instance renders the feeds (which keep
  // their absolute full-file <img> exactly as before, being .xml), and only
  // the whole page knows which figure comes first.
  // Missing anything — no manifest, a bare-sha entry from before, no dims,
  // no thumbnail on disk — and that image keeps exactly the old markup, so
  // either half of this can ship first. The CSS needs nothing: `img
  // { height: auto }` and `figure > img { width: 100% }` let the attributes
  // set only the reserved box's shape, and the tiles' aspect-ratio wins.
  const IMG_MANIFEST = path.join("src", "img", "manifest.json");
  const THUMB_DIR = path.join("src", "img", "posts", "thumb");
  // Keyed by the PUBLISHED file's name since 2026-11-11 (that is what the
  // image rule puts in src); `safe` is the embed's, which names the thumbnail.
  const postImages = new Map(); // published name -> { w, h, thumb: { w, h } | null, safe }
  const isDim = (n) => Number.isInteger(n) && n > 0;
  eleventyConfig.on("eleventy.before", () => {
    postImages.clear();
    publishedNames.clear();
    let manifest = {};
    try {
      if (fs.existsSync(IMG_MANIFEST)) manifest = JSON.parse(fs.readFileSync(IMG_MANIFEST, "utf8"));
    } catch (e) {
      console.warn(`[images] ${IMG_MANIFEST} unreadable (${e.message}) — every image keeps its full file`);
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return;
    for (const [name, rec] of Object.entries(manifest)) {
      if (!rec || typeof rec !== "object") continue;
      // Only ever <name>.webp, and only once it's on disk; anything else
      // keeps the same-name file (publish.py's pub_name() reads it alike).
      const file = rec.name === `${name}.webp` &&
        fs.existsSync(path.join("src", "img", "posts", rec.name)) ? rec.name : name;
      if (file !== name) publishedNames.set(name, file);
      if (!isDim(rec.w) || !isDim(rec.h)) continue;
      const t = rec.thumb;
      const thumb = t && isDim(t.w) && isDim(t.h) &&
        fs.existsSync(path.join(THUMB_DIR, `${name}.webp`)) ? { w: t.w, h: t.h } : null;
      postImages.set(file, { w: rec.w, h: rec.h, thumb, safe: name });
    }
  });
  // What obsidian_figure emits, and nothing else: a figure open tag straight
  // followed by the image rule's <img src alt [width]>. Anything with other
  // attributes is left as it is.
  const FIGURE_IMG = /(<figure class="(fig-float|fig-full)(?: [^"]*)?">)<img ([^>]*)>/g;
  const IMG_ATTR = /([a-z][a-z0-9-]*)="([^"]*)"/g;
  const POST_IMG = /^\/img\/posts\/([A-Za-z0-9._-]+)$/;
  eleventyConfig.addTransform("post-images", function (content) {
    const out = this.page?.outputPath;
    if (typeof out !== "string" || !out.endsWith(".html") || !postImages.size) return content;
    const at = content.indexOf("<main");
    if (at < 0) return content;
    let first = true;
    return content.slice(0, at) + content.slice(at).replace(FIGURE_IMG, (whole, open, kind, attrs) => {
      const eager = first;
      first = false;
      const a = Object.fromEntries([...attrs.matchAll(IMG_ATTR)].map((m) => [m[1], m[2]]));
      if (Object.keys(a).some((k) => !["src", "alt", "width"].includes(k))) return whole;
      const name = POST_IMG.exec(a.src ?? "")?.[1];
      const rec = name && postImages.get(name);
      if (!rec) return whole;
      const hints = `${eager ? "" : ' loading="lazy"'} decoding="async"`;
      const alt = a.alt ?? "";
      if (kind === "fig-full")
        return `${open}<img src="/img/posts/${name}" alt="${alt}" width="${rec.w}" height="${rec.h}"${hints}>`;
      if (!rec.thumb) return whole;
      return `${open}<img src="/img/posts/thumb/${rec.safe}.webp" alt="${alt}" width="${rec.thumb.w}" height="${rec.thumb.h}"${hints}` +
        ` data-full="/img/posts/${name}" data-full-width="${rec.w}" data-full-height="${rec.h}">`;
    });
  });

  eleventyConfig.addDataExtension("yaml", (contents) => parseYaml(contents));
  eleventyConfig.setLibrary("md", md);

  // Dates are always parsed from the YYYY-MM-DD filename, never from mtime,
  // which resets on CI. Format in UTC so the day never shifts.
  //
  // One shared formatter, memoised by timestamp: this runs once per fragment on
  // every subject page plus every archive row, so it is the hottest filter in
  // the build by a wide margin.
  const dateFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dateCache = new Map();

  eleventyConfig.addFilter("dateSlug", (d) => d.toISOString().slice(0, 10));

  // RFC 3339, which Atom requires.
  eleventyConfig.addFilter("atomDate", (d) => d.toISOString());

  eleventyConfig.addFilter("readableDate", (d) => {
    const key = d.getTime();
    let out = dateCache.get(key);
    if (out === undefined) {
      out = dateFormat.format(d);
      dateCache.set(key, out);
    }
    return out;
  });

  // "12 aug" — lowercase like the rest of the strip chrome. Yearless: the
  // essays strip shows two entries at most, and the ambiguity resets long
  // before it matters.
  const shortDateFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
  eleventyConfig.addFilter("shortDate", (d) => shortDateFormat.format(d).toLowerCase());

  // "sept 2026" — the canon hero's "since" cell. Month, not day: it says how
  // long a game has held its slot, and a day of the month adds nothing.
  const monthYearFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  });
  eleventyConfig.addFilter("monthYear", (d) => monthYearFormat.format(d).toLowerCase());

  // True when a lowercase label set in Pixel Operator Tight at 8px comes out
  // an odd number of pixels wide — the .cell centring trap (see .is-odd in
  // style.css). Of a–z, 0–9 and space, only f, t (5px) and space (3px) have
  // odd advances, so the parity is the parity of their count. For labels that
  // change on their own, like "since oct 2026" (75px); the fixed status words
  // stay a hand list in the CSS.
  eleventyConfig.addFilter("pxOdd", (s) => (String(s).match(/[ft ]/g) || []).length % 2 === 1);

  // Text cut out of RENDERED html is still html-encoded: markdown-it turned the
  // author's `"` into `&quot;` and `&` into `&amp;`. Handing that to a template
  // escapes it a second time (`&amp;quot;`), and handing it to `normalise` as a
  // lookup key fails to match the plain-text alias the Python side computes off
  // the raw markdown. Decode once, at the point of extraction, so what leaves
  // here is genuinely plain text — templates stay autoescaped, `| safe` stays
  // out of the picture. One pass, `&amp;` included in the alternation, so a
  // literal `&quot;` the author typed decodes to `&quot;` and not to `"`.
  const ENTITY = { quot: '"', amp: "&", lt: "<", gt: ">", "#39": "'" };
  const decodeEntities = (s) =>
    s.replace(/&(quot|amp|lt|gt|#39);/g, (_, e) => ENTITY[e]);

  // Rendered html -> the plain text the author actually typed. Used for every
  // alias lookup off rendered output: `normalise` turns punctuation into
  // spaces, so an undecoded `&amp;` becomes the token "amp" and "Pokémon
  // HeartGold & SoulSilver" stops matching its own alias — while the Python
  // side, which reads the raw markdown, matches it fine. Decoding here keeps
  // the two sides agreeing on what a heading says.
  const plainText = (html) => decodeEntities(String(html).replace(/<[^>]+>/g, "")).trim();

  // The inverse, for titles and other plain-text values interpolated straight
  // into html strings this config emits (which no template gets to escape).
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`);

  // Dailies render whole on the home page (2026-11-13). A 1500-character cut
  // at an H2 boundary (homeBody, 2026-08-11) hid about half of all dailies
  // behind an 8px "read the rest" link nobody saw — the limit sat right under
  // the median day (~1620). The home page shows five entries, so a whole day
  // costs little; essays keep their lede-and-link. If a day ever runs past
  // ~8000 characters, a per-day valve is the fix, not a site-wide limit.

  eleventyConfig.addFilter("limit", (arr, n) => arr.slice(0, n));

  // Now Playing is derived, never curated. Each group says how (2026-11-03,
  // `now_playing:` in site.yaml): `status` lists its subjects at `status:
  // active` — the same status that groups the shelves, so the two cannot
  // drift apart — and `recent` lists the one subject most recently written
  // about, while that writing is under NOW_PLAYING_DAYS old (movies' rule:
  // a film has no `active`, it is watched in an evening). `off`, the
  // default, lists nothing. Placement doesn't enter into it: a demoted group
  // keeps its now playing (movies kept `recent` when it moved into etc).
  // One site-wide window; per group only if a second `recent` group ever
  // needs its own.
  const NOW_PLAYING_DAYS = 14;
  // Returned tabs first in tab order, then the other groups in site.yaml
  // order; most recently written about first within a group (Hat,
  // 2026-11-02: recency, not the alphabet — the row says what's current, and
  // the ticker shows its head first). The first title of each group is
  // flagged groupFirst: the panel draws the group icon once per group, so
  // the order is what makes the groups. Copies, not the subject objects —
  // the flag belongs to this view, not to the subject.
  eleventyConfig.addFilter("nowPlaying", (subjects) => {
    const order = [...TABS, ...LIVE.filter((g) => !g.tabbed)];
    const since = Date.now() - NOW_PLAYING_DAYS * 86400000;
    const list = [];
    for (const g of order) {
      const here = (subjects ?? []).filter((s) => s.group === g.id);
      if (g.nowPlaying === "status") {
        list.push(...here
          .filter((s) => s.status === "active")
          .sort((a, b) => (b.lastWrote ?? 0) - (a.lastWrote ?? 0) || String(a.title).localeCompare(String(b.title))));
      } else if (g.nowPlaying === "recent") {
        const top = here
          .filter((s) => s.lastWrote && s.lastWrote >= since)
          .sort((a, b) => b.lastWrote - a.lastWrote)[0];
        if (top) list.push(top);
      }
    }
    return list.map((s, i) => ({ ...s, groupFirst: i === 0 || list[i - 1].group !== s.group }));
  });

  // Shelf order: what he's on now first, then what's queued up, then
  // finished, then owned board games, then the two kinds of stopped (paused
  // with a trigger, then done without the full experience). Within a group,
  // alphabetical. 2026-10-13: `abandoned` + `sampled` merged into
  // `incomplete`, `dabbling` folded into `active`, and `owned` replaced
  // active + hide_from_now for board games.
  //
  // Anything missing from this list sorts to indexOf -1, i.e. AHEAD of active
  // and straight to the top of the shelf. A new status must be added here or
  // it silently takes over the front page.
  const STATUS_ORDER = ["active", "backlog", "completed", "owned", "shelved", "incomplete"];
  eleventyConfig.addFilter("shelveSort", (subjects) =>
    (subjects ?? []).slice().sort((a, b) => {
      const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return s !== 0 ? s : String(a.title).localeCompare(String(b.title));
    }),
  );

  eleventyConfig.addFilter("inCategory", (subjects, category) =>
    (subjects ?? []).filter((s) => (s.category ?? []).includes(category)),
  );

  // Viewer-facing sort, done without a line of JavaScript. CSS cannot sort, but
  // it can read a number: every axis the shelf offers is knowable at build time,
  // so each one is ranked here and stamped on the tile as a custom property. The
  // radio in shelf.njk then picks which precomputed rank `order` reads. That is
  // the whole trick, and it is why the axes are all static facts — a shuffle, or
  // anything per-visitor, is the one thing this shape cannot do.
  //
  // Runs AFTER shelveSort, and depends on it: sort is stable, so any axis that
  // does not fully order the list falls back to status order rather than to
  // input order. Returns new objects — the collection is shared across shelves
  // and mutating it would let one category's ranks leak into another's.
  eleventyConfig.addFilter("shelfRanks", (subjects) => {
    const items = (subjects ?? []).slice();
    const byTitle = (a, b) => String(a.title).localeCompare(String(b.title));
    const rankBy = (cmp) => {
      const order = new Map();
      items.slice().sort(cmp).forEach((s, i) => order.set(s.slug, i));
      return order;
    };

    const az = rankBy(byTitle);
    // Newest first, and the undated go to the back: on the day this shipped 22
    // of 32 games had never been written about, so this axis doubles as "what
    // actually has writing behind it", with the whole backlog trailing it.
    const recent = rankBy((a, b) => {
      if (!a.lastWrote !== !b.lastWrote) return a.lastWrote ? -1 : 1;
      if (!a.lastWrote) return byTitle(a, b);
      return b.lastWrote - a.lastWrote || byTitle(a, b);
    });
    // Canon floats, everything else holds still. Deliberately not a re-sort:
    // below the ten it should read as the shelf you were already looking at.
    const canon = rankBy((a, b) => (b.canon === true) - (a.canon === true));
    // The ladder, top to bottom: the rungs by rank (canon is rank 0), then
    // the unrated. Within a rung the status order holds (stable sort), so the
    // grouped shelf still reads active-first inside each band.
    const rungOf = (s) => s.rating?.rank ?? 99;
    const rating = rankBy((a, b) => rungOf(a) - rungOf(b));

    return items.map((s) => ({
      ...s,
      oAz: az.get(s.slug),
      oRecent: recent.get(s.slug),
      oCanon: canon.get(s.slug),
      oRating: rating.get(s.slug),
    }));
  });

  // Posts missing a usable date are held out of the site entirely rather than
  // published under an invented one. Reported after the build, never fatal.
  const undated = new Set();
  const publishable = (posts) =>
    posts.filter((p) => {
      if (!p.data.datedProperly) {
        undated.add(p.inputPath);
        return false;
      }
      return !p.data.hold;
    });

  // The essay-side twin of datedProperly: an essay with no explicit `date:`
  // would fall back to file-creation time, which the CI checkout resets on
  // every deploy — it would re-date itself nightly and re-surface in every
  // feed reader forever (the feed entry's <id> embeds the date). publish.py
  // refuses these before they reach the repo; this is the backstop.
  const undatedEssays = new Set();
  const publishedEssays = (api) =>
    api.getFilteredByTag("essays").filter((e) => {
      if (e.data.publish !== true) return false;
      // hold: is the retraction verb on both tracks. publish.py already pulls
      // a held essay out of the repo, so nothing is live-wrong today — this is
      // the same backstop publishable() gives dailies, for the run where the
      // repo copy is present and the flag is the only thing saying "not this".
      if (e.data.hold) return false;
      if (!e.data.date) {
        undatedEssays.add(e.inputPath);
        return false;
      }
      return true;
    });

  eleventyConfig.addCollection("dailies", (api) =>
    publishable(api.getFilteredByTag("dailies")).sort((a, b) => b.date - a.date),
  );

  // The home stream and the archive: dailies and essays in ONE chronology.
  // Until 2026-09-15 both rendered dailies only, so a new essay reached a
  // browser visitor as nothing but a title swap in the signpost strip — easy
  // to miss — while the Atom feed had interleaved essays all along, so the two
  // surfaces disagreed about what was new. The pin-atop-the-stream idea was
  // rejected (2026-08-13) because a pin goes stale between rare essays; an
  // entry at its own date scrolls off like a daily and never can. On a
  // same-day tie the daily leads. An essay ships ON its date and its daily the
  // 2am after (publish.py), so the daily is always the later arrival; until
  // 2026-10-31 the essay led (the considered piece) and so buried the newly
  // arrived daily beneath an essay already a day on top. Daily first keeps
  // whatever landed last on top. Lede + link only — full text keeps its one
  // home at /e/.
  eleventyConfig.addCollection("stream", (api) => {
    const rank = { daily: 0, essay: 1 };
    const dailies = publishable(api.getFilteredByTag("dailies")).map((post) => ({
      kind: "daily",
      date: post.date,
      post,
    }));
    const essays = buildEssayList(api).map((essay) => ({
      kind: "essay",
      date: essay.date,
      essay,
    }));
    return [...dailies, ...essays].sort(
      (a, b) => b.date - a.date || rank[a.kind] - rank[b.kind],
    );
  });

  // "Best of" is zero-length until Hat marks a post `featured: true`. Supporting
  // the flag now costs nothing; the page and its nav link stay hidden until then.
  // A featured post's groups: an essay's own; a daily's are those of the
  // subjects its ## headings file to (a day can be about two groups), games
  // when it files to none.
  const featuredFor = (api, group) => {
    const postGroups = new Map();
    for (const s of buildSubjectPages(api)) {
      for (const f of s.fragments) {
        if (!postGroups.has(f.sourceUrl)) postGroups.set(f.sourceUrl, new Set());
        postGroups.get(f.sourceUrl).add(s.group);
      }
    }
    const essayGroup = new Map(buildEssayList(api).map((e) => [e.url, e.group]));
    return featuredAll(api).filter((p) => {
      if (essayGroup.has(p.url)) return essayGroup.get(p.url) === group;
      const here = postGroups.get(p.url);
      return here?.size ? here.has(group) : group === DEFAULT_GROUP;
    });
  };

  // ---------------------------------------------------------------- cards
  //
  // The `cards` band (2026-11-03, sports first): a hand-edited list, not
  // subjects. Each card is a title, a cover file, one free-text `vibe:` line
  // in place of the status and rating cells, an `as_of:` date Hat types
  // (never a file age: publish copies nightly and git keeps no mtime, so the
  // typed date is the only thing keeping a card honest), `subject:` — the
  // subject whose page shows the card — and `why:`, a paragraph or two of
  // prose. In the vault (`cards: teams` reads 70_chaosh.at/teams.yaml),
  // carried by publish.py like the other data files. In Hat's order, which
  // is the order they show in. No ladder, no rung, no nag.
  const cardProblems = [];
  const loadCards = (g) => {
    if (!g.hasCards || !g.cardsFile) return [];
    const file = path.join("src", "_data", `${g.cardsFile}.yaml`);
    let raw;
    try {
      raw = fs.existsSync(file) ? parseYaml(fs.readFileSync(file, "utf8")) : [];
    } catch (err) {
      cardProblems.push(`${g.cardsFile}.yaml: ${err.message.split("\n")[0]}`);
      return [];
    }
    if (!Array.isArray(raw)) {
      cardProblems.push(`${g.cardsFile}.yaml is not a list`);
      return [];
    }
    return raw.flatMap((c, i) => {
      if (!c || typeof c !== "object" || !c.title) {
        cardProblems.push(`${g.cardsFile}.yaml card ${i + 1} has no title`);
        return [];
      }
      const slug = String(c.slug ?? essaySlug(String(c.title)));
      const stem = String(c.cover ?? slug);
      const subject = c.subject != null ? aliasMap.get(normalise(c.subject)) ?? null : null;
      if (c.subject != null && !subject) cardProblems.push(`${g.cardsFile}.yaml ${slug}: subject ${c.subject} is no subject`);
      const asOf = c.as_of ? new Date(c.as_of instanceof Date ? c.as_of : `${String(c.as_of)}T00:00:00Z`) : null;
      return [{
        slug,
        anchor: `card-${slug}`,
        title: String(c.title),
        subject,
        coverUrl: coverUrls.get(stem) ?? null,
        coverPixel: coverPixels.has(stem),
        coverBox: coverBoxOf(stem, typeof c.cover_fit === "boolean" ? c.cover_fit : g.coverFit),
        vibe: typeof c.vibe === "string" && c.vibe.trim() ? c.vibe.trim() : null,
        asOf: asOf && !Number.isNaN(asOf.getTime()) ? asOf : null,
        whyHtml: typeof c.why === "string" && c.why.trim() ? revealSpoilers(md.render(c.why)) : null,
        skyUrl: subject ? `/img/sky/${subject}.png` : null,
      }];
    });
  };

  // ---------------------------------------------------------------- frecency
  //
  // How the etc tab ranks (2026-11-03): each ## section about a subject
  // weighs 0.5 ^ (age in days / FRECENCY_HALF_LIFE), each essay about it
  // FRECENCY_ESSAY times that ("so much effort in them"), summed per subject;
  // a group's score is its subjects'. Recomputed every nightly build, so a
  // thread that goes quiet sinks on its own. Nothing cleverer.
  const FRECENCY_HALF_LIFE = 30;
  const FRECENCY_ESSAY = 3;
  const frecency = (fragments, essays, now = Date.now()) => {
    const w = (d) => 0.5 ** ((now - d.getTime()) / DAY_MS / FRECENCY_HALF_LIFE);
    return fragments.reduce((n, f) => n + w(f.date), 0)
      + FRECENCY_ESSAY * essays.reduce((n, e) => n + w(e.date), 0);
  };
  // The card band on a group's landing page: a cards band's cards, in Hat's
  // order (sports' teams), and the CSS shows only the row that fits, so it
  // stays a strip. The canon strip and the shelf fallback that stood in for
  // it went on 2026-11-04 (from 11-03), with the "full canon → · full shelf
  // → · best of →" line over them: the views window under the nav carries
  // those views now, on every group's pages, etc's too.

  // Every group's pages in one place: its landing page, and a page per view
  // per band, each template paginating over this. Every group with a
  // subject gets its pages, tab or not (LIVE).
  //
  // Memoised like the fan-out, and the view collections below are slices of
  // it: a view with nothing in it gets no page (a computed `false` permalink
  // does not skip a paginated page, so the skipping happens here). Games'
  // canon always builds: /canon/ is a business card.
  let groupPagesMemo = null;
  const buildGroupPages = (api) => {
    if (groupPagesMemo) return groupPagesMemo;
    canonProblems.length = 0;
    cardProblems.length = 0;
    const all = buildSubjectPages(api);
    const essays = buildEssayList(api).slice().sort((a, b) => b.date - a.date);
    groupPagesMemo = LIVE.map((g) => {
      const subjectsHere = all.filter((s) => s.group === g.id);
      const canon = g.hasCanon ? canonFor(api, g.id) : { members: [], changes: [], essays: [], description: null };
      const essaysHere = essays.filter((e) => e.group === g.id);
      // The log (2026-10-25): the dailies filtered to one group. A day can
      // cover several groups, so it is every ## section about this group's
      // subjects rather than whole posts, newest first like the home page.
      // Same entry shape as a tag or rating view.
      const log = subjectsHere
        .flatMap((subject) => subject.fragments.map((f) => ({
          kind: "fragment", date: f.date, url: f.anchorUrl, subject, face: f.face, html: f.html,
        })))
        .sort((a, b) => b.date - a.date);
      // The landing page's log: the same, with essays slotted in at their
      // date (lede + link, as on the home page). A same-day tie puts the
      // daily first, as the home stream does.
      const essayIds = new Set();
      const stream = [...log.map((f) => (g.layout === "marginalia"
        ? { ...f, ...marginOf(f.html) } : { ...f, lede: ledeOf(f.html) })), ...essaysHere
        .filter((e) => !essayIds.has(e.slug) && essayIds.add(e.slug))
        .map((e) => ({ kind: "essay", date: e.date, url: e.url, title: e.title, blurb: e.blurb }))]
        .sort((a, b) => b.date - a.date || (a.kind === "essay") - (b.kind === "essay"));
      const cards = loadCards(g);
      const featured = featuredFor(api, g.id);
      const band = g.hasCards && cards.length
        ? { kind: "cards", title: g.cardsFile.replace(/^./, (c) => c.toUpperCase()), items: cards }
        : null;
      const score = subjectsHere.reduce((n, s) => n + s.score, 0);
      const lastWrote = subjectsHere.map((s) => s.lastWrote).filter(Boolean).sort((a, b) => b - a)[0] ?? null;
      const byScore = subjectsHere.slice()
        .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)));
      return {
        ...g,
        // The group's note (2026-11-13): blurbs/groups/<id>.md, above the cards.
        introHtml: noteIntroHtml(`groups/${g.id}`),
        subjects: subjectsHere,
        byScore,
        canon,
        featured,
        essays: essaysHere,
        log,
        stream,
        cards,
        band,
        // Several subjects and no shelf to browse them on: they go as a word
        // row under the band (nfl · mlb · nba · nhl).
        subjectRow: !g.hasShelf && subjectsHere.length > 1 ? byScore : [],
        // Where the group's name goes: a one-subject group's is its subject's
        // page (the group page would only repeat it), anything else its own.
        homeUrl: subjectsHere.length === 1 && g.layout !== "marginalia"
          ? `/s/${subjectsHere[0].slug}/` : g.urls.home,
        score,
        lastWrote,
        written: subjectsHere.reduce((n, s) => n + s.written, 0),
      };
    });
    return groupPagesMemo;
  };
  eleventyConfig.on("eleventy.before", () => { groupPagesMemo = null; });
  eleventyConfig.addCollection("groupPages", buildGroupPages);
  eleventyConfig.addCollection("groupCanonPages", (api) => buildGroupPages(api)
    .filter((g) => g.hasCanon && (g.id === DEFAULT_GROUP || g.canon.members.length)));
  eleventyConfig.addCollection("groupShelfPages", (api) => buildGroupPages(api)
    .filter((g) => g.hasShelf));
  eleventyConfig.addCollection("groupBestPages", (api) => buildGroupPages(api)
    .filter((g) => g.featured.length));
  eleventyConfig.addCollection("groupEssayPages", (api) => buildGroupPages(api)
    .filter((g) => g.essays.length));
  eleventyConfig.addCollection("groupLogPages", (api) => buildGroupPages(api)
    .filter((g) => g.log.length));

  // A subject's cards: every card in its group naming it as `subject:`.
  eleventyConfig.addFilter("cardsFor", (subject, groupPages) =>
    (groupPages ?? []).find((g) => g.id === subject?.group)?.cards
      .filter((c) => c.subject === subject.slug) ?? []);

  // The etc groups, busiest first, for /etc/ and the etc views row. Each
  // carries its rank on every sort axis the page offers, the shelf's trick:
  // CSS can't sort, but it can read a number (see shelfRanks).
  const etcRanks = (items) => {
    const byTitle = (a, b) => String(a.label ?? a.title).localeCompare(String(b.label ?? b.title));
    const rankBy = (cmp) => {
      const order = new Map();
      items.slice().sort(cmp).forEach((x, i) => order.set(x, i));
      return order;
    };
    const score = rankBy((a, b) => b.score - a.score || byTitle(a, b));
    const recent = rankBy((a, b) => (b.lastWrote ?? 0) - (a.lastWrote ?? 0) || byTitle(a, b));
    const written = rankBy((a, b) => b.written - a.written || byTitle(a, b));
    return items
      .slice()
      .sort((a, b) => score.get(a) - score.get(b))
      .map((x) => ({ ...x, oScore: score.get(x), oRecent: recent.get(x), oWritten: written.get(x) }));
  };
  eleventyConfig.addCollection("etcGroups", (api) => etcRanks(buildGroupPages(api).filter((g) => !g.tabbed))
    .map((g) => ({ ...g, subjects: etcRanks(g.subjects) })));
  // /etc/ builds once etc has a subject (hidden until content): a one-page
  // pagination over this, which is empty until then.
  eleventyConfig.addCollection("etcPage", (api) =>
    buildGroupPages(api).some((g) => !g.tabbed) ? [{ url: "/etc/" }] : []);

  // base.njk's one question about the nav: which tab is open, and what the
  // views window under it holds. A group's views are its bands as words,
  // shown only inside the group — its landing page, its views, its subjects'
  // pages — for an etc group too since 2026-11-04 (movies: shelf · log),
  // where the etc tab is the open one. /etc/'s own are the etc groups,
  // highest score first: the page is the list too, but a tab with no
  // sub-menu read as broken next to every other tab that has one (Hat,
  // 2026-11-04, reversing the handoff's "none"). Essays is a tab since the
  // 11-04 header pass: /essays/ and each group's slice (/essays/<group>/)
  // open it, its items all · and each group with an essay, and a group's
  // own views no longer list essays. The rule: links may repeat, the ▶ may
  // not, and a sub-menu item never moves you out of its tab — so a page
  // lives under what it is a list of (/essays/games/ is a list of essays),
  // and an essay's own page under its group (base.njk passes essay.group,
  // like a subject's). The site's own pages keep the about row. Everywhere
  // else — home, dailies, the archive, tags, ratings — no tab is open and
  // there is no views window.
  // /etc/'s pop-out holds the six highest-scoring etc groups, the tab cap's
  // number (2026-11-04): it reorders itself every build as the writing
  // moves, and the rest are on the page under it. No "all →", because that
  // would be a link to the page you're on.
  const ETC_POP = 6;
  eleventyConfig.addFilter("navState", (groupPages, groupId, url, navView) => {
    if (["/about/", "/colophon/", "/links/", "/guestbook/"].includes(url)) return { tab: "about", row: "about" };
    const pages = groupPages ?? [];
    if (url === "/etc/") return {
      tab: "etc",
      row: "list",
      items: pages.filter((x) => !x.tabbed)
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
        .slice(0, ETC_POP)
        .map((x) => ({ label: x.label, url: x.homeUrl, current: false })),
    };
    if (url === "/essays/" || pages.some((x) => x.essays.length && x.urls.essays === url)) return {
      tab: "essays",
      row: "list",
      items: [
        { label: "all", url: "/essays/", current: url === "/essays/" },
        ...pages.filter((x) => x.essays.length)
          .map((x) => ({ label: x.label, url: x.urls.essays, current: url === x.urls.essays })),
      ],
    };
    const g = pages.find((x) => x.id === groupId);
    if (!g) return { tab: null, row: null };
    const at = (view) => navView === view;
    return {
      tab: g.tabbed ? g.id : "etc",
      row: "list",
      items: [
        g.canon.members.length && { label: "canon", url: g.urls.canon, current: at("canon") },
        g.hasShelf && { label: "shelf", url: g.urls.shelf, current: at("shelf") },
        g.featured.length && { label: "best of", url: g.urls.best, current: at("best") },
        g.log.length && { label: "log", url: g.urls.log, current: at("log") },
      ].filter(Boolean),
    };
  });

  const featuredAll = (api) => {
    const dailies = publishable(api.getFilteredByTag("dailies")).filter(
      (p) => p.data.featured === true,
    );

    // Essays carry `permalink: false` — the /e/ page built by buildEssayList
    // is their only URL — so best.njk's page object is synthesized to match
    // the daily entries' shape.
    const essays = buildEssayList(api)
      .filter((e) => e.featured)
      .map((e) => ({ url: e.url, date: e.date, data: { title: e.title } }));

    return [...dailies, ...essays].sort((a, b) => b.date - a.date);
  };
  eleventyConfig.addCollection("featured", featuredAll);

  // ---------------------------------------------------------------- fan-out
  //
  // The subject page is a VIEW, not a document. Nothing is ever written back
  // into the vault: every build re-slices the daily posts and reassembles them
  // per subject. Registering a subject months later therefore collects every
  // fragment ever written under that heading, correctly back-dated.

  const subjectsFile = path.join("src", "_data", "subjects.yaml");
  const subjects = fs.existsSync(subjectsFile)
    ? parseYaml(fs.readFileSync(subjectsFile, "utf8")) || {}
    : {};

  // ---------------------------------------------------------------- groups
  //
  // Three levels since 2026-11-03: tab → group → subject. A subject is what
  // Hat writes under (`## NFL`); its FIRST category names its group; a tab
  // is a group with a nav spot. A group is defined by the BANDS it has, not
  // by a type: every group has a log (its subjects' ## sections) and essays
  // (essays about its subjects); `shelf` adds statuses and the shelf page,
  // `canon` ratings and the canon, `cards` a hand-edited card list. Games is
  // the maximal case, Aurora Watch's `site` the minimal one. Declared in
  // site.yaml `groups:` — mirrors groups_from_site() in the vault's
  // chaosh_subjects.py, which also refuses what this would only warn about
  // (compile_subjects.py check_groups). If one changes, change both.
  //
  // Placement is one list, `tabs:`. Every declared group not listed lands in
  // the etc tab. Dropping a group from tabs: is a demotion, never a
  // disappearance: its canon, shelf and log pages build regardless of where
  // it sits, gated only by its bands. (Until 2026-11-03 `media:` was an off
  // switch that hid a medium's views; that behaviour went, because it broke
  // links.)
  //
  // Games stays the special child: it keeps the bare view URLs (/canon/,
  // /shelf/, /best/, /log/) where every other group nests (/canon/movies/),
  // and a category-less subject lands there. A games privilege, not a tab
  // privilege — it survives demotion and is never extended to a second
  // group (Hat: "if anyone deserves to be special, it's games"). Essays are
  // the exception, as before: /essays/ is every essay, so each group's slice
  // lives at /essays/<group>/, games too. A group's own landing page is the
  // bare /<group>/, for every group; the compile's clash check keeps the
  // slug off every other top-level path.
  const DEFAULT_GROUP = "games";
  const siteFile = path.join("src", "_data", "site.yaml");
  const siteData = fs.existsSync(siteFile)
    ? parseYaml(fs.readFileSync(siteFile, "utf8")) || {}
    : {};
  // An old site.yaml has `media:` and no `groups:`: each medium stands in as
  // a canon+shelf group with the rules it had.
  const LEGACY_GROUPS = {
    games: { noun: "game", covers: "steamgriddb", now_playing: "status", color: "#9bd8f3" },
    tabletop: { noun: "tabletop game", covers: "bgg", cover_fit: true, now_playing: "status", color: "#ecafaf", aliases: ["boardgames"] },
    movies: { noun: "movie", covers: "tmdb", now_playing: "recent", color: "#d2a7ce", statuses: ["completed", "backlog"], status_words: { completed: "watched" } },
    shows: { noun: "show", covers: "tmdb-tv", now_playing: "status", color: "#a4a9db" },
    books: { noun: "book", covers: "hardcover", now_playing: "status", color: "#a2d6b3" },
  };
  const listOf = (v) => (v == null ? [] : [].concat(v)).map(String).filter((x) => x.trim());
  const declaredGroups = (() => {
    const raw = siteData.groups;
    if (raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length) {
      return Object.entries(raw).map(([id, g]) => [String(id), g && typeof g === "object" ? g : {}]);
    }
    const media = listOf(siteData.media);
    return (media.length ? media : [DEFAULT_GROUP])
      .map((m) => [m, { bands: ["canon", "shelf"], ...LEGACY_GROUPS[m] }]);
  })();
  const GROUP_ALIASES = {};
  for (const [id, g] of declaredGroups) for (const a of listOf(g.aliases)) GROUP_ALIASES[a] = id;
  const groupOf = (meta) => {
    const first = [].concat(meta?.category ?? [])[0];
    const g = first ? String(first) : DEFAULT_GROUP;
    return GROUP_ALIASES[g] ?? g;
  };
  const groupCount = new Map();
  for (const meta of Object.values(subjects)) {
    const g = groupOf(meta);
    groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
  }
  const tabsListed = (() => {
    const t = listOf(siteData.tabs);
    const m = listOf(siteData.media);
    return (t.length ? t : m.length ? m : [DEFAULT_GROUP]).filter((x, i, a) => a.indexOf(x) === i);
  })();
  const viewUrls = (id) => ({
    home: `/${id}/`,
    essays: `/essays/${id}/`,
    ...(id === DEFAULT_GROUP
      ? { canon: "/canon/", shelf: "/shelf/", best: "/best/", log: "/log/" }
      : { canon: `/canon/${id}/`, shelf: `/shelf/${id}/`, best: `/best/${id}/`, log: `/log/${id}/` }),
  });
  const NOW_MODES = new Set(["status", "recent"]);
  // A plain object per group, safe to hand to templates (no Sets): the bands
  // are booleans so a template can ask `group.hasShelf`.
  const GROUPS = declaredGroups.map(([id, g]) => {
    const bands = new Set(listOf(g.bands));
    const tabbed = tabsListed.includes(id);
    const nowPlaying = NOW_MODES.has(g.now_playing) ? g.now_playing : "off";
    const iconFile = `${g.icon ?? id}.svg`;
    return {
      id,
      label: String(g.label ?? id),
      noun: String(g.noun ?? g.label ?? id),
      description: typeof g.description === "string" ? g.description : null,
      hasShelf: bands.has("shelf"),
      hasCanon: bands.has("canon"),
      hasCards: bands.has("cards"),
      statuses: listOf(g.statuses),
      statusWords: g.status_words && typeof g.status_words === "object" ? g.status_words : {},
      covers: g.covers ?? null,
      coverFit: g.cover_fit === true,
      nowPlaying,
      // An icon is required once a group is tabbed or in now playing (the
      // compile refuses otherwise); any other group shows one if it has one.
      hasIcon: fs.existsSync(path.join("src", "img", "icons", "media", iconFile)),
      icon: `/img/icons/media/${iconFile}`,
      color: typeof g.color === "string" ? g.color : null,
      cardsFile: g.cards ? String(g.cards) : null,
      // `layout: marginalia` (2026-11-13): the page lists link-and-note
      // entries, and stands in for its subjects' pages (subjectHref).
      layout: typeof g.layout === "string" ? g.layout : null,
      tabbed,
      count: groupCount.get(id) ?? 0,
      urls: viewUrls(id),
    };
  });
  const GROUP = new Map(GROUPS.map((g) => [g.id, g]));
  // Where a subject's name links. A marginalia group's subject has no page of
  // its own (2026-11-13): `## margin` links to /margin/, and the template-built
  // /s/margin/ links land on a redirects.yaml stub that forwards there.
  const subjectHref = (slug) => {
    const g = GROUP.get(groupOf(subjects[slug]));
    return g?.layout === "marginalia" ? g.urls.home : `/s/${slug}/`;
  };
  // A group gets pages once it has a subject (hidden until content, the
  // site-wide rule), tab or not.
  const LIVE = GROUPS.filter((g) => g.count);
  const TABS = tabsListed.map((t) => GROUP.get(t)).filter((g) => g?.count);
  const ETC = LIVE.filter((g) => !g.tabbed);
  const undeclaredGroups = [...groupCount.keys()].filter((g) => !GROUP.has(g));
  const groupInfo = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
  eleventyConfig.addGlobalData("groupInfo", groupInfo);
  eleventyConfig.addGlobalData("tabs", TABS);
  // Each group's colour and icon as a class (.m-<id>): the colour in the
  // icon wherever it appears (the nav, now playing, a mixed rung's members).
  // In site.yaml since 2026-11-03, on the 10-31 pastel recipe (style.css
  // has the why); etc and about, which aren't groups, keep theirs there.
  eleventyConfig.addGlobalData("groupStyle", GROUPS
    .filter((g) => g.color || g.hasIcon)
    .map((g) => `.m-${g.id}{${g.color ? `--mc:${g.color};` : ""}${g.hasIcon ? `--mico:url("${g.icon}")` : ""}}`)
    .join(""));
  eleventyConfig.addFilter("groupNoun", (g) => GROUP.get(g)?.noun ?? g);
  eleventyConfig.addFilter("groupNouns", (g) => `${GROUP.get(g)?.noun ?? g}s`);
  // A subject list counted by group, in site.yaml order: "12 games · 9
  // tabletop games". A rung spans groups since tabletop got ratings; "games"
  // for everything was wrong from then (2026-11-07).
  eleventyConfig.addFilter("groupCounts", (members) => {
    const n = new Map();
    for (const s of members ?? []) n.set(s.group, (n.get(s.group) ?? 0) + 1);
    if (!n.size) return "none yet";
    return GROUPS.filter((g) => n.has(g.id))
      .map((g) => `${n.get(g.id)} ${g.noun}${n.get(g.id) === 1 ? "" : "s"}`)
      .join(" · ");
  });
  eleventyConfig.addFilter("statusWord", (status, g) =>
    GROUP.get(g)?.statusWords?.[status] ?? status);
  const hasShelf = (g) => GROUP.get(g)?.hasShelf === true;
  const hasCanon = (g) => GROUP.get(g)?.hasCanon === true;

  // Tags are a curated VIEW over several subjects — /t/final-fantasy/ gathers
  // every fragment ever written about any Final Fantasy game onto one page.
  //
  // Membership is authored on the TAG, not restated on each subject, for two
  // reasons. Inventing a tag is then one edit in one place rather than a sweep
  // through every entry it touches; and a hand-kept member list reads as
  // editorial, which is what a tag like `atlus` actually is — "same DNA and
  // lineage", not "everything this studio shipped". A per-subject field would
  // have quietly invited completionism.
  //
  // Deliberately NOT a category: a category is a shelf and mints a nav link, so
  // one per genre would bury the nav. Tags are reached from the pages they
  // describe. And deliberately NOT a subject: Hat writes about Final Fantasy
  // games, never about Final Fantasy in the abstract, so a tag needs no essay,
  // no status and no Now Playing slot.
  // Named tagviews, not tags, and that is not cosmetic: `tags` is reserved in
  // Eleventy's data cascade — a global of that name is read as every template's
  // collection membership and the build dies before rendering anything. The
  // vault-side file and the repo copy share the name; publish.py copies it
  // straight across. Nothing is renamed — only Eleventy's `tags` global is
  // dangerous, and this file has never claimed that name on either side.
  const tagsFile = path.join("src", "_data", "tagviews.yaml");
  const tags = fs.existsSync(tagsFile)
    ? parseYaml(fs.readFileSync(tagsFile, "utf8")) || {}
    : {};

  // Declaration order for postTags' footer, and reused by an essay's own
  // citedTags — both want "in tagviews.yaml order", not "in about:/heading
  // order", so the same pair of games reads identically everywhere.
  const tagOrder = Object.keys(tags);

  // Authored one way, needed both ways: tag -> members builds /t/<slug>/, and
  // subject -> tags prints the tag line on a subject page and the daily footer.
  const tagsOfSubject = new Map();
  for (const [tagSlug, meta] of Object.entries(tags)) {
    for (const member of meta?.members ?? []) {
      if (!tagsOfSubject.has(member)) tagsOfSubject.set(member, []);
      const list = tagsOfSubject.get(member);
      if (!list.includes(tagSlug)) list.push(tagSlug);
    }
  }

  const tagLinks = (slugs) =>
    (slugs ?? []).map((t) => ({ slug: t, title: tags[t]?.title ?? t }));

  // The canon is the top rung of the rating ladder: `rating: canon`, capped
  // at ten by compile_subjects.py (2026-10-22). Until then it was the `canon`
  // tagview — older than the ladder, and never moved onto it when the ladder
  // replaced the charms — so a swap was a tag edit plus a rating edit on the
  // outgoing game, and forgetting the second dropped it to pending. As a rung,
  // taking a game off the ten IS changing its rating. Resolved once here
  // because the shelf reads it for gold, for the star cell and for a sort
  // axis. Exact match: `canon*` is refused in ratingOf — a slot in the ten
  // has no partial verdict. (`favorites` until 2026-09-04: the roster
  // rotates, and "favorite" claimed a permanence it does not deliver.)
  const CANON = "canon";
  // Every medium's canon; canonFor() narrows it to one.
  const canonSlugsAll = new Set(
    Object.entries(subjects)
      .filter(([, meta]) => meta?.rating === CANON)
      .map(([slug]) => slug),
  );

  // ---------------------------------------------------------------- rating
  //
  // The third axis. Status is total and says what happened; `rating:` is one
  // rung from the ORDINAL ladder in ratings.yaml and says what he thought. The
  // vocabulary is CLOSED — five rungs — and an unknown value is reported after
  // the build, never minted, the same contract about: has. The ladder is
  // canon > favorite > loved > liked > disliked, and "pending" for anything
  // rated nothing; canon alone is capped (ten) and takes no `*`.
  //
  // This replaced six categorical "charms" (feels.yaml, 2026-09-04, never
  // live). They were built so no mark could outrank another, and that is why
  // they failed: a reader maps someone else's taste onto their own, and that
  // needs magnitude.
  //
  // Canon used to SUPERSEDE here — a game in the ten carried no rating at
  // all, so it could appear in no /r/ view. Dropped 2026-10-22 when canon
  // became a rung: it is a rating like any other now, rank 0, with its own
  // view at /r/canon/. Templates still branch on `canon` first for the gold.
  const ratingsFile = path.join("src", "_data", "ratings.yaml");
  const ratings = fs.existsSync(ratingsFile)
    ? parseYaml(fs.readFileSync(ratingsFile, "utf8")) || {}
    : {};
  const ratingOrder = Object.entries(ratings)
    .sort(([, a], [, b]) => (a?.rank ?? 99) - (b?.rank ?? 99))
    .map(([slug]) => slug);

  // Keyed by slug, not a list: ratingOf runs once for the subject fan-out and
  // again for every essay card that shows the same tile, so a single bad value
  // used to be reported as many times as it happened to be rendered.
  const badRatings = new Map(); // slug -> offending value, as text
  // A trailing `*` ("liked*") is a PARTIAL verdict — liked what he saw,
  // can't speak to the whole game. Same rung, same view, same sort; only the
  // printed word carries the star. Added 2026-10-13 when `sampled` merged into
  // `incomplete`: "my verdict isn't final" was a fact about the rating, so it
  // moved onto the rating.
  const ratingOf = (slug, meta) => {
    const raw = meta?.rating;
    if (raw == null) return null;
    const partial = typeof raw === "string" && raw.endsWith("*");
    const want = partial ? raw.slice(0, -1) : raw;
    if (typeof want !== "string" || !ratings[want]) {
      // A list is the shape error worth naming separately: a game has one
      // verdict, and two rungs on one tile would read as a range.
      badRatings.set(slug, Array.isArray(raw) ? `[${raw}] (one slug, not a list)` : String(raw));
      return null;
    }
    if (partial && want === CANON) {
      badRatings.set(slug, `${raw} (a slot in the ten has no partial verdict)`);
      return null;
    }
    const r = ratings[want];
    return {
      slug: want,
      title: (r?.title ?? want) + (partial ? "*" : ""),
      rank: r?.rank ?? ratingOrder.indexOf(want) + 1,
      partial,
    };
  };

  // ------------------------------------------------------------------- sky
  //
  // Generated cover art: the slug picks the hue and seeds the aurora's path,
  // status picks how much aurora is left in the sky, recency picks how bright
  // it burns. Written up in the vault at 90_Reference/91_Documentation/
  // "chaosh.at Design System" — including why hues sit on a ladder rather
  // than hashing straight to a degree.
  // There is no per-subject override. A subject gets the colour the ladder
  // gives it; if a colour is hated the fix is to stop that colour existing —
  // a palette-level change to the arc the slots map onto (aurora.js, and the
  // curated arc in "chaosh.at Design System") — never an escape hatch for one
  // subject. Displacement is not a fault: it is how the ladder keeps two
  // subjects off the same slot (2026-09-18).
  //
  // The ladder itself lives in hues.js, and the slots it has handed out are
  // remembered in hues.lock.json, so registering a subject never recolours
  // one that already exists (2026-09-23). Any slug the lock doesn't know yet
  // is assigned here by the same function publish.py uses to extend it.
  const subjectHues = huesFrom(assignSlots(readLock(), Object.keys(subjects)));

  // Recency tiers, not a continuous scale: bitmap-era art likes discrete
  // states, and a subject visibly changing tier at a 2am publish is an event.
  // Days since the LAST fragment, not post counts — the axis tracks whether
  // the fire is lit, and must not reward binge weeks over steady writing.
  const TIERS = [
    [7, 1.0], // wrote about it this week: full burn
    [28, 0.6], // this month: dimmed
    [Infinity, 0.32], // drifting off
  ];
  const tierOf = (lastDate) => {
    if (!lastDate) return 0.32;
    const days = (Date.now() - lastDate.getTime()) / 86400000;
    return TIERS.find(([limit]) => days <= limit)[1];
  };

  // The lit-days strip — see foldStrip at module scope. Tail only on the
  // status where "is the fire still lit?" is a live question.
  const TAIL_STATUSES = new Set(["active"]);
  const litStrip = (slug, entries, status) => {
    const strip = foldStrip(entries, {
      tail: STRIP_TAIL && TAIL_STATUSES.has(status),
    });
    // The subject's own sky palette, so the strip burns in the same colours
    // as its cover: rim, body and crown banded down each lit square.
    return strip && { ...strip, pal: palette(subjectHues.get(slug) ?? 0) };
  };

  // slug -> generated art, filled during the fan-out (recency needs the
  // fragments), written to the output in eleventy.after.
  const skyFiles = new Map();

  const registerSky = (slug, meta, tier) => {
    const hue = subjectHues.get(slug) ?? 0;
    const status = meta?.status ?? "active";
    const opts = { canon: canonSlugsAll.has(slug) };
    // Pixel art since 2026-10-19 (aurora.js pixelSubject): PNGs pre-scaled
    // ×5 / ×2, shown at natural size and cropped, never stretched.
    const big = pixelSubject(slug, hue, status, tier, opts);
    const chip = pixelSubject(slug, hue, status, tier, { ...opts, chip: true });
    // Chips live in a folder of their own (2026-11-11): as `<slug>-chip.png`
    // beside the big tiles, subjects `foo` and `foo-chip` both wrote
    // img/sky/foo-chip.png and one silently replaced the other. A slug never
    // holds a "/", so the folders can't collide; tag chips get one too.
    skyFiles.set(`img/sky/${slug}.png`, encodePng(big.px, big.w, big.h, 4));
    skyFiles.set(`img/sky/chip/${slug}.png`, encodePng(chip.px, chip.w, chip.h, 4));
    return {
      skyUrl: `/img/sky/${slug}.png`,
      chipUrl: `/img/sky/chip/${slug}.png`,
    };
  };

  // A tag-only essay (about: naming a tag, no subject) had no chip at all, so
  // it sat bare in every essay list (2026-10-14). Tags get a chip of their
  // own: no hue slot — tags aren't on the ladder and must never displace a
  // subject — so the hue hashes from the slug, fixed for the tag's life. Drawn
  // as an active subject would be (bands, no moon): a tag is never finished.
  // List chip only; the essay page gets no card for a tag (Hat, 2026-10-14).
  const tagChip = (slug) => {
    const file = `img/sky/tag/${slug}.png`; // its own folder, see registerSky
    if (!skyFiles.has(file)) {
      const c = pixelSubject(`tag:${slug}`, hashOf(`tag:${slug}`) % 360, "active", 1, { chip: true });
      skyFiles.set(file, encodePng(c.px, c.w, c.h, 4));
    }
    return `/${file}`;
  };

  // Cover art is the one asset on this site that is SOURCED rather than
  // generated: an image named for the subject slug, fetched from SteamGridDB by
  // .claude/scripts/covers.py and committed. Absence is a normal state, not an
  // error — a subject without one keeps the full generated tile, so the
  // original invariant holds and no shelf is ever unreachable for want of an
  // image. Rescanned per build so dropping a file in during --serve takes.
  const COVER_DIR = path.join("src", "img", "covers");
  const COVER_EXT = /^(.+)\.(jpe?g|png|webp|avif)$/i;
  // `<slug>.px.png` is hand-made pixel art, pre-scaled ×5 like the skies:
  // shown at natural size, never scaled, so its pixels sit on the art grid.
  // Named rather than inferred, since covers.py can fetch an ordinary PNG.
  const COVER_PX = /^(.+)\.px\.png$/i;
  const coverUrls = new Map(); // slug -> /img/covers/<file>
  const coverPixels = new Set(); // slugs whose cover is pixel art
  eleventyConfig.on("eleventy.before", () => {
    coverUrls.clear();
    coverPixels.clear();
    if (!fs.existsSync(COVER_DIR)) return;
    for (const name of fs.readdirSync(COVER_DIR)) {
      const px = COVER_PX.exec(name);
      const m = px ?? COVER_EXT.exec(name);
      if (m) coverUrls.set(m[1], `/img/covers/${name}`);
      if (px) coverPixels.add(px[1]);
    }
    coverBoxes.clear();
  });

  // Some covers are never cropped to the games' 2:3 grid (2026-10-25,
  // tabletop's boxes, which come square, landscape or small and tall; since
  // 2026-11-03 any group's, by `cover_fit:` — sports' logos too, since a
  // round mark cropped to 2:3 loses its sides). The ratio (width / height,
  // held to 2:3..3:2 so a long box doesn't become a sliver) rides along as
  // `coverBox`; templates fit the cover inside its slot, bottom-aligned like
  // a box on a shelf, and the post column sizes the cover to it. Per cover
  // file, from the group's `cover_fit:`, which a subject's own `cover_fit:`
  // (or a card's) overrides. Everything else keeps coverBox null and the
  // crop it always had.
  const coverBoxes = new Map(); // stem|fit -> clamped ratio, or null
  // Pixel size from the header alone: a PNG's IHDR, or a JPEG's first SOF.
  const imageSize = (file) => {
    const b = fs.readFileSync(file);
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    }
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff || b[i + 1] === 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  };
  const coverBoxOf = (stem, fit) => {
    const key = `${stem}|${fit ? 1 : 0}`;
    if (coverBoxes.has(key)) return coverBoxes.get(key);
    let box = null;
    const url = coverUrls.get(stem);
    if (url && fit) {
      const size = imageSize(path.join("src", url));
      if (size?.w && size?.h) box = +Math.min(1.5, Math.max(2 / 3, size.w / size.h)).toFixed(4);
    }
    coverBoxes.set(key, box);
    return box;
  };
  const fitOf = (slug) => typeof subjects[slug]?.cover_fit === "boolean"
    ? subjects[slug].cover_fit
    : GROUP.get(groupOf(subjects[slug]))?.coverFit === true;
  const coverBox = (slug) => coverBoxOf(slug, fitOf(slug));

  // A blurb is the third content type: an undated, revisable paragraph that
  // stands for a subject whose thoughts never took the form of a ## heading.
  // One markdown file per subject at src/blurbs/<slug>.md — the filename IS
  // the slug, same contract as covers, so the body cannot drift from the
  // subject it belongs to. Since 2026-09-08 the blurb is also the subject's
  // REGISTRATION: its frontmatter is compiled into subjects.yaml, so deleting
  // the file is a compile error rather than a retraction — unregistering is
  // `compile_subjects.py --forget <slug>`, said out loud. An empty body still
  // renders nothing, so a registration stub costs a tile and no prose.
  // Rescanned per build for the same reason covers are.
  const BLURB_DIR = path.join("src", "blurbs");
  const blurbTexts = new Map(); // slug -> markdown source
  // Note blurbs (2026-11-13): a group's or a tag's intro, the same file kind
  // one folder down — src/blurbs/groups/<group>.md, src/blurbs/tags/<tag>.md.
  // Keyed "groups/sports", "tags/jrpg". Hat: a note is a blurb, wherever it
  // is attached, so moving one between levels is a file move.
  const noteBlurbTexts = new Map();
  const readBlurbDir = (dir, into, prefix = "") => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const text = fs
        .readFileSync(path.join(dir, name), "utf8")
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "") // tolerate stray frontmatter
        .trim();
      if (text) into.set(prefix + name.slice(0, -3), text);
    }
  };
  eleventyConfig.on("eleventy.before", () => {
    blurbTexts.clear();
    noteBlurbTexts.clear();
    readBlurbDir(BLURB_DIR, blurbTexts);
    for (const kind of ["groups", "tags"]) {
      readBlurbDir(path.join(BLURB_DIR, kind), noteBlurbTexts, `${kind}/`);
    }
  });

  // `### Elsewhere` (2026-11-13) starts a blurb's outbound links: articles
  // Hat thinks are good, one per line, `[Title](url), Author`, an optional
  // why after. They belong to the page the blurb is about and are never
  // inherited: a subject's page shows them, the views that gather the
  // subject (/t/, /r/) show its prose only. -> [prose, whole] markdown.
  const ELSEWHERE_RE = /^###[ \t]+Elsewhere[ \t]*$/im;
  const blurbProse = (text) => {
    const at = String(text ?? "").search(ELSEWHERE_RE);
    return at === -1 ? text : text.slice(0, at).trim();
  };
  const renderBlurb = (text) => (text ? revealSpoilers(md.render(text)) : null);
  const noteIntroHtml = (key) => renderBlurb(noteBlurbTexts.get(key));

  // One static band per post date — the sky the night it was written —
  // generated on demand from the filter and written out with the rest of the
  // art in eleventy.after.
  eleventyConfig.addFilter("daySky", (d) => {
    const key = d.toISOString().slice(0, 10);
    const rel = `img/aurora/day-${key}.png`;
    if (!skyFiles.has(rel)) {
      const band = pixelBand(key);
      skyFiles.set(rel, encodePng(band.px, band.w, band.h, 4));
    }
    return `/${rel}`;
  });

  const skyUrls = new Map(); // slug -> {skyUrl, chipUrl}, for linkSubjects

  // `cover` is the cover file to show, the subject's own unless a face
  // names another (see faces below).
  const skyTag = (slug, status, cover = slug) => {
    const art = skyUrls.get(slug);
    if (!art) return '<span class="sky sky-blank" aria-hidden="true"></span>';
    // A covered subject shows its cover here instead of its sky. Status is
    // the badge sitting beside the heading, not anything in the art.
    //
    // Background image, not <img>, for the same reason the sky is one: an img
    // carries intrinsic height and would drive the row instead of being driven
    // by it, which is what keeps the art tracking entry length.
    const coverUrl = coverUrls.get(cover) ?? (cover !== slug ? coverUrls.get(slug) : null);
    if (coverUrl) {
      // A link, but deliberately not a second tab stop or a second thing to
      // announce: the heading beside it already links to the same page, so
      // this is the redundant-image-link case — hidden from assistive tech and
      // skipped by the keyboard, present for the mouse.
      const stem = coverUrls.has(cover) ? cover : slug;
      const box = coverBoxOf(stem, fitOf(slug));
      return (
        `<a class="sky sky-cover${box ? " sky-box" : ""}${coverPixels.has(stem) ? " sky-pixel" : ""}" href="${subjectHref(slug)}" ` +
        `style="background-image:url(${coverUrl})" aria-hidden="true" tabindex="-1"></a>`
      );
    }
    const cls = status === "completed" ? "sky sky-done" : "sky";
    return `<span class="${cls}" style="background-image:url(${art.skyUrl})" aria-hidden="true"></span>`;
  };

  // normalised heading -> slug
  const aliasMap = new Map();
  // Faces (2026-11-03): an alias that keeps its own display name and cover.
  // `## Bears` files under NFL — same page, same frecency, same timeline —
  // but its section is headed "Bears" and shows the bears cover, where a
  // plain `## NFL` shows the shield. Declared in the blurb (`faces:`),
  // compiled into subjects.yaml; the compile also lists each face key as an
  // alias, so everything that only knows aliases files it right. A plain
  // alias still renders as its subject's title and cover (`## dqxis` →
  // "Dragon Quest XI S"). A later split moves the face to a subject of its
  // own and old sections re-file themselves.
  // normalised face key -> { slug, key, title, cover }
  const faceMap = new Map();
  for (const [slug, meta] of Object.entries(subjects)) {
    aliasMap.set(normalise(meta.title ?? slug), slug);
    aliasMap.set(normalise(slug), slug);
    for (const alias of meta.aliases ?? []) aliasMap.set(normalise(alias), slug);
    const faces = meta.faces && typeof meta.faces === "object" ? meta.faces : {};
    for (const [key, face] of Object.entries(faces)) {
      aliasMap.set(normalise(key), slug);
      faceMap.set(normalise(key), {
        slug,
        key: normalise(key),
        title: String(face?.title ?? key),
        cover: face?.cover ? String(face.cover) : null,
      });
    }
  }
  // A heading -> { slug, face } (face null for a plain heading or alias).
  const resolveHeading = (heading) => {
    const key = normalise(heading);
    const slug = aliasMap.get(key) ?? null;
    const face = slug ? faceMap.get(key) ?? null : null;
    return { slug, face: face?.slug === slug ? face : null };
  };
  // What a section about a subject is headed: its face's name, else the
  // subject's title.
  const headingTitle = (slug, face) => face?.title ?? subjects[slug]?.title ?? slug;

  eleventyConfig.addFilter("resolveSubject", (heading) =>
    aliasMap.get(normalise(heading)) ?? null,
  );

  const unmatched = new Map(); // normalised heading -> {label, firstSeen}

  // about: issues, reported alongside unmatched headings in eleventy.after —
  // same "warn, never fail" contract, since this is 2am automation too.
  const aboutIssues = []; // {file, slug, reason: "unresolved" | "collision"}
  const dailyAbout = []; // file paths where about: showed up on a daily

  const subjectLinks = (slugs) =>
    (slugs ?? []).map((s) => ({ slug: s, title: subjects[s]?.title ?? s }));

  // Frontmatter arrives as a list, but a one-item `about: foo` parses as a
  // bare string — normalise both to a list before resolving.
  const asList = (value) => (value == null ? [] : [].concat(value));

  // Mirrors ## heading resolution: subjects first (through aliasMap, so
  // aliases work the same way headings do), then tag keys, exact — a tag
  // slug is typed as its literal YAML key, never fuzzed the way a heading is.
  // A slug hitting both is a naming collision: the subject wins (consistent
  // with "subjects first") but the collision itself is worth a warning.
  //
  // `canon` is reserved and checked first (2026-10-22): no longer a tag, it
  // files the essay onto /canon/. An opt-in for essays ABOUT the canon — the
  // premiere, the rubric, a swap argued — not for every essay about one of
  // the ten, which reach those games' pages the ordinary way.
  const resolveAbout = (file, rawAbout) => {
    const citedSubjects = []; // deduped
    const citedTagsDirect = []; // deduped
    const seenSubjects = new Set();
    const seenTags = new Set();
    let aboutCanon = false;

    for (const raw of asList(rawAbout)) {
      const value = String(raw).trim();
      if (!value) continue;
      if (value === CANON) {
        aboutCanon = true;
        continue;
      }

      const subjSlug = aliasMap.get(normalise(value));
      const tagSlug = Object.hasOwn(tags, value) ? value : null;
      if (subjSlug && tagSlug) {
        aboutIssues.push({ file, slug: value, reason: "collision" });
      }

      if (subjSlug) {
        if (!seenSubjects.has(subjSlug)) {
          seenSubjects.add(subjSlug);
          citedSubjects.push(subjSlug);
        }
        continue;
      }

      if (tagSlug) {
        if (!seenTags.has(tagSlug)) {
          seenTags.add(tagSlug);
          citedTagsDirect.push(tagSlug);
        }
        continue;
      }

      aboutIssues.push({ file, slug: value, reason: "unresolved" });
    }

    return { citedSubjects, citedTagsDirect, aboutCanon };
  };

  // ----------------------------------------------------------------- essays
  //
  // An essay is its own thing, not a pseudo-subject: the filename is a unique
  // label (slugified for the URL), `title:` is the display title, and `about:`
  // says which views it belongs to — aliases resolve, so `about: [p5r]` works.
  // Nothing is registered in subjects.yaml for an essay to exist.
  //
  // Its own page at /e/<slug>/ is the full text's ONE home, and where the feed
  // points. In every view it's about — cited subjects' pages, their tag views,
  // tags cited directly — it appears in the chrono stream at its date as
  // lede + link. Full text in one place; everywhere else points (decided
  // 2026-08-12, superseding the pinned-essay-atop-a-subject-page model).
  let essayList = null;
  const homelessEssays = [];
  const buildEssayList = (api) => {
    if (essayList) return essayList;
    const bySlug = new Map(); // collision check: two stems, one slug

    essayList = publishedEssays(api).map((e) => {
      // The whole filename stem, as publish.py's essay_slug(stem) takes it.
      // Eleventy's fileSlug drops a leading date, so `2026-01-01-foo.md` went
      // to /e/foo/ here and /e/2026-01-01-foo/ in every check on the vault
      // side (2026-11-11).
      const stem = path.basename(e.inputPath, path.extname(e.inputPath));
      const slug = essaySlug(stem);
      // Two filenames, one URL: a build failure that names both, by design
      // (2026-11-11). This used to queue an after-build warning that one page
      // overwrote the other, but Eleventy never gets that far — the two
      // pages die as a bare DuplicatePermalinkOutputError naming essay.njk.
      // Failing is right (silently shipping one of two essays isn't); not
      // saying which files is what this fixes. publish.py refuses the second
      // file before it reaches the repo, so this is the backstop.
      if (bySlug.has(slug)) {
        throw new Error(
          `[chaosh.at] essay slug collision: ${bySlug.get(slug)} and ${e.inputPath} both publish at /e/${slug}/. ` +
            `Rename one file; the slugified names must differ.`,
        );
      }
      bySlug.set(slug, e.inputPath);

      const raw = md.render(e.rawInput);
      // The blurb is the essay's own opening paragraph — the author writes the
      // lede, nothing paraphrases it. Off the REDACTED render: a blurb is
      // plain text in a stream, with no span to blur and nothing to click.
      // The feed summary's skips apply: an epigraph or an aside up top isn't
      // the lede (DQXIS opened with Weezer until 2026-11-07).
      const firstPara = stripSpoilers(raw).replace(SUMMARY_SKIP, "").match(/<p>([\s\S]*?)<\/p>/i);
      const blurb = firstPara ? plainText(firstPara[1]) : null;

      const { citedSubjects, citedTagsDirect, aboutCanon } = resolveAbout(e.inputPath, e.data.about);
      if (!citedSubjects.length && !citedTagsDirect.length && !aboutCanon) {
        homelessEssays.push(e.inputPath);
      }
      // Citation is transitive: citing a subject also lands the essay on that
      // subject's tag views. Ordered by tagviews.yaml, same as every tag row.
      const citedTagSlugs = new Set(citedTagsDirect);
      for (const s of citedSubjects) {
        for (const t of tagsOfSubject.get(s) ?? []) citedTagSlugs.add(t);
      }

      // The shelf card for each cited subject, floated beside the essay's
      // opening paragraph (2026-09-06). Same fields the shelf reads, so the
      // template is the shelf's card verbatim. The sky path is spelled out
      // rather than read from skyUrls: essays can build before the subject
      // fan-out registers skies, and registerSky always writes this path.
      const cards = citedSubjects.map((s) => {
        const meta = subjects[s] ?? {};
        return {
          slug: s,
          title: meta.title ?? s,
          group: groupOf(meta),
          shelf: hasShelf(groupOf(meta)),
          ratable: hasCanon(groupOf(meta)),
          status: meta.status ?? "active",
          canon: canonSlugsAll.has(s),
          rating: ratingOf(s, meta),
          coverUrl: coverUrls.get(s) ?? null,
          coverPixel: coverPixels.has(s),
          coverBox: coverBox(s),
          skyUrl: `/img/sky/${s}.png`,
        };
      });
      const html = revealSpoilers(raw);

      // Where each card sits. An essay whose ## headings name its subjects
      // (the canon list — ten games, ten sections, 2026-09-09) reads better
      // with each card beside its own section than with the whole stack
      // floated at the top. A heading resolves through aliasMap exactly as a
      // daily's does; the first heading to name a cited subject takes its
      // card and its section renders as a row (card | heading + prose, see
      // essay.njk). Cards no heading claims stay at the top, so a
      // single-subject essay renders exactly as before.
      const cardBySlug = new Map(cards.map((c) => [c.slug, c]));
      const placed = new Set();
      // A `---` inside a row ends it: the rest of that section is ordinary
      // prose again, so the list can close with an outro at column width
      // (the canon's "that's all of it folks"). The rule is consumed, not
      // drawn — it was the signal, like a caption's italics.
      const sections = html
        .split(/(?=<h2[\s>])/i)
        .filter((s) => s.trim())
        .flatMap((part) => {
          const m = /^(<h2[^>]*>([\s\S]*?)<\/h2>)([\s\S]*)$/i.exec(part);
          if (!m) return [{ head: "", card: null, body: part }];
          const slug = aliasMap.get(normalise(plainText(m[2])));
          const card = slug && !placed.has(slug) ? cardBySlug.get(slug) ?? null : null;
          if (!card) return [{ head: m[1], card: null, body: m[3] }];
          placed.add(slug);
          const [body, ...rest] = m[3].split(/<hr\s*\/?>/i);
          const out = [{ head: m[1], card, body }];
          if (rest.length) out.push({ head: "", card: null, body: rest.join("<hr>") });
          return out;
        });

      return {
        slug,
        url: `/e/${slug}/`,
        title: titleText(e.data.title) || stem,
        date: e.date,
        inputPath: e.inputPath, // the feed's shipped.json key
        featured: e.data.featured === true,
        html,
        feedHtml: stripSpoilers(raw),
        blurb,
        // The link-card description when set; the lede stands in otherwise.
        description: typeof e.data.description === "string" && e.data.description.trim()
          ? e.data.description.trim()
          : null,
        citedSubjects,
        // The group whose essays view lists it: the first about: subject's.
        // An essay citing only tags, or only the canon, files under games.
        group: citedSubjects.length ? groupOf(subjects[citedSubjects[0]]) : DEFAULT_GROUP,
        chipUrl: citedSubjects.length
          ? `/img/sky/chip/${citedSubjects[0]}.png`
          : citedTagsDirect.length ? tagChip(citedTagsDirect[0])
          : aboutCanon ? tagChip(CANON) : null,
        aboutCanon,
        cites: subjectLinks(citedSubjects),
        // An aside is washed in the first about: subject's hue, so a primer
        // reads as belonging to the game it explains. Tag-only essays fall
        // back to the accent in the CSS.
        tint: citedSubjects.length ? palette(subjectHues.get(citedSubjects[0]) ?? 0).glow : null,
        cards,
        topCards: cards.filter((c) => !placed.has(c.slug)),
        sections,
        citedTags: tagLinks(tagOrder.filter((t) => citedTagSlugs.has(t))),
      };
    });
    return essayList;
  };

  eleventyConfig.addCollection("essayPages", buildEssayList);

  // The fan-out is memoised because the tag pages are built from exactly the
  // same slicing — a tag page is a union of subject timelines, not a second
  // pass over the posts. Cleared before every build so --serve cannot hand back
  // a page assembled from the previous edit.
  let fanOut = null;
  eleventyConfig.on("eleventy.before", () => {
    fanOut = null;
    essayList = null;
    // These collect during a build and are reported at the end. Under --serve
    // the config is not re-evaluated between rebuilds, so without this they
    // accumulate: the same undated post is reported once, then twice, then
    // three times, and the counts stop meaning anything.
    undated.clear();
    undatedEssays.clear();
    unmatched.clear();
    aboutIssues.length = 0;
    dailyAbout.length = 0;
    badRatings.clear();
    homelessEssays.length = 0;
  });

  const buildSubjectPages = (api) => {
    if (fanOut) return fanOut;
    const dailies = publishable(api.getFilteredByTag("dailies")).sort(
      (a, b) => a.date - b.date, // oldest-first, per spec
    );

    // subject -> essays citing it, for the chrono stream below.
    const essaysBySubject = new Map();
    for (const essay of buildEssayList(api)) {
      for (const subjSlug of essay.citedSubjects) {
        if (!essaysBySubject.has(subjSlug)) essaysBySubject.set(subjSlug, []);
        essaysBySubject.get(subjSlug).push(essay);
      }
    }

    const collected = new Map(); // slug -> fragments[]

    for (const post of dailies) {
      // about: is essay-only — a daily is filed by ## heading, not by
      // frontmatter, so this is a warning, not a second attribution path.
      if (post.data.about != null) dailyAbout.push(post.inputPath);

      // Two headings resolving to the same subject in one post merge into a
      // single dated fragment rather than appearing twice under one date —
      // unless they wear different faces (`## Bears` and `## NFL` on one
      // Sunday stay two sections, each under its own name and cover). The
      // fragment links back to its first section's anchor in the day.
      const perPost = new Map(); // slug|face -> { slug, face, anchor, text }
      const sections = splitSections(post.rawInput);
      const anchors = sectionAnchors(sections.map((x) => x.heading));

      for (const [i, { heading, body }] of sections.entries()) {
        if (!heading) continue; // empty "## " from the daily-note template
        const { slug, face } = resolveHeading(heading);
        if (!slug) {
          const key = normalise(heading);
          if (!unmatched.has(key)) {
            unmatched.set(key, { label: heading, firstSeen: post.date });
          }
          continue; // stays in the daily post; never auto-created
        }
        const text = body.join("\n").trim();
        if (!text) continue;
        // A marginalia note never merges (2026-11-13): two `## margin` in a
        // day are two links and two notes, each its own entry.
        const key = GROUP.get(groupOf(subjects[slug]))?.layout === "marginalia"
          ? `${slug}|#${i}` : `${slug}|${face?.key ?? ""}`;
        const prev = perPost.get(key);
        if (prev) prev.text += `\n\n${text}`;
        else perPost.set(key, { slug, face, anchor: anchors[i], text });
      }

      for (const { slug, face, anchor, text } of perPost.values()) {
        if (!collected.has(slug)) collected.set(slug, []);
        collected.get(slug).push({
          date: post.date,
          sourceUrl: post.url,
          anchorUrl: anchor ? `${post.url}#${anchor}` : post.url,
          // The face this section wore, with its cover's fit worked out, so
          // a view's timeline can show it without knowing what a face is.
          face: face && {
            title: face.title,
            cover: face.cover,
            box: face.cover ? coverBoxOf(face.cover, fitOf(slug)) : coverBox(slug),
          },
          html: revealSpoilers(md.render(text)),
          words: text.split(/\s+/).filter(Boolean).length,
        });
      }
    }

    // A subject exists because it is registered, not because it has fragments.
    // Its page: essays about it PINNED at the top as lede cards — usually the
    // most considered writing on the page, so it doesn't get buried under a
    // replay's fragments (Hat's call, 2026-08-12) — then the fragment timeline
    // in chrono order. The pin is subject-page-only; tag views keep essays
    // inline in the stream.
    fanOut = Object.entries(subjects).map(([slug, meta]) => {
      const fragments = collected.get(slug) ?? [];
      const essays = (essaysBySubject.get(slug) ?? [])
        .slice()
        .sort((a, b) => a.date - b.date);

      // Recency counts essays too: publishing a post-mortem IS writing about
      // the thing, and the sky should burn for it.
      const lastWrote = [fragments.at(-1)?.date, essays.at(-1)?.date]
        .filter(Boolean)
        .sort((a, b) => a - b)
        .at(-1);
      const tier = tierOf(lastWrote ?? null);
      const art = registerSky(slug, meta, tier);
      skyUrls.set(slug, art);

      return {
        slug,
        ...meta,
        group: groupOf(meta),
        status: meta?.status ?? "active",
        // The etc tab's ranking (see frecency) and its "most written" axis.
        score: frecency(fragments, essays),
        written: fragments.length + essays.length,
        ...art,
        // Both of these exist for the shelf's sort axes. lastWrote is the same
        // date the recency tier is derived from, kept in its raw form because a
        // tier is three buckets and sorting wants the real ordering; null for a
        // subject registered but never yet written about, which the sort pushes
        // to the back rather than jumbling among the dated ones.
        lastWrote: lastWrote ?? null,
        litDays: litStrip(slug, [
          ...fragments,
          // An essay day is a big day: straight to the ray cap.
          ...essays.map((e) => ({ date: e.date, words: 1000 })),
        ], meta?.status ?? "active"),
        canon: canonSlugsAll.has(slug),
        // Templates branch on canon first (the gold), then on this, then
        // render "pending". A canon subject's rating is the canon rung.
        rating: ratingOf(slug, meta),
        coverUrl: coverUrls.get(slug) ?? null,
        coverPixel: coverPixels.has(slug),
        coverBox: coverBox(slug),
        // Not to be confused with essay.blurb (an essay's lede on tag pages):
        // this is the subject's own standing paragraph, rendered in full
        // wherever it appears — Hat writes blurbs to fit, so there is no
        // lede extraction.
        blurbHtml: blurbTexts.has(slug)
          ? revealSpoilers(md.render(blurbTexts.get(slug)))
          : null,
        // The same minus its `### Elsewhere` links: what /t/ and /r/ show.
        blurbProseHtml: renderBlurb(blurbProse(blurbTexts.get(slug))) || null,
        tags: tagLinks(tagsOfSubject.get(slug)),
        fragments,
        essays,
      };
    });
    return fanOut;
  };

  eleventyConfig.addCollection("subjectPages", buildSubjectPages);
  // The subjects that get a /s/ page: all but a marginalia group's.
  eleventyConfig.addCollection("subjectPagesOwn", (api) =>
    buildSubjectPages(api).filter((s) => subjectHref(s.slug) === `/s/${s.slug}/`));

  // The about page's clouds — see wordcloud.js. Built as a collection because
  // that is where the posts are; the shortcode below only reads the result.
  // Text is what a reader can see: spoilers, code and headings out (a ##
  // heading is a subject name, which the subject cloud already counts).
  const SUBJECT_WORDS = new Set();
  for (const [slug, meta] of Object.entries(subjects)) {
    for (const name of [slug, meta.title, ...(meta.aliases ?? [])]) {
      for (const w of String(name ?? "").toLowerCase().match(/[a-z][a-z']*[a-z]/g) ?? []) {
        SUBJECT_WORDS.add(w);
      }
    }
  }
  const readerText = (html) =>
    plainText(
      stripSpoilers(html)
        .replace(CODE_REGION, " ")
        .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, " ")
        .replace(/\[spoiler\]/g, " ")
        .replace(/<\/(p|li|blockquote|figcaption|td|th)>/gi, "$&\n"),
    );
  // A daily minus its sections on the site's own build log: Aurora Watch's
  // fonts and frames are not how Hat talks. Keyed on the `site` group alone
  // (2026-11-03; until then on "is it a medium", which under groups would
  // silently drop every non-media thread — and "Caleb" and "cubbies" are how
  // Hat talks). One line to drop if the site stops being one he writes
  // around rather than about.
  const CLOUD_SKIP_GROUP = "site";
  const inCloud = (slug) => groupOf(subjects[slug]) !== CLOUD_SKIP_GROUP;
  const mediaProse = (raw) => {
    let keep = true;
    return String(raw).split("\n").filter((line) => {
      const m = /^##(?!#)\s*(.*)$/.exec(line);
      if (m) {
        const slug = aliasMap.get(normalise(m[1].trim()));
        keep = !slug || inCloud(slug);
      }
      return keep;
    }).join("\n");
  };
  let clouds = "";
  eleventyConfig.addCollection("clouds", (api) => {
    const docs = [
      ...publishable(api.getFilteredByTag("dailies")).map((p) => ({
        date: p.date, text: readerText(md.render(mediaProse(p.rawInput))),
      })),
      ...buildEssayList(api)
        .filter((e) => !e.citedSubjects.length
          || e.citedSubjects.some(inCloud))
        .map((e) => ({ date: e.date, text: readerText(e.feedHtml), essay: e })),
    ];
    const year = cloudYear(docs);
    const inYear = (d) => d.date.getUTCFullYear() === year;
    // Nothing written before the shown year: the two clouds would be the same
    // cloud, so there is one, captioned as both.
    const periods = docs.every(inYear)
      ? [[`${year} · all time`, () => true]]
      : [[String(year), inYear], ["all time", () => true]];
    // A tab names its period only when there is more than one.
    const tab = (kind, caption) => (periods.length > 1 ? `${kind} · ${caption}` : kind);

    const skip = [].concat(siteData.cloud_skip ?? []);
    const words = periods.map(([caption, keep]) => ({
      label: tab("words", caption),
      kind: "words",
      html: cloudHtml(
        vocabulary(docs.filter(keep), { exclude: SUBJECT_WORDS, skip }),
        { caption, seed: `words:${caption}:${today}` },
      ),
    }));

    // Words written under each subject's ## headings, plus every essay about
    // it in full. Not the site group's: Aurora Watch is the build log, not
    // something written about.
    const essayWords = new Map(docs.filter((d) => d.essay)
      .map((d) => [d.essay.slug, d.text.split(/\s+/).length]));
    const subjectCloud = (keep) => buildSubjectPages(api)
      .filter((s) => inCloud(s.slug))
      .map((s) => ({
        label: s.title ?? s.slug,
        href: subjectHref(s.slug),
        color: palette(subjectHues.get(s.slug) ?? 0).glow,
        weight: s.fragments.filter(keep).reduce((n, f) => n + f.words, 0)
          + s.essays.filter(keep).reduce((n, e) => n + (essayWords.get(e.slug) ?? 0), 0),
      }))
      .filter((s) => s.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 30);
    const subjectPanels = periods.map(([caption, keep]) => ({
      label: tab("subjects", caption),
      kind: "subjects",
      html: cloudHtml(subjectCloud(keep), {
        caption, seed: `subjects:${caption}:${today}`, maxStep: 3,
      }),
    }));

    clouds = cloudStack([...words, ...subjectPanels]);
    return [];
  });
  // {% wordcloud %} in About.md: every cloud, in one tabbed window.
  eleventyConfig.addShortcode("wordcloud", () => clouds);

  // A tag page is the subject fan-out widened: every member's fragments on one
  // timeline, newest first, each entry labelled with the game it came from
  // because unlike a subject page this one is mixed. (Oldest first, to match
  // a subject page, until 2026-11-11: see newestFirst below.)
  //
  // A standing essay appears as its blurb plus a link rather than in full. The
  // tag page is a way in, not a second home for the writing — inlining four
  // post-mortems would bury the fragments the page exists to gather.
  //
  // A tag with no members still builds. That is the same courtesy subjects get:
  // register it now, add games as you write them, and the page fills in.
  // Tags and rungs run newest first since 2026-11-11, as group pages and the
  // log always have (they were oldest first, like a subject page). Hat: two
  // directions across the paginated views were confusing, and a view that
  // interleaves several games isn't one story to read forward. A subject
  // page is one story and stays oldest first. A same-day tie puts the
  // daily's section before the essay, the group page's rule (buildGroupPages,
  // the home stream); sections of one day keep their member order.
  const newestFirst = (a, b) => b.date - a.date || (a.kind === "essay") - (b.kind === "essay");
  const buildTagPages = (api) => {
    const allFanOut = buildSubjectPages(api);
    const bySlug = new Map(allFanOut.map((s) => [s.slug, s]));

    return Object.entries(tags).map(([slug, meta]) => {
      const members = (meta?.members ?? [])
        .map((m) => bySlug.get(m))
        .filter(Boolean);

      const entries = [];
      for (const subject of members) {
        for (const fragment of subject.fragments) {
          entries.push({
            kind: "fragment",
            date: fragment.date,
            url: fragment.anchorUrl,
            subject,
            face: fragment.face,
            html: fragment.html,
          });
        }
      }

      // An essay reaches this tag directly (about: naming the tag) or
      // transitively (about: citing a subject this tag lists) — citedTags
      // carries both cases, computed once in buildEssayList. One entry per
      // essay per view, however many paths lead here.
      for (const essay of buildEssayList(api)) {
        if (!essay.citedTags.some((t) => t.slug === slug)) continue;
        entries.push({
          kind: "essay",
          date: essay.date,
          url: essay.url,
          title: essay.title,
          blurb: essay.blurb,
        });
      }

      entries.sort(newestFirst);

      return {
        slug,
        title: meta?.title ?? slug,
        description: meta?.description ?? null,
        // The tag's note (2026-11-13): blurbs/tags/<slug>.md, under the head.
        introHtml: noteIntroHtml(`tags/${slug}`),
        members,
        entries,
      };
    });
  };
  eleventyConfig.addCollection("tagPages", buildTagPages);

  // A rating view is a tag page with a derived membership. Everything else
  // about it — the definition at the top, the members line, the mixed timeline
  // — is the shape tag.njk already has, so /r/<rung>/ reuses that template.
  //
  // Membership is grouped from `rating:` at build time and never hand-listed: a
  // declared member list beside a per-subject key is two sources of truth, and
  // they drift the first time something is re-rated. Mints no nav link, same
  // rule as tags — a rung's view is reached from its chip on a subject page or
  // from the /r/ index, and "every game I loved" is the calibration surface the
  // scale exists for. All four build even at zero members, the same courtesy
  // an empty tag gets. Ordered by rank so the index can loop them as-is.
  const buildRatingPages = (api) => {
    const bySlug = new Map(buildSubjectPages(api).map((s) => [s.slug, s]));

    return ratingOrder.map((slug) => {
      const meta = ratings[slug];
      const members = [...bySlug.values()].filter((s) => s.rating?.slug === slug);

      // Essays deliberately do NOT reach a rating view. An essay is about a
      // subject; a rating is a verdict on one, and routing essays here would
      // make /r/ a second front page for the same writing. The members'
      // fragments are the page. That holds for /r/canon/ too: essays about
      // the canon itself opt onto /canon/ with `about: canon`.
      const entries = [];
      for (const subject of members) {
        for (const fragment of subject.fragments) {
          entries.push({
            kind: "fragment",
            date: fragment.date,
            url: fragment.anchorUrl,
            subject,
            face: fragment.face,
            html: fragment.html,
          });
        }
      }
      entries.sort(newestFirst);

      return {
        slug,
        title: meta?.title ?? slug,
        rank: meta?.rank ?? null,
        description: meta?.description ?? null,
        members,
        // Group icons show on a rung's members only when the rung spans groups.
        mixed: new Set(members.map((s) => s.group)).size > 1,
        entries,
        indexUrl: "/r/",
      };
    });
  };
  eleventyConfig.addCollection("ratingPages", buildRatingPages);

  // ------------------------------------------------------------ view pages
  //
  // The long timelines paginate (2026-11-11): /games/ held 211 entries in
  // 300 KB on one page and gains ~60 a month. A group's page, its log, a tag
  // and a rung split by count, PAGE_SIZE entries a page; an entry is one row
  // of timeline.njk (a day's ## section about a subject, same-subject
  // headings in a post already merged, or an essay). A view of
  // PAGE_SINGLE_MAX or fewer stays one page, and a last page shorter than
  // PAGE_MIN_TAIL folds into the one before it. Page 1 keeps the view's URL,
  // the rest are <url>page-N/, the archive's scheme. Subject pages stay
  // whole. Each item below is one page: the view, its slice of entries, and
  // a `pager`; the templates paginate over these with size 1, and the
  // collections they came from (groupPages, tagPages, …) stay one per view
  // for the nav, the cards and /r/. Slices of already-rendered entries, so
  // a page costs no re-render.
  const PAGE_SIZE = 30;
  const PAGE_SINGLE_MAX = 40;
  const PAGE_MIN_TAIL = 10;
  const pageSlices = (n) => {
    if (n <= PAGE_SINGLE_MAX) return [[0, n]];
    let pages = Math.ceil(n / PAGE_SIZE);
    if (n - PAGE_SIZE * (pages - 1) < PAGE_MIN_TAIL) pages -= 1;
    return Array.from({ length: pages }, (_, i) =>
      [i * PAGE_SIZE, i === pages - 1 ? n : (i + 1) * PAGE_SIZE]);
  };
  const pageUrl = (base, n) => (n === 1 ? base : `${base}page-${n}/`);
  const pagedViews = (views, key, baseOf) => views.flatMap((v) => {
    const base = baseOf(v);
    const slices = pageSlices(v[key].length);
    return slices.map(([from, to], i) => {
      const number = i + 1;
      return {
        ...v,
        [key]: v[key].slice(from, to),
        pager: {
          number,
          total: slices.length,
          url: pageUrl(base, number),
          first: base,
          previous: number > 1 ? pageUrl(base, number - 1) : null,
          next: number < slices.length ? pageUrl(base, number + 1) : null,
        },
      };
    });
  });
  // No page-N URL may belong to anything else. Every view can paginate one
  // day, so the check is against every view's base, not today's long ones:
  // a group slugged `page-2` would sit at /log/page-2/, and a redirect from
  // a <view>/page-N/ would shadow a real page. Fatal, like a clash in the
  // compile; Eleventy's own duplicate-output error only fires once both
  // pages exist.
  const pageClashes = (api) => {
    const bases = new Set([
      ...LIVE.flatMap((g) => [g.urls.home, g.urls.log]),
      ...buildTagPages(api).map((t) => `/t/${t.slug}/`),
      ...buildRatingPages(api).map((r) => `/r/${r.slug}/`),
    ]);
    const redirectsFile = path.join("src", "_data", "redirects.yaml");
    const redirects = fs.existsSync(redirectsFile)
      ? parseYaml(fs.readFileSync(redirectsFile, "utf8")) || []
      : [];
    const claimed = [
      ...GROUPS.flatMap((g) => Object.values(g.urls)),
      ...bases,
      ...[].concat(redirects).map((r) => String(r?.from ?? "")),
    ];
    const clash = claimed.filter((u) => {
      const m = /^(.*\/)page-\d+\/$/.exec(u);
      return m && bases.has(m[1]);
    });
    if (clash.length) throw new Error(`[chaosh.at] ${clash.join(", ")}: taken by a view's page-N URL (view pages, eleventy.config.js)`);
  };
  eleventyConfig.addCollection("groupPagesPaged", (api) => {
    pageClashes(api);
    return pagedViews(buildGroupPages(api), "stream", (g) => g.urls.home);
  });
  eleventyConfig.addCollection("groupLogPagesPaged", (api) =>
    pagedViews(buildGroupPages(api).filter((g) => g.log.length), "log", (g) => g.urls.log));
  eleventyConfig.addCollection("tagPagesPaged", (api) =>
    pagedViews(buildTagPages(api), "entries", (t) => `/t/${t.slug}/`));
  eleventyConfig.addCollection("ratingPagesPaged", (api) =>
    pagedViews(buildRatingPages(api), "entries", (r) => `/r/${r.slug}/`));

  // The pager's numbers (pager.njk, every paginated view and the archive):
  // every page up to seven, past that the first, the last, the current and
  // one either side, with null for each gap. A gap of exactly one page shows
  // that page instead, since "…" there would hide nothing but a number.
  const PAGER_ALL = 7;
  const pagerNumbers = (current, total) => {
    if (total <= PAGER_ALL) return Array.from({ length: total }, (_, i) => i + 1);
    const keep = [...new Set([1, current - 1, current, current + 1, total])]
      .filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    return keep.flatMap((n, i) => {
      const gap = i ? n - keep[i - 1] : 1;
      return gap === 1 ? [n] : gap === 2 ? [n - 1, n] : [null, n];
    });
  };
  eleventyConfig.addFilter("pagerNumbers", (pager) => pagerNumbers(pager.number, pager.total));

  // ----------------------------------------------------------------- canon
  //
  // /canon/ — the ten, the dated record of how they got that way, and the
  // essays about the canon itself (2026-10-22). Membership is `rating: canon`
  // (canonSlugs); the HISTORY is canon_log.yaml, which publish.py appends to
  // on any night the set changes, so a swap is still just two blurb edits and
  // the changelog writes itself. Hand edits there are expected: a date fixed,
  // a `why:` naming the essay that argued the change.
  const canonLogFile = path.join("src", "_data", "canon_log.yaml");
  const canonLog = fs.existsSync(canonLogFile)
    ? parseYaml(fs.readFileSync(canonLogFile, "utf8")) || []
    : [];
  const canonProblems = []; // reported in eleventy.after

  const slugList = (v) =>
    (v == null ? [] : [].concat(v)).map((s) => String(s ?? "").trim()).filter(Boolean);
  const logDate = (d) => (d instanceof Date ? d : new Date(String(d)));

  // Where the log leaves the canon, and when each of today's ten came on.
  // An entry's `out` frees its slots and its `in` fills them in order, extras
  // on the end, so a one-for-one swap keeps the slot's place in the hero.
  // Mirrors replay_canon_log() in the vault's chaosh_subjects.py, which
  // decides what gets logged — if one changes, change both. A line that
  // can't apply is reported and skipped, never fatal.
  // One group's entries only: a line without `medium:` is games, which is
  // every line from before the multi-medium build. The key stays `medium:`
  // (the log is Hat's, and every non-games line already says it); its value
  // is a group.
  const logMedium = (entry) => String(entry?.medium ?? DEFAULT_GROUP);
  const replayCanonLog = (log, medium = DEFAULT_GROUP) => {
    let roster = [];
    const joined = new Map();
    const problems = [];
    (Array.isArray(log) ? log : []).forEach((entry, i) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        problems.push(`entry ${i + 1} is not a mapping`);
        return;
      }
      if (logMedium(entry) !== medium) return;
      const label = entry.date ? String(entry.date instanceof Date
        ? entry.date.toISOString().slice(0, 10) : entry.date) : `entry ${i + 1}`;
      if (!entry.date) problems.push(`entry ${i + 1} has no date`);
      const holes = [];
      for (const s of slugList(entry.out)) {
        const at = roster.indexOf(s);
        if (at === -1) {
          problems.push(`${label}: out ${s} was not on the canon`);
          continue;
        }
        roster[at] = null;
        holes.push(at);
        joined.delete(s);
      }
      for (const s of slugList(entry.in)) {
        if (roster.includes(s)) {
          problems.push(`${label}: in ${s} was already on the canon`);
          continue;
        }
        if (holes.length) roster[holes.shift()] = s;
        else roster.push(s);
        if (entry.date) joined.set(s, logDate(entry.date));
      }
      roster = roster.filter((s) => s !== null);
    });
    return { roster, joined, problems };
  };

  // One canon per group with a canon band (per medium from 2026-10-25),
  // ten-ish rather than a strict ten. Called once per group by groupPages.
  const canonFor = (api, medium) => {
    const bySlug = new Map(buildSubjectPages(api).map((s) => [s.slug, s]));
    const essays = buildEssayList(api);
    const essayBySlug = new Map(essays.map((e) => [e.slug, e]));
    const { roster, joined, problems } = replayCanonLog(canonLog, medium);
    canonProblems.push(...problems.map((p) => medium === DEFAULT_GROUP ? p : `${medium}: ${p}`));
    const canonSlugs = new Set([...canonSlugsAll].filter((s) => groupOf(subjects[s]) === medium));

    // Slot order from the log. A canon game the log hasn't caught up with —
    // a swap made today, before the 2am run logs it, or any preview — goes
    // on the end rather than missing: membership is the rating, not the log.
    const order = [
      ...roster.filter((s) => canonSlugs.has(s)),
      ...[...canonSlugs].filter((s) => !roster.includes(s)),
    ];
    const members = order
      .map((s) => bySlug.get(s))
      .filter(Boolean)
      .map((s) => ({ ...s, since: joined.get(s.slug) ?? null }));

    const link = (s) => {
      if (!subjects[s]) canonProblems.push(`${s} is not a registered subject`);
      return { slug: s, title: subjects[s]?.title ?? s, known: Boolean(subjects[s]) };
    };
    const changes = (Array.isArray(canonLog) ? canonLog : [])
      .filter((e) => e && typeof e === "object" && !Array.isArray(e) && e.date
        && logMedium(e) === medium)
      .map((e, i) => {
        const ins = slugList(e.in).map(link);
        const outs = slugList(e.out).map(link);
        // `why:` is an essay's filename (or its /e/ slug — essaySlug of a
        // slug is itself). Unpublished or misspelt, the line still renders,
        // unlinked, and the build says which.
        let why = null;
        if (e.why != null && String(e.why).trim()) {
          why = essayBySlug.get(essaySlug(String(e.why).trim())) ?? null;
          if (!why) canonProblems.push(`${String(e.why)} (why:) is no published essay`);
        }
        return {
          date: logDate(e.date),
          // The founding line names no swap: it is the list as first published.
          founding: i === 0 && !outs.length,
          ins,
          outs,
          why: why && { url: why.url, title: why.title },
        };
      })
      .reverse(); // newest first: a changelog is read from the top

    return {
      members,
      changes,
      // `about: canon` is the games canon's: essays about the canon itself
      // predate the other media's, and no other medium has one yet.
      essays: medium === DEFAULT_GROUP
        ? essays.filter((e) => e.aboutCanon).sort((a, b) => b.date - a.date)
        : [],
      description: medium === DEFAULT_GROUP ? ratings[CANON]?.description ?? null : null,
    };
  };

  // A subject heading in a daily post becomes a link to its subject page, and is
  // rewritten to the canonical title from subjects.yaml — so "## dqxis" can be
  // typed on a phone and still reads "Dragon Quest XI S" on the site. An
  // unrecognised heading is left exactly as written.
  // A face keeps its own name ("## Bears" reads "Bears", filed under NFL).
  const linkSubjectsHtml = (html) =>
    String(html ?? "").replace(
      /<h2([^>]*)>([\s\S]*?)<\/h2>/gi,
      (whole, attrs, inner) => {
        const { slug, face } = resolveHeading(plainText(inner));
        if (!slug) return whole;
        // The canonical title is plain text from yaml going straight into html
        // that no template gets to escape, so escape it here. `inner` is the
        // fallback and is already rendered html — leave it alone.
        const title = face || subjects[slug]?.title ? escapeHtml(headingTitle(slug, face)) : inner;
        return `<h2${attrs}><a href="${subjectHref(slug)}">${title}</a></h2>`;
      },
    );

  // Per-section anchors (2026-11-03): every ## section of a daily gets an id
  // built from its heading AS TYPED, normalised — not from the subject it
  // resolves to — so /daily/2026-11-02/#bears holds if Bears ever splits
  // from NFL. A heading typed twice in a day takes -2, -3. Subject pages and
  // the views link back to the section in its day. Only on the daily's own
  // page: the home page shows several days, and two of them could both say
  // "## Bears".
  const anchorOf = (heading) => normalise(plainText(md.renderInline(String(heading ?? "")))).replace(/ /g, "-");
  const sectionAnchors = (headings) => {
    const seen = new Map();
    return headings.map((h) => {
      const a = anchorOf(h);
      if (!a) return null;
      const n = (seen.get(a) ?? 0) + 1;
      seen.set(a, n);
      return n === 1 ? a : `${a}-${n}`;
    });
  };

  // The feed keeps the plain form above — a reader has none of this stylesheet,
  // so the fragment scaffolding would arrive as dead markup. On the site each
  // section is wrapped instead, so a heading brings its sky with it.
  const FRAG_LOOSE = '<span class="sky sky-blank" aria-hidden="true"></span>';

  // A box cover's ratio goes on the fragment, not the cover: the fragment's
  // min-height and the narrow layout's float placeholder both size from it.
  const wrapFragment = (sky, body, box = null) =>
    `<div class="frag"${box ? ` style="--box:${box}"` : ""}>${sky}<div class="frag-body">${body}</div></div>`;

  const linkSubjectsFragments = (html, anchored = false) => {
    const src = String(html ?? "");
    if (!src.trim()) return src;

    const out = [];
    const seen = new Map();
    const idFor = (inner) => {
      if (!anchored) return "";
      const a = normalise(plainText(inner)).replace(/ /g, "-");
      if (!a) return "";
      const n = (seen.get(a) ?? 0) + 1;
      seen.set(a, n);
      return ` id="${n === 1 ? a : `${a}-${n}`}"`;
    };
    for (const part of src.split(/(?=<h2[\s>])/i)) {
      if (!part.trim()) continue;

      const m = /^<h2([^>]*)>([\s\S]*?)<\/h2>([\s\S]*)$/i.exec(part);
      if (!m) {
        out.push(wrapFragment(FRAG_LOOSE, part));
        continue;
      }

      const [, attrs, inner, rest] = m;
      const id = idFor(inner);
      const { slug, face } = resolveHeading(plainText(inner));

      // Unregistered headings stay exactly as written, but keep the column.
      if (!slug) {
        out.push(wrapFragment(FRAG_LOOSE, `<h2${attrs}${id}>${inner}</h2>${rest}`));
        continue;
      }

      const meta = subjects[slug] ?? {};
      const title = face || meta.title ? escapeHtml(headingTitle(slug, face)) : inner;
      const status = meta.status ?? "active";
      // A status chip only where the group has a shelf: a bandless subject
      // (Aurora Watch, a league) has no status to show.
      const badge = hasShelf(groupOf(meta))
        ? `<span class="badge b-${status}">${status}</span>` : "";
      const head =
        `<h2 class="frag-head"${attrs}${id}>` +
        `<a class="frag-subject" href="${subjectHref(slug)}">${title}</a>` +
        badge +
        `</h2>`;

      const cover = face?.cover ?? slug;
      out.push(wrapFragment(skyTag(slug, status, cover), head + rest, coverBoxOf(coverUrls.has(cover) ? cover : slug, fitOf(slug))));
    }
    return out.join("");
  };

  eleventyConfig.addFilter("linkSubjects", linkSubjectsFragments);

  // The same art, for a template that builds its own .frag: the view pages'
  // timelines (/log/, /t/, /r/) since 2026-11-03, when they took the daily's
  // shell with each fragment's cover in the art column. Hat: on the log "it's
  // hard to see what game is being written about" — the log mixes subjects,
  // so the cover IS the label. A filter over skyTag rather than markup in the
  // template so a view's art and a daily's cannot drift: same cover link, same
  // generated-tile fallback, same completed crop. The --box ratio goes on the
  // .frag, as wrapFragment does — the template reads it off the subject.
  // `face` is a fragment's face, when it wore one: its cover instead.
  eleventyConfig.addFilter("subjectSky", (slug, face) =>
    skyTag(slug, subjects[slug]?.status ?? "active", face?.cover ?? slug),
  );

  // The tag footer on a daily post: the union of the tags of every subject that
  // post files to. Read off the rendered HTML rather than the raw markdown so
  // it sees exactly the headings that became sections, with no second parser to
  // keep in step with splitSections().
  //
  // Union, so a post covering FFVII Remake and Metaphor footers as
  // "#final-fantasy #jrpg #atlus" — day-scoped, the way tags on a blog post
  // always are. Note the deliberate asymmetry with the tag page itself, which
  // is fragment-scoped: /t/atlus/ shows that post's Metaphor section alone, not
  // the whole day. The footer says what the day touched; the page shows only
  // what belongs.
  //
  // Ordered by tagviews.yaml, not by heading order, so the same pair of games
  // footers identically in every post that mentions them. (tagOrder is
  // declared up by `tags` — an essay's citedTags wants the same ordering.)
  eleventyConfig.addFilter("postTags", (html) => {
    const found = new Set();
    for (const [, inner] of String(html ?? "").matchAll(
      /<h2[^>]*>([\s\S]*?)<\/h2>/gi,
    )) {
      const slug = aliasMap.get(normalise(plainText(inner)));
      for (const t of tagsOfSubject.get(slug) ?? []) found.add(t);
    }
    return tagLinks(tagOrder.filter((t) => found.has(t)));
  });

  // --------------------------------------------------------------- spoilers
  //
  // ||like this|| — Discord syntax, because it is already in Hat's fingers and
  // survives a phone keyboard. Obsidian shows it as literal text, which is
  // fine: the author is not the one being protected.
  //
  // A pass over rendered HTML rather than a markdown-it inline rule, because
  // markdown-it does not treat "|" as a text terminator: its text rule swallows
  // "a ||spoiler|| b" whole, so an inline rule would only ever fire on a
  // spoiler that started a line. The pass skips <code>/<pre>, so a shell
  // "a || b" is left alone; table pipes never survive into HTML as a literal
  // "||" and need no handling.
  //
  // Two renderings of one markup, and the difference between them is the whole
  // point:
  //   site — a blurred span, revealed by focus
  //   feed — cut out entirely. A feed reader applies none of this site's CSS,
  //          and every reader sanitises unknown markup differently — several
  //          strip a wrapper and keep its contents, which fails OPEN and does
  //          it silently. Anything left in <content> is readable, so the only
  //          honest move is to not ship the words. Fixed-width, because a
  //          redaction that preserved length would leak it.
  const CODE_REGION = /(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi;
  // A spoiler is `||text||`. The match may not cross a block boundary: an
  // unpaired `||` used to reach forward to the next one anywhere later in the
  // document and blur — or, in the feed, delete — everything between, emitting
  // a span straddling `</p><p>`. Forbidding block closers inside the match
  // means a lone `||` now finds no partner and stays literal text, which is
  // what it looks like to whoever typed it.
  const SPOILER =
    /\|\|((?:(?!<\/(?:p|li|h[1-6]|blockquote|ul|ol|pre|td|th|table)>)[\s\S])+?)\|\|/g;

  // Code blocks (<pre>) are cut out whole, as before. Inline <code> is masked
  // instead of cut: split out, it broke a spoiler that contained code into two
  // halves, so ||a `code` spoiler|| … ||ok|| showed both spoilers and blurred
  // the innocent text between them, and the feed and meta description got
  // the words (2026-11-11). Masked, a span of code is one opaque character
  // pair that a spoiler can contain and whose own `||` can't pair with
  // anything; it's put back after `fn`, so code is still never touched —
  // inside a kept spoiler it rides along, inside a cut one it goes with it.
  // NUL never survives markdown-it (it becomes U+FFFD), so the mask can't
  // collide with text.
  const PRE_REGION = /(<pre[\s\S]*?<\/pre>)/gi;
  const INLINE_CODE = /<code[\s\S]*?<\/code>/gi;
  const outsideCode = (html, fn) =>
    String(html ?? "")
      .split(PRE_REGION)
      .map((part, i) => {
        if (i % 2) return part;
        const codes = [];
        const masked = part.replace(INLINE_CODE, (c) => `\u0000${codes.push(c) - 1}\u0000`);
        return fn(masked).replace(/\u0000(\d+)\u0000/g, (_m, n) => codes[n]);
      })
      .join("");

  // tabindex is what makes the span focusable, and focus is what reveals it —
  // click or tab, and the site stays at zero JavaScript. The blur is visual
  // only: a screen reader reads the words straight through, so a hidden
  // "spoiler:" label goes first, giving a listener the same warning the blur
  // gives a reader, and the moment to skip ahead.
  const revealSpoilers = (html) =>
    outsideCode(html, (s) =>
      s.replace(
        SPOILER,
        (_m, inner) =>
          `<span class="spoiler" tabindex="0"><span class="sr-only">spoiler: </span>${inner}</span>`,
      ),
    );

  const stripSpoilers = (html) =>
    outsideCode(html, (s) => s.replace(SPOILER, "[spoiler]"));

  eleventyConfig.addFilter("spoilers", revealSpoilers);

  // Feed readers resolve relative links against the feed URL, not the site, so
  // every href in feed content has to be absolute or it breaks in the reader.
  eleventyConfig.addFilter("absoluteUrls", (html, base) =>
    String(html ?? "").replace(
      /(href|src)="\/([^"]*)"/g,
      (_m, attr, rest) => `${attr}="${String(base).replace(/\/$/, "")}/${rest}"`,
    ),
  );

  // A feed entry's <summary> (2026-11-06): the opening prose, nothing else.
  // Aggregators that show a teaser (Kagi Small Web) build one themselves when
  // there isn't one — tags stripped, so the subject heading, an image caption
  // and the first paragraph ran together and cut off mid-sentence. Given a
  // short summary they pass it through as-is. Figures, asides, quotes and lists
  // are skipped; headings fall away because only <p> is taken. Fed the feed's
  // html, so spoilers are already cut out. The first paragraph, plus the
  // second when the first is a one-liner.
  const SUMMARY_SKIP = /<(figure|aside|blockquote|ul|ol|pre|table)\b[\s\S]*?<\/\1>/gi;
  const SUMMARY_MIN = 200;
  eleventyConfig.addFilter("feedSummary", (html) => {
    const paras = (String(html ?? "").replace(SUMMARY_SKIP, "").match(/<p>[\s\S]*?<\/p>/g) || [])
      .filter((p) => p.replace(/<[^>]+>/g, "").trim());
    const kept = paras.slice(0, 1);
    const text = (p) => p.replace(/<[^>]+>/g, "").trim().length;
    if (paras[1] && text(paras[0]) < SUMMARY_MIN) kept.push(paras[1]);
    return kept.join("\n");
  });

  // ------------------------------------------------------------------- feed
  //
  // Dated posts plus standing essays. A bare fragment-collector subject page
  // never enters the feed — that is what lets a finished essay announce itself
  // while a page that merely accumulates fragments stays quiet.
  //
  // Every entry's date is the post's OWN date and is never advanced on edit, so
  // appending to yesterday's post cannot re-notify anyone. That property is what
  // makes 2am automation safe, and it is verified by test — see the changelog.
  //
  // Newest FEED_LIMIT only (2026-09-23). Full text of every post ever meant a
  // file growing ~1MB a year, re-downloaded whole on every reader's poll. A
  // reader who wants to go further back has the archive; the feed is for what
  // is new. Dropping off the end is harmless — readers keep what they fetched.
  const FEED_LIMIT = 30;

  // When each post actually went out (2026-11-04), for <published>/<updated>.
  // The post's own date is midnight UTC — 7pm Eastern the evening BEFORE — so
  // a daily reached readers ~31 hours "old" and landed deep in anything sorted
  // by date (Bubbles' New, for one). publish.py stamps the run's time into
  // src/_data/shipped.json the first time it writes a post, keyed by its path
  // under src/, and never again: pinned exactly like the date it stands in
  // for, so an edit still cannot re-notify. Posts shipped before the sidecar
  // existed have no stamp and keep their date. The entry id stays on the date.
  const shippedFile = path.join("src", "_data", "shipped.json");
  const readShipped = () => {
    const stamps = fs.existsSync(shippedFile)
      ? JSON.parse(fs.readFileSync(shippedFile, "utf8"))
      : {};
    return (inputPath, date) => {
      const t = stamps[path.relative("src", inputPath).split(path.sep).join("/")];
      return t ? new Date(t) : date;
    };
  };

  eleventyConfig.addCollection("feed", (api) => {
    const shippedAt = readShipped();
    const entries = publishable(api.getFilteredByTag("dailies")).map((p) => ({
      url: p.url,
      date: p.date,
      shipped: shippedAt(p.inputPath, p.date),
      title: p.data.title || dateFormat.format(p.date),
      html: stripSpoilers(linkSubjectsHtml(md.render(p.rawInput))),
    }));

    for (const e of buildEssayList(api)) {
      entries.push({ url: e.url, date: e.date, shipped: shippedAt(e.inputPath, e.date),
        title: e.title, html: e.feedHtml });
    }

    return entries.sort((a, b) => b.shipped - a.shipped).slice(0, FEED_LIMIT);
  });

  // The second feed (2026-11-03): essays only, at /essays/feed.xml. The one
  // split that maps to a real difference in reader intent — volume, not
  // topic. No per-group, per-subject or per-tag feeds (Hat: "is anyone
  // unsubscribing from my entire blog because once a week I write a bit
  // about the bears game? I doubt it"); a reader who wants one topic reads
  // its page. Same entries, same ids, as in the full feed, so a reader
  // subscribed to both sees one essay once.
  eleventyConfig.addCollection("essayFeed", (api) => {
    const shippedAt = readShipped();
    return buildEssayList(api)
      .map((e) => ({ url: e.url, date: e.date, shipped: shippedAt(e.inputPath, e.date),
        title: e.title, html: e.feedHtml }))
      .sort((a, b) => b.shipped - a.shipped)
      .slice(0, FEED_LIMIT);
  });

  // ------------------------------------------------------------- link cards
  //
  // What a chaosh.at link unfurls into on Bluesky, Discord and the rest: an
  // og:image drawn by og.js (the post's pixel band, its title, the subject it
  // files to, that subject's cover) plus per-page text tags. Dailies and
  // essays get their own card — they are what gets shared; every other page
  // gets the one site card (2026-09-23).
  //
  // A card can NEVER fail the build. og.js is imported dynamically, and every
  // render is its own try/catch: a card that throws points its page at the
  // site card and is reported after the build; a renderer that will not even
  // load leaves every page with text tags and no image. Same "warn, never
  // fail" contract as unmatched headings — this is the third door into "one
  // post takes the site down", after template syntax (09-18) and unquoted
  // frontmatter (09-23), closed by construction.
  //
  // Rendered here, in a collection, rather than in eleventy.after beside the
  // skies: base.njk has to know whether a card rendered BEFORE it writes the
  // page, or a failed card would ship as a dead og:image URL.
  const OG_DESC_MAX = 160;
  const OG_SITE_SKY = "2026-07-27"; // the first daily: the site card's sky is the site's first night
  const OG_CACHE = path.join(".cache", "og");
  const ogMeta = new Map(); // page url -> { image, alt, description, type, published }
  const cardFiles = new Map(); // output path -> jpeg Buffer, written in eleventy.after
  const cardFailures = []; // "<url>: <error>"
  const cardsUsed = new Set(); // .cache/og file names this build rendered from or into
  let ogSiteImage = null;

  // Chip colours are the status tokens in style.css, read rather than copied
  // so a retuned token cannot leave the cards on the old colour.
  const cssTokens = (() => {
    const out = {};
    try {
      const css = fs.readFileSync(path.join("src", "css", "style.css"), "utf8");
      for (const [, name, hex] of css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\b/gi)) out[name] ??= hex;
    } catch {
      // A missing stylesheet is someone else's build failure; the cards fall
      // back to muted chips.
    }
    return out;
  })();
  const statusColor = (status) => cssTokens[`st-${status}`] ?? cssTokens.muted ?? "#a9a6ce";

  // "18 sep 2026" — the pixel face at card size fits ~20 characters in the text
  // column, so the month is short. Not Intl: en-GB spells September "Sept".
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const kickerDate = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

  // ~160 characters, cut at a word boundary. Plain text in, plain text out.
  const clipText = (s, max = OG_DESC_MAX) => {
    const text = String(s ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const at = cut.lastIndexOf(" ");
    return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.—–-]+$/, "")}…`;
  };

  // A title is typed text, but it can still carry ||spoiler|| markup, and a
  // card is as public as the feed — so the feed's rule: cut, not blurred.
  const cardText = (s) => String(s ?? "").replace(/\|\|[\s\S]+?\|\|/g, "[spoiler]").trim();

  // A marginalia entry (2026-11-13): the section opens on a link, the thing
  // it's about, then Hat's note. -> {source: {url, titleHtml} | null,
  // noteHtml}. The link comes out of the note; a dash, colon or comma right
  // after it goes too, so "[Title](url) — I think…" reads as just the note.
  // A section that doesn't open on a link is a plain note (publish.py names
  // it in the ntfy).
  const MARGIN_SOURCE = /^\s*<p>\s*<a href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/p>/i;
  const marginOf = (html) => {
    const m = MARGIN_SOURCE.exec(String(html ?? ""));
    if (!m) return { source: null, noteHtml: html };
    const rest = m[3].replace(/^\s*(?:<br\s*\/?>)?\s*(?:[—–:,-]\s*)?/, "").trim();
    return {
      source: { url: m[1], titleHtml: m[2] },
      noteHtml: (rest ? `<p>${rest}</p>` : "") + html.slice(m[0].length),
    };
  };

  // Reply by email (2026-11-13): `reply_email:` in site.yaml, blank hides it.
  // A mail draft to that address with the subject filled in, "Re: <title>",
  // the date when a daily has none. Nothing comes back to the site.
  const replyEmail = typeof siteData.reply_email === "string" ? siteData.reply_email.trim() : "";
  const replyHref = (title) => replyEmail
    ? `mailto:${replyEmail}?subject=${encodeURIComponent(`Re: ${cardText(title)}`)}`
    : "";
  eleventyConfig.addFilter("replyHref", replyHref);
  // The feed's form: one line appended to the entry's content, since a feed
  // reader is where most readers will meet it.
  eleventyConfig.addFilter("replyHtml", (title) => {
    const href = replyHref(title);
    return href ? `<p><a href="${href.replace(/&/g, "&amp;")}">Reply by email</a></p>` : "";
  });

  // A group page's one-line entry (2026-11-13): the section's first
  // sentence, redacted, clipped. Sections have no titles, so the opening
  // stands in for one. A section that opens on an image or a list falls
  // back to its first text of any kind.
  const LEDE_MAX = 140;
  const ledeOf = (html) => {
    const text = firstPara(html)
      || plainText(stripSpoilers(html).replace(/<(figure|aside)\b[\s\S]*?<\/\1>/gi, " "));
    const flat = String(text).replace(/\s+/g, " ").trim();
    const sentence = flat.match(/^.+?[.!?…](?=\s|$)/);
    return clipText(sentence ? sentence[0] : flat, LEDE_MAX);
  };
  // "8 nov 2026": the one-line entry's date. Short like the strips, but
  // with the year, since a group's log runs back years.
  eleventyConfig.addFilter("lineDate", (d) =>
    `${shortDateFormat.format(d).toLowerCase()} ${d.getUTCFullYear()}`);

  // First paragraph of the REDACTED render. Headings are <h2>; figures,
  // asides, quotes and lists are skipped (the feed summary's rule), so the
  // first <p> left is the first prose.
  const firstPara = (html) => {
    const m = stripSpoilers(html).replace(SUMMARY_SKIP, "").match(/<p>([\s\S]*?)<\/p>/i);
    return m ? plainText(m[1]) : "";
  };

  // The chip and the cover for a list of subject slugs: the chip names the
  // first and counts the rest; the cover is the first that has one. Covers
  // satori cannot read (webp, avif) count as no cover.
  const cardSubjects = (slugs) => {
    if (!slugs.length) return {};
    const first = slugs[0];
    const canon = canonSlugsAll.has(first);
    const chip = {
      text: String(subjects[first]?.title ?? first).toLowerCase(),
      more: slugs.length - 1,
      canon,
      status: subjects[first]?.status ?? "active",
      color: canon ? cssTokens.gold ?? "#f5c86b" : statusColor(subjects[first]?.status ?? "active"),
    };
    // Pixel covers stay out: the card would scale them off their grid.
    const withCover = slugs.find((s) => !coverPixels.has(s) && /\.(jpe?g|png)$/i.test(coverUrls.get(s) ?? ""));
    const cover = withCover
      ? { file: path.join("src", coverUrls.get(withCover)), canon: canonSlugsAll.has(withCover), box: coverBox(withCover) }
      : null;
    return { chip, cover };
  };

  eleventyConfig.on("eleventy.before", () => {
    ogMeta.clear();
    cardFiles.clear();
    cardFailures.length = 0;
    cardsUsed.clear();
    ogSiteImage = null;
  });

  eleventyConfig.addCollection("linkCards", async (api) => {
    // The outer guard: the per-card catches below cover rendering, this
    // covers everything else (spec building, a malformed post). Whatever
    // escapes, the pages still build, with whatever meta was gathered.
    try {
      return await buildLinkCards(api);
    } catch (err) {
      cardFailures.push(`link cards abandoned: ${err?.stack ?? err}`);
      return [...ogMeta.keys()];
    }
  });

  const buildLinkCards = async (api) => {
    const siteData = (() => {
      try {
        return parseYaml(fs.readFileSync(path.join("src", "_data", "site.yaml"), "utf8")) || {};
      } catch {
        return {};
      }
    })();

    // Text first: descriptions never depend on the renderer, so a page keeps
    // them however badly the images go.
    const jobs = []; // { url, rel, spec }
    for (const post of publishable(api.getFilteredByTag("dailies"))) {
      const key = post.date.toISOString().slice(0, 10);
      const slugs = [];
      for (const { heading, body } of splitSections(post.rawInput)) {
        const slug = heading && body.join("").trim() ? aliasMap.get(normalise(heading)) : null;
        if (slug && !slugs.includes(slug)) slugs.push(slug);
      }
      const title = cardText(post.data.title) || dateFormat.format(post.date);
      ogMeta.set(post.url, {
        description: clipText(firstPara(md.render(post.rawInput))),
        type: "article",
        published: post.date.toISOString(),
        title,
        alt: title,
      });
      jobs.push({
        url: post.url,
        rel: `og/daily/${key}.jpg`,
        spec: { sky: key, kicker: `daily · ${kickerDate(post.date)}`, title, ...cardSubjects(slugs) },
      });
    }

    for (const essay of buildEssayList(api)) {
      const key = essay.date.toISOString().slice(0, 10);
      const title = cardText(essay.title);
      ogMeta.set(essay.url, {
        description: clipText(cardText(essay.description) || essay.blurb || ""),
        type: "article",
        published: essay.date.toISOString(),
        title,
        alt: title,
      });
      jobs.push({
        url: essay.url,
        rel: `og/e/${essay.slug}.jpg`,
        spec: { sky: key, kicker: `essay · ${kickerDate(essay.date)}`, title, ...cardSubjects(essay.citedSubjects) },
      });
    }

    // Subject pages have no card of their own yet (not shared enough to earn
    // one), but their text is cheap: the blurb, else what the tile says.
    for (const [slug, meta] of Object.entries(subjects)) {
      const blurb = blurbTexts.get(slug);
      const verdict = ratingOf(slug, meta)?.title;
      ogMeta.set(`/s/${slug}/`, {
        description: clipText(
          (blurb && firstPara(md.render(blurb))) ||
            [meta?.status ?? "active", verdict].filter(Boolean).join(" · "),
        ),
      });
    }

    let og;
    try {
      og = await import("./og.js");
    } catch (err) {
      cardFailures.push(`renderer did not load — no page has an image: ${err.message}`);
      return [...ogMeta.keys()];
    }

    const render = async (url, rel, spec) => {
      try {
        cardFiles.set(rel, await og.renderCard(spec, { cacheDir: OG_CACHE, used: cardsUsed }));
        return `/${rel}`;
      } catch (err) {
        cardFailures.push(`${url}: ${err?.message ?? err}`);
        return null;
      }
    };

    ogSiteImage = await render("site card", "og/site.jpg", {
      sky: OG_SITE_SKY,
      title: cardText(siteData.description) || "chaosh.at",
    });

    for (const { url, rel, spec } of jobs) {
      const image = (await render(url, rel, spec)) ?? ogSiteImage;
      ogMeta.get(url).image = image;
    }

    // Sweep the cards this build didn't need (2026-11-11). Every edit to a
    // title, a cover or a sky is a new cache key, and the old card stayed:
    // 484 on disk for 120 in use, and CI saves the lot as a new cache entry
    // every run. Only here, after every card was asked for — a run that
    // died earlier, or a renderer that never loaded, sweeps nothing. The
    // masthead cache is swept the same way, by its code hash, below.
    try {
      for (const name of fs.existsSync(OG_CACHE) ? fs.readdirSync(OG_CACHE) : []) {
        if (name.endsWith(".jpg") && !cardsUsed.has(name)) fs.rmSync(path.join(OG_CACHE, name), { force: true });
      }
    } catch (err) {
      console.warn(`[chaosh.at] link card cache not swept (the site is fine): ${err?.message ?? err}`);
    }

    return [...ogMeta.keys()];
  };

  // base.njk's one question per page. Taking the collection as its input is
  // what makes the dependency real: Eleventy resolves collections.linkCards —
  // every card rendered or failed — before any template reads this.
  eleventyConfig.addFilter("linkCard", (_cards, url) => {
    const meta = ogMeta.get(url) ?? {};
    return { ...meta, image: "image" in meta ? meta.image : ogSiteImage };
  });

  // The masthead's sky rolls its hue at each build — a different aurora every
  // day, held all day, zero JavaScript. Two 20-frame sprite sheets — the back
  // curtain 288×64 a frame, the front 192×64 — drawn as true pixel art and
  // stepped through together by CSS at ×5, so the pair repeats every 2880px.
  // Plus the light each curtain casts, baked from the same frames (aurora.js
  // pixelLightSheet): body::after screens both over the header, at the same
  // two periods as the sky. Four files, a set.
  const today = new Date().toISOString().slice(0, 10);
  const MASTHEAD_FILES = ["sheet.png", "sheet-back.png", "light.png", "light-back.png"];
  const mastheadSet = (key, opts = {}) => {
    const { front, back } = pixelLayers(key, opts);
    const light = pixelLightSheet(front, { below: PIXEL_LIGHT_BELOW });
    const lightBack = pixelLightSheet(back, { below: PIXEL_LIGHT_BELOW });
    // Indexed: twenty mostly-repeating frames only compress once a frame fits
    // in deflate's window (png.js).
    return [
      encodePngIndexed(front.px, front.w, front.h),
      encodePngIndexed(back.px, back.w, back.h),
      encodePng(light.px, light.w, light.h, 3),
      encodePng(lightBack.px, lightBack.w, lightBack.h, 3),
    ];
  };
  mastheadSet(today).forEach((png, i) => skyFiles.set(`img/aurora/${MASTHEAD_FILES[i]}`, png));
  // The page's star tile, reseeded with the masthead every build.
  const stars = starTile(today);
  skyFiles.set("img/aurora/stars.png", encodePng(stars.px, stars.w, stars.h, 4));

  // A post page's masthead is the post's own sky (2026-11-04): the night it
  // was written, animated, in place of the band it wore until then. Drawn in
  // the BAND's form (pixelBandForm), not the masthead's — the live masthead
  // deliberately avoids its own day's band form (aurora.js pixelForm), and a
  // post page wants the sky a reader knows from the band. Hue and geometry
  // seeds come from the date on both paths (pixelSheet), so only the form
  // needed saying. The frame colour and the wordmark follow the same date, or
  // a post under its own sky would wear today's chrome.
  //
  // Built, never drawn in the browser, one set per post date at
  // /img/aurora/<date>/ (~44KB; a reader loads only their page's). ~140ms a
  // set, every post ever written, every build — so a set is cached on disk
  // under a hash of the code that draws it (.cache/aurora/<hash>/<date>/),
  // and CI keeps .cache/ between runs (deploy.yml). A renderer change is a
  // new hash and redraws everything; older hash folders are swept here.
  const MASTHEAD_CACHE_ROOT = path.join(".cache", "aurora");
  const mastheadHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync("aurora.js"))
    .update(fs.readFileSync("png.js"))
    .update(`below=${PIXEL_LIGHT_BELOW};form=band`)
    .digest("hex")
    .slice(0, 16);
  const MASTHEAD_CACHE = path.join(MASTHEAD_CACHE_ROOT, mastheadHash);
  if (fs.existsSync(MASTHEAD_CACHE_ROOT))
    for (const name of fs.readdirSync(MASTHEAD_CACHE_ROOT))
      if (name !== mastheadHash) fs.rmSync(path.join(MASTHEAD_CACHE_ROOT, name), { recursive: true, force: true });
  const mastheads = new Map(); // date -> { vars, frame, wordmark }
  const todayMasthead = { vars: "", frame: dayFrame(today), wordmark: cometMarkSvg(today, 2) };
  // base.njk's one question per page: whose sky? A date (a daily's, an
  // essay's) gets that date's set; nothing gets today's, at the stable root
  // URLs style.css names as its defaults.
  eleventyConfig.addFilter("masthead", (d) => {
    if (!d) return todayMasthead;
    const key = new Date(d).toISOString().slice(0, 10);
    if (mastheads.has(key)) return mastheads.get(key);
    const dir = path.join(MASTHEAD_CACHE, key);
    const cached = MASTHEAD_FILES.map((f) => path.join(dir, f));
    let pngs;
    if (cached.every((f) => fs.existsSync(f))) pngs = cached.map((f) => fs.readFileSync(f));
    else {
      pngs = mastheadSet(key, { form: pixelBandForm(key) });
      fs.mkdirSync(dir, { recursive: true });
      pngs.forEach((png, i) => fs.writeFileSync(cached[i], png));
    }
    pngs.forEach((png, i) => skyFiles.set(`img/aurora/${key}/${MASTHEAD_FILES[i]}`, png));
    const url = (i) => `url(/img/aurora/${key}/${MASTHEAD_FILES[i]})`;
    const m = {
      vars: `--sky-front:${url(0)};--sky-back:${url(1)};--light-front:${url(2)};--light-back:${url(3)};`,
      frame: dayFrame(key),
      wordmark: cometMarkSvg(key, 2),
    };
    mastheads.set(key, m);
    return m;
  });

  // The 88×31 site button, at stable root URLs so it can be hotlinked. Still
  // and animated; the friend picks. Same date-driven hue as the masthead —
  // a button on someone else's page wears the day's sky. Binary, but it
  // rides in skyFiles with the SVGs: writeFileSync takes a Buffer as readily
  // as a string, and one write loop is one place to look.
  const button = buttonFiles(today);
  skyFiles.set("button.png", button.png);
  skyFiles.set("button.gif", button.gif);

  // The forum signature (sig.js): one panel — comet mark, tagline, latest post,
  // latest essay, Bluesky — cut into three flush images at stable /sig/ URLs,
  // redrawn every build. Built
  // in a collection because it needs the posts; nothing reads the result. A
  // failure is a warning: the sig goes stale, the site still ships.
  eleventyConfig.addCollection("sig", async (api) => {
    try {
      const dailies = publishable(api.getFilteredByTag("dailies"))
        .sort((a, b) => b.date - a.date)
        .map((p) => ({ date: p.date, url: p.url, title: p.data.title }));
      const essay = [...buildEssayList(api)].sort((a, b) => b.date - a.date)[0] ?? null;
      const site = (() => {
        try {
          return parseYaml(fs.readFileSync(path.join("src", "_data", "site.yaml"), "utf8")) || {};
        } catch {
          return {};
        }
      })();
      const { files } = await sigFiles({ dailies, essay, bluesky: site.bluesky, siteUrl: site.url ?? "" });
      for (const [rel, data] of files) skyFiles.set(rel, data);
    } catch (err) {
      cardFailures.push(`forum sig not drawn: ${err?.stack ?? err}`);
    }
    return [];
  });

  // Unmatched headings are a warning, never a build failure — publishing is
  // automated at 2am and a typo must not take the site down.
  eleventyConfig.on("eleventy.after", () => {
    for (const [rel, svg] of skyFiles) {
      const dest = path.join("_site", rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, svg);
    }

    for (const [rel, jpg] of cardFiles) {
      const dest = path.join("_site", rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, jpg);
    }

    // A card that failed is a page shared with the site card instead of its
    // own — wrong but harmless, so it is a warning, never a failure.
    if (cardFailures.length > 0) {
      console.warn(`\n[chaosh.at] ${cardFailures.length} link card(s) failed to render:`);
      for (const f of cardFailures) console.warn(`  · ${f}`);
      console.warn(
        ogSiteImage
          ? `  Those pages unfurl with the site card. The site built normally.\n`
          : `  No site card either — those pages unfurl as text only. The site built normally.\n`,
      );
    }

    if (undated.size > 0) {
      console.warn(
        `\n[chaosh.at] ${undated.size} post(s) NOT PUBLISHED — no usable date:`,
      );
      for (const file of undated) console.warn(`  · ${file}`);
      console.warn(
        `  Rename to YYYY-MM-DD.md, or add "date: YYYY-MM-DD" to the frontmatter.\n`,
      );
    }

    if (undatedEssays.size > 0) {
      console.warn(
        `\n[chaosh.at] ${undatedEssays.size} essay(s) NOT PUBLISHED — no explicit date:`,
      );
      for (const file of undatedEssays) console.warn(`  · ${file}`);
      console.warn(
        `  Add "date: YYYY-MM-DD" — without it the essay re-dates itself on every deploy.\n`,
      );
    }

    // Putting membership on the tag buys one edit per tag, and costs this: a
    // members entry can name a subject that does not exist and nothing else
    // would ever say so — the game is simply absent from the view.
    const strays = Object.entries(tags).flatMap(([tag, meta]) =>
      (meta?.members ?? [])
        .filter((m) => !subjects[m])
        .map((m) => `${tag} → ${m}`),
    );
    if (strays.length > 0) {
      console.warn(
        `\n[chaosh.at] ${strays.length} tag member(s) match no subject:`,
      );
      for (const stray of strays) console.warn(`  · ${stray}`);
      console.warn(`  That subject is missing from its tag page. Check tagviews.yaml.\n`);
    }

    // Reported, never minted. A bad value renders the tile as "pending" AND
    // drops the game's row from its /r/ view, and both failures are invisible
    // on the page — the tile just looks like one left unrated on purpose.
    if (canonProblems.length > 0) {
      console.warn(`\n[chaosh.at] ${canonProblems.length} canon_log.yaml problem(s):`);
      for (const problem of canonProblems) console.warn(`  · ${problem}`);
      console.warn(`  /canon/ still builds; fix the line in the vault's canon_log.yaml.\n`);
    }

    if (badRatings.size > 0) {
      console.warn(
        `\n[chaosh.at] ${badRatings.size} rating: value(s) not in ratings.yaml:`,
      );
      for (const [slug, value] of badRatings) {
        console.warn(`  · ${slug} → ${value}`);
      }
      console.warn(`  That game renders as pending. Fix the slug, or add the rung to ratings.yaml on purpose.\n`);
    }

    // The compile refuses both of these in the vault; this is the backstop
    // for a repo copy that got here some other way.
    if (undeclaredGroups.length > 0) {
      console.warn(`\n[chaosh.at] ${undeclaredGroups.length} first categor(ies) name no group in site.yaml:`);
      for (const g of undeclaredGroups) console.warn(`  · ${g}`);
      console.warn(`  Those subjects have their pages but no group page, no etc entry and no views.\n`);
    }

    if (cardProblems.length > 0) {
      console.warn(`\n[chaosh.at] ${cardProblems.length} card problem(s):`);
      for (const p of cardProblems) console.warn(`  · ${p}`);
      console.warn(`  The rest of the cards still show; fix the line in the vault.\n`);
    }

    if (unmatched.size > 0) {
      console.warn(
        `\n[chaosh.at] ${unmatched.size} unclassified heading(s) — not on any subject page:`,
      );
      for (const { label } of unmatched.values()) {
        console.warn(`  · ${label}`);
      }
      console.warn(`  Add them to subjects.yaml to collect them retroactively.\n`);
    }

    // Declare-first: an about: slug must already be a subjects.yaml key/alias
    // or a tagviews.yaml key. Nothing is ever minted from a typo — same
    // "warn, never fail" contract as unmatched headings above.
    const unresolvedAbout = aboutIssues.filter((i) => i.reason === "unresolved");
    if (unresolvedAbout.length > 0) {
      console.warn(
        `\n[chaosh.at] ${unresolvedAbout.length} about: slug(s) match no subject or tag:`,
      );
      for (const { file, slug } of unresolvedAbout) {
        console.warn(`  · ${file} → ${slug}`);
      }
      console.warn(`  Declare it in subjects.yaml/tagviews.yaml, or fix the typo.\n`);
    }

    const collisions = aboutIssues.filter((i) => i.reason === "collision");
    if (collisions.length > 0) {
      console.warn(
        `\n[chaosh.at] ${collisions.length} about: slug(s) name both a subject and a tag:`,
      );
      for (const { file, slug } of collisions) {
        console.warn(`  · ${file} → ${slug} (subject wins)`);
      }
      console.warn(`  Rename one so about: resolution isn't guessing.\n`);
    }

    if (dailyAbout.length > 0) {
      console.warn(
        `\n[chaosh.at] ${dailyAbout.length} daily post(s) carry about: — ignored:`,
      );
      for (const file of dailyAbout) console.warn(`  · ${file}`);
      console.warn(`  Dailies file by ## heading; about: is essay-only.\n`);
    }

    if (homelessEssays.length > 0) {
      console.warn(
        `\n[chaosh.at] ${homelessEssays.length} essay(s) with no resolvable about: — on no view:`,
      );
      for (const file of homelessEssays) console.warn(`  · ${file}`);
      console.warn(`  The essay has its page and feed entry, but nothing points to it.\n`);
    }
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
