// The aurora engine. Design rationale: vault, 90_Reference/91_Documentation/
// "chaosh.at Design System". Everything here is deterministic: a subject's sky
// is a pure function of (slug, status, recency tier), and the header's of the
// build date — same inputs, byte-identical SVG, forever.

// ---------------------------------------------------------------- color

// OKLCH -> sRGB hex at build time, so the SVGs carry plain hex and owe the
// browser nothing. Perceptual lightness is what lets one value ramp hold at
// every hue on the arc.
const oklch = (L, C, Hdeg) => {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    "#" +
    lin
      .map((c) => {
        const g = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, g)) * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
};

// The ladder still spreads subjects over 0-360, but the paint maps that onto a
// curated 240-degree arc — green through teal, blue, violet, magenta, to red —
// skipping the olive-brown quarter where a saturated aurora reads as sick sky.
const ARC_START = 140;
const ARC_SPAN = 240;
const ARC_END = ARC_START + ARC_SPAN;
const arcHue = (ladderHue) => ARC_START + (ladderHue / 360) * ARC_SPAN;

// `lMax` caps perceptual lightness for a canvas where nothing is encoded in
// brightness. On subject skies brightness IS the recency axis, so capping
// there would compress a channel — the ceiling is for the masthead and the
// post bands only, where the aurora sits under type that has to stay readable.
//
// `spread` pulls the three fills apart in HUE, in degrees of arc. Until now a
// sky was one hue at four lightnesses, so it could only get paler going up —
// but a real aurora changes colour with height, because different species emit
// at different altitudes: molecular nitrogen makes the pink lower fringe where
// the hard particles reach deepest, atomic oxygen's green line fills the body,
// and its metastable red line only radiates high up where the air is too thin
// to quench it first. That vertical run is most of what reads as "aurora".
//
// This does not copy those colours. Anchoring to the real ones would make
// every sky green-with-a-pink-rim and flatten the daily hue rotation, which is
// the whole point of the ladder — the site already traded accuracy for variety
// when it decided a display takes one arbitrary hue. So it takes the GRAMMAR
// (rim, body and crown are different hues running in one direction) and
// applies it relative to whatever hue the day drew.
//
// The run is DISTRIBUTED INTO THE ARC, not clamped against it. The arc skips
// the olive-brown quarter where a saturated aurora reads as sick sky, and a
// wide spread is exactly what walks out of it — the scrapped desk-pad round
// drifted into olive by clamping the wrong space. But clipping at the arc's
// edge is its own bug: a green day sits near the floor, so a symmetric spread
// pushed its rim straight into the wall and pinned it there, and `edge` is the
// lightest stop in the ramp, so a pinned rim came out lime. Sick sky by a
// different road.
//
// So each side gets the share of the run the arc has room for. A green day
// (near the floor) spends almost all of it upward and gets a green body under
// a blue-violet crown; a magenta day spends it downward into purple. Nothing
// is ever clipped, the full run is always used, and no day is squashed — the
// asymmetry is the arc's shape showing through, which is the point of having
// curated one.
//
// Both options default to a no-op — at spread 0 this is character-for-character
// the old palette, legacy +8 and all — so no existing sky moves by a pixel.
export const palette = (ladderHue, { lMax = 1, spread = 0 } = {}) => {
  const H = arcHue(ladderHue);
  const L = (v) => Math.min(v, lMax);
  // `deep` carries a legacy +8 that predates the spread, and on a hue at the
  // very top of the ladder that pushed it past the arc's end — 2 of 94
  // subjects sat a few degrees into the olive-brown quarter the arc exists to
  // skip. Clamped 2026-09-08. It moves those two tiles very slightly and
  // nothing else: every other subject is far enough from the end that the
  // clamp never fires.
  //
  // The run is placed as a whole and SLID to fit, never clipped: `lo` is where
  // the rim lands once the run has been pushed inside the arc. The body sits a
  // third of the way up it rather than staying pinned at H — pinning it meant
  // that a day near the arc's floor spent its whole run on the crown, and the
  // crown is the faintest ink in the drawing, so the widest spreads of the
  // week were the ones you could not see. Moving the body puts part of the run
  // on the pixels that actually carry the picture. `- 8` reserves the legacy
  // offset on `deep`, so the crown lands inside the arc rather than past it.
  const lo =
    spread === 0
      ? H
      : Math.max(ARC_START, Math.min(H - 0.35 * spread, ARC_END - 8 - spread));
  const at = (f) => (spread === 0 ? H : lo + f * spread);
  return {
    edge: oklch(L(0.9), 0.13, at(0)),
    mid: oklch(L(0.74), 0.15, at(0.35)),
    deep: oklch(L(0.55), 0.11, Math.min(ARC_END, at(1) + 8)),
    glow: oklch(L(0.78), 0.13, at(0.2)),
  };
};

// How wide tonight's aurora runs in hue. Skewed, not uniform: most nights are
// a quiet near-monochrome arc and a few are a wild two-tone, which is both how
// real displays actually behave and the reason the feature is worth having —
// a constant spread would just be a different fixed palette. Keyed off its own
// hash so it is independent of the day's hue; a day can draw a wide spread on
// any colour.
export const DAY_SPREAD_MIN = 6;
export const DAY_SPREAD_MAX = 64;

