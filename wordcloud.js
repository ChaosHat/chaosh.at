// The about page's two clouds (2026-10-30): the words Hat uses more than
// English does, and the subjects he has written the most about. Built at
// build time like everything else, so they follow the writing with no
// JavaScript and no second writer: the 2am publish ships a post, the build
// re-counts.
//
// Distinctive, not frequent. A plain word count over the posts tops out at
// "her, good, here, now, fun", which says how English works, not what this
// site sounds like. Each word is scored against a frozen English baseline
// (wordfreq-en.tsv): ratio = how much more often Hat uses it than English
// does, score = ln(ratio) * ln(count), so a word has to be both unusual and
// actually used. Raw ratio alone hands the top to five-use oddities; raw
// count alone hands it back to "really".
//
// Three things are kept out, each because it crowded out the voice in the
// prototype run:
//   · subject names and aliases: the subject cloud already has them.
//   · proper nouns (a word capitalised mid-sentence most of the time): the
//     cast of characters. Wanted as its own cloud someday, not mixed in.
//   · conversational filler (FILLER below, plus `cloud_skip:` in site.yaml):
//     it scores as distinctive only because the posts are chattier than the
//     baseline.
import fs from "node:fs";
import { hashOf } from "./aurora.js";

export const FREQ_FILE = "wordfreq-en.tsv";

// Zipf for a word past the table's 50,000th: just under the table's floor.
const ZIPF_FLOOR = 2.4;
// A word must be used this many times more often than English uses it.
const MIN_RATIO = 3;
// A word capitalised mid-sentence at least this often is a name.
const PROPER_SHARE = 0.6;
// The current year's cloud waits for this many words of writing; until then
// the year shown is the last one (a January cloud of three posts is noise).
const YEAR_MIN_WORDS = 2000;

// Filler and the site's own furniture. Edit freely; site.yaml's cloud_skip:
// is the vault-side way to add to it without touching code.
const FILLER = new Set(`
  really just like pretty kind kinda sort feel feels felt feeling think thought
  thinking stuff thing things lot lots bit maybe also okay definitely actually
  basically totally seems seem seemed bunch sure going gonna getting got get
  gets probably honestly anyway though yeah yes guess mean especially already
  i'm i've i'll i'd don't didn't doesn't isn't wasn't aren't weren't can't
  won't wouldn't couldn't shouldn't haven't hasn't they're that's there's it's
  you're we're what's let's here's who's it'll that'll
  game games play plays played playing player
`.split(/\s+/).filter(Boolean));