export const daySpread = (dateStr) => {
  const r = (hashOf(`spread:${dateStr}`) % 100000) / 100000;
  return DAY_SPREAD_MIN + (DAY_SPREAD_MAX - DAY_SPREAD_MIN) * r ** 1.4;
};

const GREY = { edge: "#8d93a8", mid: "#5c6273", deep: "#3a3f4e", glow: "#6a7082" };

// Night base and furniture. Neutral for every subject: identity lives in the
// curtains, the ground stays out of the argument.
const NIGHT = ["#14152e", "#1a1c38", "#202544"];
const NIGHT_DONE = ["#0e0f20", "#111227", "#14162e"];
const STAR = "#eef2ff";
const MOON = "#ecf0fb";
// A favourite's moon, gilded. Only the moon changes: the curtains carry status
// and recency, and recolouring those would overwrite an axis the shelf already
// reads. Since the moon belongs to `completed` alone, an active favourite (a
// replay) has nothing here to gild — the gold frame on the tile is the channel
// that always fires, and this is the flourish on top of it.
const MOON_GOLD = "#f7d789";

// ---------------------------------------------------------------- random

export const hashOf = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
};

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const range = (rand, lo, hi) => lo + rand() * (hi - lo);

// ---------------------------------------------------------------- drawing

const smooth = (pts) => {
  let d = `M${pts[0][0].toFixed(0)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(0)} ${pts[i][1].toFixed(1)} ${mx.toFixed(0)} ${my.toFixed(1)}`;
  }
  return d;
};

// Hermite ease between two edges. Used for the ribbon's upper falloff: a
// plateau then an S-curve to zero gives the envelope a top that is soft but
// still a boundary — a plain power falloff spreads the same ink over the whole
// height and the shape reads as haze instead of a ribbon.
const sstep = (e0, e1, x) => {
  const v = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return v * v * (3 - 2 * v);
};

// A curtain: bright lower edge, vertical rays of jittered heights fading
// upward, brightness pulsing along the length. The per-column jitter is what
// keeps it from ever reading as a banded stripe.
//
// `sway` scales the vertical wander (wave amplitude and end-to-end drift),
// `edgeH` the thickness of the bright edge, `quant` the y grid the edge snaps
// to, and `step` the column width. All four were added for the shelf banner
// strip (retired 2026-09-04 with the rating cells; the reasoning is in the
// design doc's changelog) and stay because the lesson does: that box was
// an eighth the height of the tile these numbers were tuned against: there, an
// unscaled curtain wanders clean out of frame, one snapped to the tile's 3-unit
// grid crosses a single step and lies flat like a rule, and 4-wide columns are
// coarse enough to read as noise.
//
// That last one is aliasing, not taste. The ray-height jitter `n` has a term of
// period ~3.7 units, so sampling it every 4 units is below Nyquist — the tile
// gets away with it because 24 chunky columns over 128px of height IS the pixel
// look, but in a strip a fifth as tall the same aliasing is all you see.
//
// Defaults reproduce the tile exactly, and the rand() call order is fixed
// regardless of any of them, so no existing sky moves by a pixel.
const curtain = (
  rand,
  pal,
  { yMin, yMax, hBase, op, w = 96, sway = 1, edgeH = 7, quant = 3, step = 4 },
) => {
  const y0 = range(rand, yMin, yMax);
  const amp = range(rand, 5, 9) * sway;
  const ph = range(rand, 0, 6.28);
  const f1 = range(rand, 0.55, 0.95);
  const f2 = range(rand, 1.6, 2.6);
  const drift = range(rand, -8, 8) * sway;

  const edge = [];
  let rects = "";
  for (let x = -step; x <= w + step; x += step) {
    const t = x / w;
    const y =
      y0 +
      drift * t +
      amp * Math.sin(ph + t * f1 * 2 * Math.PI) +
      amp * 0.5 * Math.sin(t * f2 * 2 * Math.PI + ph * 1.7);
    const yb = Math.round(y / quant) * quant;
    edge.push([x, y]);
    const n =
      0.5 + 0.5 * Math.sin(x * 1.7 + ph * 3) * Math.sin(x * 0.53 + ph * 5);
    const b = 0.62 + 0.38 * Math.sin(x * 0.9 + ph * 1.3);
    const ray = hBase * (0.9 + 1.5 * n);
    rects +=
      `<rect x='${x}' y='${(yb - ray).toFixed(0)}' width='${step}' height='${(ray * 0.7).toFixed(0)}' fill='${pal.deep}' fill-opacity='${(0.32 * b).toFixed(2)}'/>` +
      `<rect x='${x}' y='${(yb - ray * 0.5).toFixed(0)}' width='${step}' height='${(ray * 0.5).toFixed(0)}' fill='${pal.mid}' fill-opacity='${(0.58 * b).toFixed(2)}'/>` +
      `<rect x='${x}' y='${yb - (edgeH - 2)}' width='${step}' height='${edgeH}' fill='${pal.edge}' fill-opacity='${(0.95 * b).toFixed(2)}'/>`;
  }
  const glow = `<path d='${smooth(edge)}' fill='none' stroke='${pal.glow}' stroke-opacity='0.15' stroke-width='${(hBase * 1.8).toFixed(0)}' stroke-linecap='round' filter='url(#b)'/>`;
  return `<g opacity='${op}'>${glow}${rects}</g>`;
};

const stars = (rand, count, box) =>
  Array.from({ length: count }, () => {
    const x = (rand() * box.w).toFixed(0);
    const y = (rand() * box.h).toFixed(0);
    const r = range(rand, 0.5, 1.1).toFixed(1);
    return `<rect x='${x}' y='${y}' width='${r}' height='${r}' fill='${STAR}' fill-opacity='${range(rand, 0.5, 0.95).toFixed(2)}'/>`;
  }).join("");

const nightBase = (colors, w, h) =>
  `<defs><linearGradient id='n' x1='0' y1='0' x2='0' y2='1'>` +
  `<stop offset='0' stop-color='${colors[0]}'/>` +
  `<stop offset='0.55' stop-color='${colors[1]}'/>` +
  `<stop offset='1' stop-color='${colors[2]}'/></linearGradient>` +
  `<filter id='b' x='-80%' y='-80%' width='260%' height='260%'>` +
  `<feGaussianBlur stdDeviation='9'/></filter></defs>` +
  `<rect width='${w}' height='${h}' fill='url(#n)'/>`;

// preserveAspectRatio='none' lets the fragment stretch lengthen a curtain's
// rays. Completed scenes pass 'xMidYMin slice' instead: uniform scale,
// top-anchored, overflow cropped — the SVG cover-crops itself in any box, so
// the crescent never deforms. (CSS background-size:cover can't do this here:
// Chromium treats pAR='none' SVGs as ratio-less and degrades cover to fill.)
const svgWrap = (w, h, body, pAR = "none") =>
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='${pAR}'>${body}</svg>`;

// ---------------------------------------------------------------- scenes

// Status decides how much aurora is left in the sky; the recency tier decides
// how bright what remains burns. Completed skies trade the aurora for the
// moon: finished, not extinguished.
//
// The completed scene is TALL — 96x320 (3:10), not the 96x128 tile — and it
// cover-crops itself via preserveAspectRatio (see svgWrap) instead of
// stretching. The crescent lives entirely in the top 128 units, so a 3:4 box
// (subject head, shelf) and the shortest fragment all show the whole moon;
// taller fragments reveal more night below it, square pixels throughout.
export const subjectSvg = (slug, ladderHue, status, tier, { canon = false } = {}) => {
  const rand = mulberry32(hashOf(slug));
  const pal = palette(ladderHue);
  const moon = canon ? MOON_GOLD : MOON;
  const W = 96;
  const H = status === "completed" ? 320 : 128;

  let body = nightBase(status === "completed" ? NIGHT_DONE : NIGHT, W, H);
  body += stars(rand, status === "completed" ? 27 : 11, { w: W, h: H });

  if (status === "completed") {
    // Waning crescent: the lit disc with the night-side disc masked out of it.
    // The halo is carved by the same mask so it follows the phase.
    body +=
      `<mask id='m'><circle cx='48' cy='56' r='54' fill='#fff'/>` +
      `<circle cx='63' cy='48' r='28' fill='#000'/></mask>` +
      `<g mask='url(#m)'>` +
      `<circle cx='48' cy='56' r='51' fill='${moon}' fill-opacity='0.16'/>` +
      `<circle cx='48' cy='56' r='30' fill='${moon}'/>` +
      `</g>`;
  } else if (status === "abandoned") {
    body += curtain(rand, GREY, { yMin: 42, yMax: 58, hBase: 14, op: 0.3 });
  } else if (status === "shelved") {
    body += curtain(rand, pal, { yMin: 16, yMax: 24, hBase: 5, op: 0.25 });
    body += curtain(rand, pal, { yMin: 42, yMax: 58, hBase: 10, op: 0.35 });
  } else if (status === "dabbling") {
    // Between active and shelved: two curtains like a dying display, but
    // still tier-scaled — noodling breathes with recency, shelved doesn't.
    body += curtain(rand, pal, { yMin: 16, yMax: 24, hBase: 5, op: 0.3 * tier });
    body += curtain(rand, pal, { yMin: 42, yMax: 58, hBase: 12, op: 0.55 * tier });
  } else {
    body += curtain(rand, pal, { yMin: 16, yMax: 24, hBase: 7, op: 0.4 * tier });
    body += curtain(rand, pal, { yMin: 42, yMax: 58, hBase: 16, op: 0.8 * tier });
    body += curtain(rand, pal, { yMin: 84, yMax: 98, hBase: 11, op: 0.55 * tier });
  }
  return svgWrap(W, H, body, status === "completed" ? "xMidYMin slice" : "none");
};

// The chip: what a sky becomes below ~32px, where three curtains would be
// noise. Night, a curtain's bright edge with a faint body under it, two stars.
//
// Two bands, not one. A single band across a small dark tile reads as a line
// chart — reported by the first outsider to see the site. The fix is not just
// "add another": two PARALLEL bands read as a graph harder than one does. The
// second band is deliberately unlike the first — higher, thinner, dimmer, and
// on a different spatial frequency — so the pair diverges across the tile and
// resolves as depth in a sky rather than two series on an axis. It mirrors the
// faint high curtain of the full scene, so the chip stays a reduction of the
// real thing and not a different picture.
//
// Band count still tracks status: abandoned keeps its single grey ghost (the
// doc's "one curtain, desaturated"), completed keeps none and gets the moon.
export const chipSvg = (slug, ladderHue, status, tier, { canon = false } = {}) => {
  const rand = mulberry32(hashOf(slug));
  const pal = status === "abandoned" ? GREY : palette(ladderHue);
  const moon = canon ? MOON_GOLD : MOON;
  const W = 24;
  const H = 32;
  const op =
    status === "completed" ? 0
    : status === "abandoned" ? 0.5
    : status === "shelved" ? 0.45
    : status === "dabbling" ? 0.65 * Math.max(tier, 0.5)
    : Math.max(tier, 0.5);
  const twoBands = status !== "abandoned" && status !== "completed";

  // Quantised to the 2-unit column grid, same as the full scene's rays.
  const band = ({ y0, ph, freq, amp, bodyH, edgeH, dim }) => {
    let out = "";
    for (let x = 0; x < W; x += 2) {
      const y = Math.round((y0 + amp * Math.sin(ph + (x / W) * freq)) / 2) * 2;
      out +=
        `<rect x='${x}' y='${y - bodyH}' width='2' height='${bodyH}' fill='${pal.mid}' fill-opacity='${(0.55 * dim).toFixed(2)}'/>` +
        `<rect x='${x}' y='${y}' width='2' height='${edgeH}' fill='${pal.edge}' fill-opacity='${(0.95 * dim).toFixed(2)}'/>`;
    }
    return out;
  };

  let body = nightBase(status === "completed" ? NIGHT_DONE : NIGHT, W, H);
  // Main band is drawn from the seed first, so adding the high one below did
  // not move any chip's existing curtain.
  const y0 = range(rand, 12, 18);
  const ph = range(rand, 0, 6.28);
  if (op > 0) {
    const main = band({ y0, ph, freq: 4.5, amp: 2.5, bodyH: 3, edgeH: 2, dim: 1 });
    let high = "";
    if (twoBands) {
      // amp must clear the 2-unit quantisation by enough to produce three
      // steps, not two: at amp 1.6 this band snapped to a near-flat line, and
      // a straight horizontal rule is the single most graph-like mark
      // available. It may clip off the top of the tile, which is what a real
      // curtain running out of frame does anyway.
      high = band({
        y0: range(rand, 4, 7),
        ph: range(rand, 0, 6.28),
        freq: 6.5,
        amp: 2.4,
        bodyH: 2,
        edgeH: 1,
        dim: 0.5,
      });
    }
    body += `<g opacity='${op}'>${high}${main}</g>`;
  }
  if (status === "completed") {
    body += `<circle cx='16' cy='9' r='4' fill='${moon}'/>`;
  }
  body += `<rect x='${(rand() * W).toFixed(0)}' y='${(rand() * 8).toFixed(0)}' width='1' height='1' fill='${STAR}'/>`;
  body += `<rect x='${(rand() * W).toFixed(0)}' y='${(20 + rand() * 10).toFixed(0)}' width='1' height='1' fill='${STAR}'/>`;
  return svgWrap(W, H, body);
};


export const DAY_W = 480;
export const DAY_H = 96;

// The four band forms, and how a date picks one.
//
// ARGUE #7 SAID consecutive post dates land at nearby arc positions because
// the hash has no displacement pass, and that form-by-date would inherit the
// bug. Measured over 365 consecutive days, it does not: hashOf's murmur
// finalizer avalanches, and adjacent-day hue gaps come out p10 14.3 / median
// 85 / p90 163 against a uniform-random expectation of 18 / 90 / 162. There is
// no clustering to displace.
//
// The real problem is plainer and displacement cannot fix it: four forms drawn
// independently collide on 25% of adjacent pairs, because that is what
// independent uniform draws do. Two posts a reader sees together get the same
// form one time in four no matter how good the hash is.
//
// So form is not hashed. It is a permutation of the calendar ordinal: a
// 12-long sequence in which no two adjacent entries are equal (including the
// wrap), each form appearing three times. Adjacent days can never share a
// form, weekly posting cycles cleanly through it too (step 7 is coprime with
// 12), and it stays a pure function of the date — a post written today looks
// the same whenever it is rebuilt, and inserting a post moves nothing else.
// Hue is still hashed and independent, so two posts twelve days apart share a
// form but never a colour.
//
// The degenerate case, stated so it is not a surprise: posting strictly every
// second or every fourth day walks a sub-cycle and sees fewer forms. A daily
// blog does not do that.
const DAY_FORMS = ["ribbon", "drapery", "rays", "fine"];
const FORM_SEQ = [0, 2, 1, 3, 1, 0, 3, 2, 0, 3, 1, 2];

const dayOrdinal = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};

const formAt = (ordinal) => DAY_FORMS[FORM_SEQ[(((ordinal % 12) + 12) % 12)]];

export const dayForm = (dateStr) => formAt(dayOrdinal(dateStr));

// The masthead runs the same menu, one day AHEAD of the band. The masthead is
// keyed on the build date and a same-day post's band on its own, so on
// publication day they already share a hue — give them the same form too and
// that day's page shows the identical weather twice, stacked. One step ahead
// guarantees they differ, because the sequence has no two adjacent entries
// equal. A set rather than a repeat.
export const mastheadForm = (dateStr) => formAt(dayOrdinal(dateStr) + 1);

// One form, drawn onto whatever canvas it is given. The POSTURE — where the
// lit edge rides, how far it sweeps, how thick it gets — belongs to the canvas
// and is passed in; the form only says how to bend that posture. That split is
// what lets the same menu serve a 480x96 static band and a 960x112 animated
// masthead without either one hard-coding the other's numbers.
const formBody = (
  form,
  pal,
  { w, h, base, sweep, thick, thickMax = 1, F = 0, yoff = 0, step = 2, k, ripple = 0 },
) => {
  // `ripple` has to be forwarded explicitly. Everything a form does is
  // expressed by rewriting the options it hands to ribbon(), so any option
  // this signature does not name is silently dropped — which is exactly what
  // happened the first time: the gutter's second rim called ribbon() directly
  // and waved, its main layer came through here and stayed dead straight at
  // every ripple value including 4.
  const C = { w, h, F, yoff, step, ripple, ...(k === undefined ? {} : { k }) };
  // How much of the canvas a form may fill. The forms' thickness multipliers
  // are ratios to each other, not absolutes, and they do not transfer between
  // canvases: `rays` at 1.78x is right on a band that hangs BELOW its heading
  // and floods a masthead that has the wordmark sitting inside it. The canvas
  // states its own ceiling; the form scales underneath it.
  const T = (m) => Math.min(thick * m, thickMax);
  if (form === "drapery")
    // Three envelopes at different phases and heights. The signature is where
    // two lit edges cross — that fold is the one thing a single ribbon cannot
    // draw at any parameter setting, and it costs three times the bytes.
    return (
      ribbon(pal, { ...C, base: base - 0.1, sweep: sweep * 0.72, thick: T(0.7), ph: 4.2, bodyOp: 0.5, edgeOp: 0.6 }) +
      ribbon(pal, { ...C, base: base - 0.01, sweep: sweep * 0.95, thick: T(0.91), ph: 2.1, bodyOp: 0.78, edgeOp: 0.85 }) +
      ribbon(pal, { ...C, base: base + 0.08, sweep: sweep * 0.67, thick: T(0.74), ph: 0, bodyOp: 1 })
    );
  if (form === "rays")
    // A curtain seen face-on: envelope nearly flat and tall, rim stepped back,
    // striations carrying the drawing.
    return ribbon(pal, { ...C, base: base + 0.12, sweep: sweep * 0.43, thick: T(1.78), crestFloor: 0.62, rayBite: 1.75, edgeOp: 0.5 });
  if (form === "fine")
    // The ribbon's posture at half the ray pitch with a hotter rim.
    return ribbon(pal, { ...C, base: base + 0.01, sweep: sweep * 0.67, thick: T(0.83), crestFloor: 0.44, rayScale: 2, rayBite: 1.35, edgeOp: 1.2 });
  return ribbon(pal, { ...C, base, sweep, thick: T(1) });
};

// The day band: the sky the night a post was written. Static, never animated —
// five of these breathing on the home page is the same mistake as thirty
// shimmering shelf cards.
//
// 480 wide and repeated, exactly like the masthead, so pixel density never
// changes with the viewport. The lit edge rides at ~70% of the frame rather
// than the masthead's 66%: the band is anchored to the bottom of a post
// header, so the edge is the horizon under the dateline while the body reaches
// up behind the title. Put it mid-frame and the date lands squarely on the
// brightest pixels on the page, where 12px muted type is unreadable.
export const daySky = (dateStr, h = DAY_H) => {
  const hue = (hashOf(dateStr) % 360000) / 1000;
  const pal = palette(hue, { lMax: 0.82, spread: daySpread(dateStr) });
  const W = DAY_W;
  const H = h;
  const form = dayForm(dateStr);

  const body = formBody(form, pal, { w: W, h: H, base: 0.7, sweep: 0.105, thick: 0.46 });

  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' ` +
    `width='${W}' height='${H}' preserveAspectRatio='none'>` +
    `<defs><filter id='b' x='-60%' y='-60%' width='220%' height='220%'>` +
    `<feGaussianBlur stdDeviation='${(7 * (H / 112)).toFixed(1)}'/></filter>` +
    // A last fade toward the top of the band, on top of the envelope's own
    // falloff. The envelope alone is honest weather; this is the concession to
    // the title sitting in front of it.
    `<linearGradient id='f' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='#9a9a9a'/><stop offset='0.5' stop-color='#fff'/>` +
    `</linearGradient>` +
    `<mask id='m'><rect width='${W}' height='${H}' fill='url(#f)'/></mask></defs>` +
    `<g mask='url(#m)' opacity='0.88'>${body}</g></svg>`
  );
};