let freq = null;
const loadFreq = () => {
  if (freq) return freq;
  freq = new Map();
  for (const line of fs.readFileSync(FREQ_FILE, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [word, z] = line.split("\t");
    freq.set(word, Number(z) / 100);
  }
  return freq;
};

const WORD = /[A-Za-z][A-Za-z'’]*[A-Za-z]/g;
// What ends a sentence, looking back past spaces, quotes and brackets. A word
// after one of these is capitalised by grammar, which says nothing about it.
const SENTENCE_END = /(^|[.!?:;\n]|\n\s*[-*>])[\s"“'‘(\[*_]*$/;

// [{ text }] -> Map word -> { n, mid, caps, forms }
const tally = (docs) => {
  const words = new Map();
  for (const { text } of docs) {
    for (const m of text.matchAll(WORD)) {
      const raw = m[0].replace(/’/g, "'");
      const word = raw.toLowerCase().replace(/'s$/, "");
      if (word.length < 3) continue;
      const initial = SENTENCE_END.test(text.slice(Math.max(0, m.index - 6), m.index));
      const w = words.get(word) ?? { n: 0, mid: 0, caps: 0, forms: new Map() };
      w.n += 1;
      if (!initial) {
        w.mid += 1;
        if (raw[0] !== raw[0].toLowerCase()) w.caps += 1;
      }
      words.set(word, w);
    }
  }
  // Plurals fold into their singular (cutscene/cutscenes), so one idea is one
  // word; the cloud shows whichever form was written more.
  for (const [word, w] of words) w.forms.set(word, w.n);
  for (const [word, w] of [...words]) {
    if (!word.endsWith("s")) continue;
    const stem = [word.slice(0, -1), word.slice(0, -2)]
      .find((s) => s.length >= 3 && words.has(s));
    if (!stem) continue;
    const into = words.get(stem);
    into.n += w.n;
    into.mid += w.mid;
    into.caps += w.caps;
    into.forms.set(word, w.n);
    words.delete(word);
  }
  return words;
};

// -> [{ label, weight }], most distinctive first.
export const vocabulary = (docs, { exclude = new Set(), skip = [], limit = 60 } = {}) => {
  const table = loadFreq();
  const words = tally(docs);
  let total = 0;
  for (const w of words.values()) total += w.n;
  if (!total) return [];
  const minN = Math.max(4, Math.round(total / 7000));
  const skipped = new Set([...FILLER, ...skip.map((s) => String(s).toLowerCase())]);
  const scored = [];
  for (const [word, w] of words) {
    if (w.n < minN || skipped.has(word) || exclude.has(word)) continue;
    if (w.mid && w.caps / w.mid >= PROPER_SHARE) continue;
    const ref = 10 ** ((table.get(word) ?? ZIPF_FLOOR) - 9);
    const ratio = w.n / total / ref;
    if (ratio < MIN_RATIO) continue;
    const label = [...w.forms].sort((a, b) => b[1] - a[1])[0][0];
    scored.push({ label, weight: Math.log(ratio) * Math.log(w.n) });
  }
  return scored.sort((a, b) => b.weight - a.weight).slice(0, limit);
};

// Which year the "this year" cloud shows, given every dated doc: the current
// one once it has YEAR_MIN_WORDS of writing, otherwise the last.
export const cloudYear = (docs, now = new Date()) => {
  const year = now.getUTCFullYear();
  const words = docs
    .filter((d) => d.date.getUTCFullYear() === year)
    .reduce((sum, d) => sum + d.text.split(/\s+/).length, 0);
  return words >= YEAR_MIN_WORDS ? year : year - 1;
};

// Four steps on the pixel face's 8px lattice, by rank: the top twentieth at
// 40px, then 32, 24, and the long tail at the 16px body size.
const STEPS = [[0.05, 4], [0.2, 3], [0.5, 2], [1, 1]];
const stepOf = (i, n) => STEPS.find(([share]) => i < Math.ceil(n * share))[1];

const escape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// [{ label, weight, href?, color? }] -> html. Sized by rank, then shuffled
// with a seed so the big words don't all pile up at the front. The seed is
// the caption plus the day, so the layout holds all day and reshuffles with
// the sky.
// maxStep caps the size: subject titles run to six words, and at 40px a few
// of them filled a phone screen each.
export const cloudHtml = (entries, { caption, seed, maxStep = 4 }) => {
  if (!entries.length) return "";
  const ranked = entries.map((e, i) => ({
    ...e, step: Math.min(maxStep, stepOf(i, entries.length)),
  }));
  const order = ranked
    .map((e) => ({ e, k: hashOf(`${seed}:${e.label}`) }))
    .sort((a, b) => a.k - b.k)
    .map(({ e }) => e);
  const items = order.map(({ label, href, color, step }) => {
    const style = color ? ` style="--cloud:${color}"` : "";
    const word = escape(label);
    return href
      ? `<li class="c${step}"${style}><a href="${href}">${word}</a></li>`
      : `<li class="c${step}"${style}>${word}</li>`;
  });
  return `<p class="cloud-caption">${escape(caption)}</p><ul>${items.join("")}</ul>`;
};

// [{ label, kind, html }] -> one window, one cloud showing, a tab per cloud
// (2026-10-30: four clouds one under another made About a long scroll). The
// radios come first so `:checked ~` reaches both the tabs and the panels — no
// JavaScript, no :has(). The panels share one grid cell, so the window is as
// tall as its tallest cloud and switching never moves the page under the
// reader. A div, not a figure: post figures float into the image column.
export const cloudStack = (panels) => {
  panels = panels.filter((p) => p.html);
  if (!panels.length) return "";
  const radios = panels.map((_, i) =>
    `<input type="radio" name="cloud" id="cl-${i}" class="mt-radio"${i ? "" : " checked"}>`);
  const tabs = panels.map((p, i) => `<label for="cl-${i}">${escape(p.label)}</label>`);
  const bodies = panels.map((p, i) =>
    `<div class="cloud cloud-${p.kind} cp-${i}">${p.html}</div>`);
  return `<div class="clouds">${radios.join("")}`
    + `<div class="cloud-tabs">${tabs.join("")}</div>`
    + `<div class="cloud-window">${bodies.join("")}</div></div>`;
};