// The masthead frame height. The old 16-frame curtain sheet that defined it
// was deleted 2026-09-08 — ribbonSheet draws the masthead now, and the site
// button rasterises the same sampler instead of imitating this file's terms,
// which was the only thing keeping the dead function alive.
export const RIBBON_FH = 112;

// ---------------------------------------------------------------- ribbon

// The ribbon: the forms-library primitive, drawn ENVELOPE FIRST.
//
// `curtain` draws every ray as its own column with its own jagged top, so the
// silhouette of the whole shape IS the ray tips — which is why the masthead
// read as a tree-line instead of a sky for months. Here the shape comes first:
// a smooth periodic lit edge, a thickness that swells and thins along it, and
// rays that are BRIGHTNESS VARIATION INSIDE that envelope. Every column
// reaches the envelope's top, dim or bright, so no column ever cuts the
// outline. That inversion is the whole build.
//
// Periodicity is the Design System rule the approved mock broke: wide monitors
// get more aurora, not fatter aurora. So the ribbon does not fade out at its
// ends — it thins into a STANDING WAVE trough parked on the tile seam. One
// crest per period; a wide screen gets another crest, not a stretched one.
//
// Motion is in-place: brightness pulses as standing waves, and the two
// smallest geometry terms breathe on cos/sin of the frame phase (90° apart, so
// there is always something moving) rather than translating. Nothing marches
// sideways past the wordmark.
const RIBBON_SLICES = 9;

// The lit edge, as a pure function of position along the ribbon. Factored out
// of the column loop because the gutter's shaft mask has to trace this same
// curve to sit under it — and a second copy of the formula is a second copy
// that can drift. Everything the edge depends on is an argument.
const ribbonEdge = (
  t,
  { w, h, base, sweep, ph = 0, k, ripple = 0, F = 0 },
) => {
  const TAU = 2 * Math.PI;
  const th = TAU * F;
  const kk = k === undefined ? h / 112 : k;
  const cyc = (n) => Math.max(1, Math.round((n * w) / 480));
  return (
    base * h +
    (sweep * h * Math.cos(TAU * t + ph) +
      4.5 * kk * Math.sin(TAU * 2 * t + 1.1 + ph) +
      2.4 * kk * Math.sin(TAU * 3 * t + 4.0) * Math.cos(th) +
      1.6 * kk * Math.sin(TAU * 4 * t + 2.2) * Math.sin(th) +
      ripple *
        kk *
        (5 * Math.sin(TAU * cyc(10) * t + 0.7 + ph) +
          2.6 * Math.sin(TAU * cyc(16) * t + 3.4 + ph * 1.6)))
  );
};

// The ribbon, sampled into columns. This is the drawing; `ribbon` below is
// only one way of writing it down.
//
// It exists as its own function because the SITE BUTTON rasterises the same
// aurora directly to pixels — no SVG, no browser — and the previous button
// carried a hand-scaled copy of the header's terms instead. That copy is
// precisely why `headerSheet` could not be deleted for months: two drawings
// that had to agree and no mechanism making them. One sampler, two
// serialisers, and the button cannot drift from the masthead again.
export const ribbonColumns = (
  pal,
  {
    w,
    h,
    F = 0,
    yoff = 0,
    step = 2,
    base = 0.72,
    sweep = 0.13,
    thick = 0.46,
    // Knobs the band forms turn. `ph` slides the crest along the tile (three
    // offset envelopes are what makes a drapery fold); `crestFloor` is how
    // thin the trough gets; `rayBite`, `rayScale` and `edgeOp` trade a solid
    // rim against strong striations, which is the whole difference between a
    // ribbon seen edge-on and a curtain seen face-on.
    ph = 0,
    // Extra high-frequency wander on the lit edge. Every other edge term is
    // low — the smallest has a 120px period — which is right for a canvas
    // hundreds of pixels wide and useless in a 64px window, where a 120px sine
    // is a straight segment. So the gutter's rims came out as rules. These two
    // terms have ~48px and ~30px periods, small enough to show curvature
    // inside the window. Default 0: the masthead's long gentle sweep is the
    // approved look there and must not pick up a wobble.
    ripple = 0,
    crestFloor = 0.34,
    rayBite = 1,
    rayScale = 1,
    edgeOp = 1,
    bodyOp = 1,
    // Drawing scale for the terms that are absolute pixels rather than
    // fractions of the canvas — the edge's wobble, the lit rim's thickness,
    // the glow's radius. It defaults to the canvas height over the masthead
    // frame these numbers were tuned against, which is right for anything
    // masthead-shaped and wrong for anything else: the gutter's canvas is 520
    // tall, so the default would give it a 28px lit rim on a 64px-wide strip.
    // A canvas that is not a wide band passes its own.
    k = h / 112,
    slices = RIBBON_SLICES,
  },
) => {
  const TAU = 2 * Math.PI;
  const th = TAU * F;
  const SL = slices;

  // Two classes of frequency, and they must not be confused.
  //
  // The ENVELOPE terms (crest, sweep) are stated in cycles per period: one
  // crest per tile is the whole point of the standing wave, so a longer tile
  // means a longer ribbon, not more of them. The TEXTURE terms — rays, fray —
  // are a pixel scale, not a proportion: left in cycles per period they would
  // be three times fatter on a 1440 tile than a 480 one, and the drawing would
  // stop looking like the same weather at different widths. `cyc` restates a
  // texture frequency tuned at 480 as the integer cycle count that holds its
  // pixel size at this period; integer, so the tile still repeats seamlessly.
  const cyc = (n) => Math.max(1, Math.round((n * w) / 480));

  const cols = [];
  const edge = [];
  for (let x = 0; x <= w; x += step) {
    const t = x / w;

    // The standing wave: one crest per period, its trough on the seam.
    const crest = 0.5 - 0.5 * Math.cos(TAU * t + ph);

    const yEdge = ribbonEdge(t, { w, h, base, sweep, ph, k, ripple, F });

    // Thickness: the envelope. Never zero — a ribbon thins, it does not stop.
    const breath = 1 + 0.1 * Math.sin(TAU * 2 * t + 0.9) * Math.sin(th + 1.1);
    // Fray: a gentle wobble on the thickness so the far edge is not glassy.
    // Two low, separated sines ADDED — not multiplied. A product of two sines
    // carries a sum-frequency component, and the first cut of this (0.12 ×
    // sin13 × sin19) put one at a 15px pitch: a regular comb along the top of
    // the ribbon, which is the tree-line again at a twentieth of the scale.
    // Added terms have only the frequencies you wrote down.
    const fray =
      1 + 0.07 * Math.sin(TAU * cyc(5) * t + 2.3) + 0.04 * Math.sin(TAU * cyc(9) * t + 5.1);
    const T = thick * h * (crestFloor + (1 - crestFloor) * crest) * breath * fray;

    // Rays. Floored so the dimmest column still fills the envelope to its top;
    // this is the line between a ribbon and a tree-line.
    const rayN =
      0.5 +
      0.5 *
        Math.sin(TAU * cyc(23 * rayScale) * t + 1.9 + 0.3 * Math.cos(th)) *
        Math.sin(TAU * cyc(37 * rayScale) * t + 0.4);
    const fine = 0.5 + 0.5 * Math.sin(TAU * cyc(61 * rayScale) * t + 3.1);
    const ray = 0.38 + 0.32 * rayN + 0.3 * fine;

    const pulse =
      0.55 * Math.sin(TAU * cyc(3) * t + 1.1) * Math.sin(th + 0.7) +
      0.35 * Math.sin(TAU * cyc(7) * t + 4.2) * Math.sin(2 * th + 2.9);
    const B = (0.38 + 0.62 * crest) * (0.72 + 0.28 * pulse);

    const yb = Math.round(yEdge / 2) * 2;
    edge.push([x, yEdge]);

    // Body, lit edge upward. Boundaries are rounded once and chained, so the
    // slices tile exactly — no seams, no double-painted overlaps — and the
    // opacity ramp reaches zero at the envelope's top, which is what makes
    // that top a fade rather than a step.
    //
    // Interior boundaries are dithered by up to two thirds of a slice.
    // Undithered, neighbouring columns put their boundaries at the same y — T
    // varies smoothly, that is the point — and the ladder resolves into
    // horizontal stripes across the whole ribbon: the failure mode this build
    // exists to avoid, arriving from the other direction. The dither is driven
    // by `fine`, the 8px ray term, and TAPERS TO NOTHING at the envelope's
    // top. Pinning only the last boundary was not enough: the top slice is
    // faint enough that the gate drops it, so the visible top edge was the
    // boundary below — dithered, at the ray pitch, which drew a 3px comb along
    // the whole far edge.
    const jit = (0.5 - fine) * 0.66;
    const parts = [];
    let prev = yb;
    for (let i = 1; i <= SL; i += 1) {
      const yTop = Math.round(yb - (T * (i + jit * (1 - i / SL))) / SL);
      const u = (i - 0.5) / SL;
      const a = 1 - sstep(0.3, 1, u);
      // Rays cut deeper the higher they go. A real ribbon's lit edge is a
      // solid rim — the striations only open up in the body above it — and
      // rays that bite at the rim erode the one hard line in the drawing.
      const rm = 1 - Math.min(0.95, (0.15 + 0.85 * u) * rayBite) * (1 - ray);
      const fill = u < 0.14 ? pal.edge : u < 0.62 ? pal.mid : pal.deep;
      const bo = u < 0.14 ? 0.9 : u < 0.62 ? 0.7 : 0.46;
      // `gate` is the slice's opacity WITHOUT the ray term. Dropping a slice
      // is a geometry decision — an absent slice is a shorter column — so it
      // must not depend on ray brightness, or the rays quietly become the
      // silhouette again through the back door.
      const gate = bo * a * B * bodyOp;
      const ht = prev - yTop;
      if (gate >= 0.025 && ht >= 1)
        parts.push({ fill, op: bo * a * rm * B * bodyOp, y: yTop, h: ht });
      prev = yTop;
    }

    // The one hard line in the drawing.
    const eo = Math.min(0.95, 1.15 * B * (0.72 + 0.28 * ray) * edgeOp);
    const eh = Math.round(6 * k);
    if (eh >= 1) parts.push({ fill: pal.edge, op: eo, y: Math.round(yb - 2 * k), h: eh });

    cols.push({ x, parts });
  }

  return { cols, edge, step, glowW: 34 * k };
};

// The SVG serialisation of the above.
export const ribbon = (pal, opts) => {
  const { yoff = 0 } = opts;
  const { cols, edge, step, glowW } = ribbonColumns(pal, opts);

  // Slices are grouped into one <path> per (fill, rounded opacity) pair, and
  // within a path each is a RELATIVE subpath continuing from the last vertex
  // of the one before, with the closing `z` left off (fill closes a subpath by
  // itself). It reads worse than a list of <rect>s and it is the difference
  // between a masthead that fits in a cache and one that does not.
  const buckets = new Map();
  for (const { x, parts } of cols)
    for (const { fill, op, y, h: ht } of parts) {
      const key = `${fill}|${op.toFixed(2)}`;
      const Y = y + yoff;
      const b = buckets.get(key);
      if (!b) buckets.set(key, { d: `M${x} ${Y}h${step}v${ht}h-${step}`, x, y: Y + ht });
      else {
        b.d += `m${x - b.x} ${Y - b.y}h${step}v${ht}h-${step}`;
        b.x = x;
        b.y = Y + ht;
      }
    }

  const d =
    `M${edge[0][0]} ${(edge[0][1] + yoff).toFixed(1)}` +
    edge.slice(1).map(([px, py]) => ` L${px} ${(py + yoff).toFixed(1)}`).join("");
  const glow =
    `<path d='${d}' fill='none' stroke='${pal.glow}' stroke-opacity='0.1' ` +
    `stroke-width='${glowW.toFixed(0)}' stroke-linecap='round' filter='url(#b)'/>`;

  const paths = [...buckets]
    .map(([key, b]) => {
      const [fill, op] = key.split("|");
      return `<path fill='${fill}' fill-opacity='${op}' d='${b.d}'/>`;
    })
    .join("");

  return glow + paths;
};

// The ribbon as the masthead's sprite sheet. Frame height and mechanism are
// the old curtain's (112px frames, background-position stepped by CSS); the
// tile width and frame count are not, and both numbers were argued for:
//
// 960 tile — one crest per tile, so the period is how far apart the bright
// bulges sit. At 480 a 1280 laptop shows nearly three of them and the masthead
// reads as a row of mounds; at 1440 a 1280 laptop shows less than one, and the
// left third of the header is the thin trough. 960 puts a crest under the nav
// at 1280 and two across 1920.
//
// 8 frames — the sheet's weight is frames x columns x slices, and this is the
// cheapest of the three to spend. Measured over the ribbon band, halving 16 to
// 8 grows the per-step change only from 2.0% to 2.9% RMSE: the motion is
// in-place breathing rather than travel (argue #2), so there is very little
// between-frame distance to lose. What changes is dwell — each state holds
// 1.4s instead of 0.7s — which on an aurora is the right direction anyway.
//
// CSS MUST AGREE: `background-size: 960px 896px`, `steps(8)`, and the keyframe
// to `0 -896px`. The frame window has to match FH exactly or frames bleed.
export const RIBBON_W = 960;
export const RIBBON_FRAMES = 8;

export const ribbonSheet = (
  dateStr,
  { period = RIBBON_W, lMax = 0.8, frames: NF = RIBBON_FRAMES, form, step = 2 } = {},
) => {
  const hue = (hashOf(dateStr) % 360000) / 1000;
  const pal = palette(hue, { lMax, spread: daySpread(dateStr) });
  const F0 = form ?? mastheadForm(dateStr);
  const W = period;
  const FH = RIBBON_FH;
  const N = NF;

  let frames = "";
  let clips = "";
  for (let k = 0; k < N; k += 1) {
    const F = k / N;
    const yoff = k * FH;
    const ebb = 1 + 0.08 * Math.sin(2 * Math.PI * F + 1.9);
    clips += `<clipPath id='f${k}'><rect x='0' y='${yoff}' width='${W}' height='${FH}'/></clipPath>`;
    // A top fade per frame, the same concession the band makes: the wordmark
    // and nav sit in the top half of this canvas. The gradient is
    // objectBoundingBox, so pointing it at a rect covering just this frame
    // scales it to the frame — one gradient over the stacked sheet would fade
    // frame 15 to nothing and leave frame 0 untouched.
    clips += `<mask id='k${k}'><rect x='0' y='${yoff}' width='${W}' height='${FH}' fill='url(#g)'/></mask>`;
    frames +=
      `<g clip-path='url(#f${k})' mask='url(#k${k})' opacity='${(0.66 * ebb).toFixed(3)}'>` +
      formBody(F0, pal, { w: W, h: FH, F, yoff, step, base: 0.72, sweep: 0.13, thick: 0.46, thickMax: 0.58 }) +
      `</g>`;
  }

  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${FH * N}' ` +
    `width='${W}' height='${FH * N}' preserveAspectRatio='none'>` +
    `<defs><filter id='b' x='-60%' y='-60%' width='220%' height='220%'>` +
    `<feGaussianBlur stdDeviation='7'/></filter>` +
    `<linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='#8f8f8f'/><stop offset='0.45' stop-color='#fff'/>` +
    `</linearGradient>${clips}</defs>${frames}</svg>`
  );
};
