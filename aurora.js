// The aurora engine. Design rationale: vault, 90_Reference/91_Documentation/
// "chaosh.at Design System". Everything here is deterministic: a subject's sky
// is a pure function of (slug, status, recency tier), and the header's of the
// build date — same inputs, byte-identical SVG, forever.

// ---------------------------------------------------------------- color

// OKLCH -> sRGB hex at build time, so the SVGs carry plain hex and owe the
// browser nothing. Perceptual lightness is what lets one value ramp hold at
// every hue on the arc.
// Linear sRGB, unclamped. Split out so the pixel ramp can see when a colour
// leaves the gamut, which the clamped hex below hides.
const oklchLin = (L, C, Hdeg) => {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const oklch = (L, C, Hdeg) => {
  const lin = oklchLin(L, C, Hdeg);
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

// Where along the day's hue run a fraction f lands (0 = rim, 1 = crown), the
// run slid inside the arc as palette() explains below. Its own function so
// dayFrame can ask for the body hue without restating the slide.
const runHue = (H, spread) => {
  const lo =
    spread === 0
      ? H
      : Math.max(ARC_START, Math.min(H - 0.35 * spread, ARC_END - 8 - spread));
  return (f) => (spread === 0 ? H : lo + f * spread);
};

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
  const at = runHue(H, spread);
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

// The chrome frame (2026-10-16, the hi-bit redesign): panels, cards, covers,
// asides and figures are drawn in the day's aurora hue, so on a green day the
// frames are green and on a violet day violet. It bends "the chrome stays out
// of the argument" only by borrowing the masthead's colour, never by adding
// one — so the hue is the masthead's BODY hue (the same 0.35 of the run that
// palette() paints `mid` with), keyed on the same build date. Fixed
// lightness and low chroma, so every day's frame sits at the same weight
// against the night and only the hue moves. One colour, not three: the inset
// line and the panel ground are mixes of it into the night, done in CSS
// (--dim, --fill), because a dark stop computed here in OKLCH clips — a green
// day's ground came out #001307, which is green, not night.
export const dayFrame = (dateStr) =>
  oklch(0.8, 0.1, runHue(arcHue((hashOf(dateStr) % 360000) / 1000), daySpread(dateStr))(0.35));

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
  } else if (status === "incomplete") {
    body += curtain(rand, GREY, { yMin: 42, yMax: 58, hBase: 14, op: 0.3 });
  } else if (status === "shelved") {
    body += curtain(rand, pal, { yMin: 16, yMax: 24, hBase: 5, op: 0.25 });
    body += curtain(rand, pal, { yMin: 42, yMax: 58, hBase: 10, op: 0.35 });
  } else if (status === "owned") {
    // Owned board games: a steady two-curtain sky between active and
    // shelved. Not tier-scaled — a board game isn't written about on a
    // cadence, so recency would only ever read as fading. (Took over the
    // dabbling branch 2026-10-13.)
    body += curtain(rand, pal, { yMin: 16, yMax: 24, hBase: 5, op: 0.3 });
    body += curtain(rand, pal, { yMin: 42, yMax: 58, hBase: 12, op: 0.55 });
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
// Band count still tracks status: incomplete keeps its single grey ghost (the
// doc's "one curtain, desaturated"), completed keeps none and gets the moon.
export const chipSvg = (slug, ladderHue, status, tier, { canon = false } = {}) => {
  const rand = mulberry32(hashOf(slug));
  const pal = status === "incomplete" ? GREY : palette(ladderHue);
  const moon = canon ? MOON_GOLD : MOON;
  const W = 24;
  const H = 32;
  const op =
    status === "completed" ? 0
    : status === "incomplete" ? 0.5
    : status === "shelved" ? 0.45
    : status === "owned" ? 0.65
    : Math.max(tier, 0.5);
  const twoBands = status !== "incomplete" && status !== "completed";

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

// ---------------------------------------------------------------- pixel sheet

// The masthead as true pixel art (2026-10-19, vault: "chaosh.at Decisions" →
// "the aurora goes true pixel art"). Everything above draws at screen
// resolution — chunky rects under a feGaussianBlur glow — and blocks beside
// blur at another scale is a MIXED GRID, the tell that kept the masthead from
// ever reading as pixel art. So this draws at the real resolution, 192×48,
// with a fixed seven-colour ramp, no alpha but on/off, and every glow and fade
// done by dither; CSS scales it ×5 with `image-rendering: pixelated`. The
// ladder, the spread and the determinism are unchanged: only the rendering is
// new.
//
// ×5 since 2026-10-21 (it was ×4 at 240×60). The tile is still 960px and the
// band still 240px, so the CSS sizes did not move; only the pixel did. Ray
// periods are restated per tile (round(n × W / 240)) so a ray is as many ART
// pixels wide as it was, and the light sheet's sigmas scale by 4/5 so the glow
// keeps its on-screen size. The curtains keep their proportions: they are
// fractions of H.
//
// 48 rows, not the old band's 28: at 28 the curtains squashed into parallel
// stripes. 44 (176px) fixed that; 60 rows at ×4 (240px, 2026-10-19) gave the
// curtains room to stand apart from the nav, and 48 at ×5 is the same 240px.
// The band runs down into the top of the page and the furniture boxes sit over
// it in smoked glass (style.css) — the content was deliberately NOT pushed
// down to clear it.
// Curtain posture is in fractions of H, so the forms scale with the rows.
//
// Ported from the vault's silhouette lab (99_Admin/attachments/
// chaosh-aurora-silhouette-lab.html), where the numbers were tuned at 320×96.
// Three changes for the masthead: every horizontal period divides the tile it
// lives in, so the tile repeats; motion runs on the frame phase, so the frames
// loop; and the vertical numbers are restated for the masthead's rows.
//
// TWO tiles, not one (2026-10-21). One 960px tile showed two identical copies
// side by side on a 1920px screen. The curtains are now separate sheets — the
// front 192 art px wide (960 on screen), the back 288 (1440) — stacked as two
// backgrounds on one pseudo-element, so the pair only repeats every 2880px.
// See pixelLayers.
export const PIXEL_W = 192;
export const PIXEL_BACK_W = 288;
export const PIXEL_FH = 48;
export const PIXEL_SCALE = 5;
const TAU = 2 * Math.PI;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
// Integer hash for per-pixel and per-column decisions; the date's own hash
// is folded into the seeds, so each day gets its own rays and stars.
const ihash = (n) => {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
};
const tri = (v) => 1 - Math.abs((v - Math.floor(v)) * 2 - 1);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixRgb = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));

// The lit edge yb(x) and the thickness T(x): envelope first, as in `ribbon`.
// `th` is the loop phase, 0..2π over the sheet, so every moving term returns
// to where it started on frame 0.
const pxGeom = (c, x, th, W) => {
  const s = x / W;
  const yb =
    c.base +
    c.sweep * Math.cos(TAU * s + c.ph) +
    c.wob * Math.sin(TAU * 3 * s + 1.1 + c.ph) +
    0.4 * c.wob * Math.sin(TAU * 5 * s + 4 + th);
  const crest = 0.5 - 0.5 * Math.cos(TAU * s + c.ph);
  const T = c.thick * (0.4 + 0.6 * crest) * (1 + 0.08 * Math.sin(TAU * 4 * s + 2.3 + th));
  return { yb, T, crest };
};

// The ray profile, 0..1: two triangle waves sharpened by the 1.6 power, which
// is what makes the nested chevrons. Periods are whole divisors of the tile
// (c.n1, c.n2 cycles per tile). The waves BREATHE in place rather than
// drifting — nothing marches sideways past the wordmark (2026-09-08) — and a
// per-column flicker takes one of eight states, offset per column, so it
// loops with the sheet.
const pxSpike = (c, x, k, th, W) => {
  const flick = ihash(((x * 7919) ^ (((k + Math.floor(ihash(x + c.seed) * 8)) % 8) * 104729)) + c.seed);
  return (
    0.6 * tri((c.n1 * x) / W + c.ph + 0.18 * Math.sin(th)) +
    0.3 * tri((c.n2 * x) / W + c.ph * 2 - 0.12 * Math.sin(th + 1.3)) +
    0.1 * flick
  ) ** 1.6;
};

// The dithered glow under the lit edge.
const pxUnder = (d) => (d < 1 ? 0.62 : Math.max(0, 0.3 - (d - 1) * 0.15));

// Clustered rays for form 7: a few groups per tile, 3–6 rays each, 1–2px wide.
//
// They used to be vertical lines of one width from the rim to the top of the
// frame, which read as scanlines (2026-10-21). Now each ray
//   · leans: a cluster shares one direction and one slope, 1px per 5–7 rows,
//     so a cluster fans instead of marching in step;
//   · tapers: a 2px ray gives up its second column at 45% of its length, and
//     past 50% the ray thins to a dither of short strokes, so the tip comes
//     apart the way the curtain's top does instead of ending on a row;
//   · stops short: a ray is never longer than the room between its own rim and
//     the curtain behind's (`c.capAt`), so a front ray ends under the back
//     curtain's lit rim rather than drawing across it.
//
// The rays are listed once per curtain (a ray is a few numbers) and looked up
// per pixel. `th` is gone: geometry is frozen (see PX_WAVE), so the breathing
// the rays once did is baked in at its th = 0 value.
const pxRays = (c, W) => {
  if (c.rays && c.rays.W === W) return c.rays.list;
  const CELL = c.cell ?? 48; // a divisor of the tile width
  const list = [];
  for (let cell = 0; cell * CELL < W; cell += 1) {
    if (ihash(cell * 7717 + c.seed) < 0.3) continue;
    const start = cell * CELL + Math.floor(ihash(cell * 313 + c.seed) * 18);
    const n = 3 + Math.floor(ihash(cell * 59 + c.seed) * 4);
    const dir = ihash(cell * 191 + c.seed) < 0.5 ? -1 : 1;
    const m = 5 + Math.floor(ihash(cell * 83 + c.seed) * 3); // rows per 1px of lean
    for (let i = 0; i < n; i += 1) {
      const x0 = start + i * 3 + Math.floor(ihash(cell * 17 + i + c.seed) * 2);
      const w = ihash(cell * 23 + i * 7 + c.seed) > 0.6 ? 2 : 1;
      const { yb, T } = pxGeom(c, x0 % W, 0, W);
      const ext = (0.25 + 0.55 * ihash(cell * 41 + i * 13 + c.seed)) * (0.85 + 0.15 * Math.sin(cell * 1.7 + i));
      // A ray ends inside the frame, so its taper happens where it can be
      // seen: never past 85% of the way to the top edge. And two rows of air
      // under the curtain behind's rim.
      const len = Math.min(T * (1 + ext), yb * 0.85, c.capAt ? yb - c.capAt(x0 % W) - 2 : Infinity);
      if (len >= 3) list.push({ x0, w, dir, m, yb, len });
    }
  }
  c.rays = { W, list };
  return list;
};

// The ray's intensity at (x, y), 0 where there is none.
const pxRayAt = (c, x, y, W) => {
  let best = 0;
  for (const r of pxRays(c, W)) {
    const d = r.yb - y;
    if (d < 0 || d >= r.len) continue;
    const t = d / r.len;
    // The ray's column at this height, measured from where it left the rim.
    const dx = (((x - (r.x0 + r.dir * Math.floor(d / r.m))) % W) + W) % W;
    if (dx >= r.w || (dx === 1 && t > 0.45)) continue;
    if (t > 0.5 && ihash(x * 5231 + Math.floor((y + (x % 3)) / 2) * 7919 + c.seed) > 1 - sstep(0.5, 1, t)) continue;
    best = Math.max(best, (1 - t) ** 1.1 * 0.78);
  }
  return best;
};

// The three masthead forms, each an intensity 0..1 at (x, y).
const dissolve = (c, x, y, k, th, W) => {
  const { yb, T, crest } = pxGeom(c, x, th, W);
  const d = yb - y;
  if (d < 0) return pxUnder(-d);
  if (d > T) return 0;
  const u = d / T;
  if (u < 0.07) return 1;
  const ray = 0.55 + 0.45 * pxSpike(c, x, k, th, W);
  return (1 - u) ** 1.4 * (0.45 + 0.55 * ray * (1 - 0.6 * u)) * (0.75 + 0.25 * crest);
};
const PIXEL_FORMS = {
  // 8 · short envelope, flames above: the dim fill reaches ~40% up, the flames
  // climb past it and thin out, so the outline is never a fence.
  shortflame: (c, x, y, k, th, W) => {
    const { yb, T } = pxGeom(c, x, th, W);
    const d = yb - y;
    if (d < 0) return pxUnder(-d);
    const env = T * (c.env ?? 0.42);
    const r = T * (0.45 + 0.85 * pxSpike(c, x, k, th, W));
    if (d > Math.max(env, r)) return 0;
    if (d / T < 0.06) return 1;
    let flame = d <= r ? (1 - d / r) ** 1.05 * 0.93 : 0;
    if (d > env) flame *= 0.72;
    const floor = d <= env ? 0.196 * (1 - sstep(0.75, 1, d / env)) : 0;
    return Math.max(flame, floor);
  },
  // 7 · rayed arc: the dissolving envelope, plus clustered rays rising out of
  // the body and fading on the same profile, only longer.
  rayed: (c, x, y, k, th, W) => Math.max(dissolve(c, x, y, k, th, W), pxRayAt(c, x, y, W)),
  // 3 · dissolving top: rays are brightness only, the top fades through dither.
  dissolve,
};
export const PIXEL_FORM_NAMES = Object.keys(PIXEL_FORMS);

// The post bands cycle the three forms by calendar day, so two posts seen
// together never match — the rule the SVG bands already kept (see DAY_FORMS).
// With three forms a plain cycle is enough: adjacent days always differ.
export const pixelBandForm = (dateStr) => PIXEL_FORM_NAMES[(((dayOrdinal(dateStr) % 3) + 3) % 3)];

// The masthead is picked by a hash of the date, repeats allowed (Hat: "could
// just be random") — but from the two forms TODAY'S BAND is not using. The
// masthead and a same-day post share the day's hue, so the same form too
// would show the identical weather twice, stacked. The SVG masthead ran one
// step ahead of the band's sequence for the same reason.
export const pixelForm = (dateStr) => {
  const rest = PIXEL_FORM_NAMES.filter((f) => f !== pixelBandForm(dateStr));
  return rest[hashOf(`pxform:${dateStr}`) % rest.length];
};

// The pixel ramp (2026-10-21). The first port borrowed palette()'s inks, which
// were tuned for SVG under a blur, and in pixels they spaced badly: `mid`,
// `glow` and `edge` sat within 0.10 of each other in lightness while the steps
// below them jumped 0.13 and 0.19, so the bright core was mush and the fade
// under it lurched. Here the five inks are spaced EVENLY in lightness, chroma
// peaks in the body and falls off both ways (a pale rim and a dim crown both
// read as more saturated than they are next to a strong middle), and the hue
// still runs rim → body → crown along the day's spread, slid inside the arc by
// runHue exactly as palette() does. The spread gets a floor: most nights draw a
// near-monochrome spread, and a ramp that is one hue at five lightnesses is
// the flat, unshifted ramp hand-drawn pixel art avoids. 24° is the smallest
// swing that still shows as two hues at ×4 (not re-measured at ×5).
//
// An eighth ink, `hot`, sits one small step above the rim: a 1px core on the
// brightest crests only. It started near-white, standing in for the glow the
// old bloom gave, and once the light layer arrived (pixelLightSheet) that was
// glow twice over. Now the light pass does the glowing and the core is only
// the accent that marks where it comes from — the emitter, not the light.
//
// Ramp layout, by index: 0–1 the night (never drawn — bare sky is
// transparent), 2–6 the inks dusk → edge, 7 hot.
const PX_SWING_MIN = 24;
const PX_INKS = [
  // [position on the rim → crown run, share of peak chroma]
  // The two low inks stay quiet in chroma as well as lightness: faded
  // statuses (shelved, owned, incomplete, low recency) live almost entirely
  // on them, and a saturated low step made a shelved sky louder than an
  // active one's body.
  [1, 0.38], // dusk: the crown's hue, the faint top of a curtain
  [0.7, 0.66], // deep
  [0.4, 1], // mid: chroma peaks in the body
  [0.18, 0.85], // glow
  [0, 0.6], // edge: the rim, pale but still coloured
];

// Chroma is pulled in until the colour is inside sRGB rather than clamped per
// channel, which would bend the hue — the same sick-sky failure the arc
// exists to avoid, arriving through the gamut instead.
const inGamut = (L, C, H) => oklchLin(L, C, H).every((v) => v >= -0.0005 && v <= 1.0005);
const pxInk = (L, C, H) => {
  let c = C;
  while (c > 0 && !inGamut(L, c, H)) c -= 0.004;
  return hexRgb(oklch(L, Math.max(0, c), H));
};

// SNES colour: 5 bits a channel, expanded back the way the hardware's DAC
// does. Only the strict-16-bit style option uses it.
const snes5 = (rgb) => rgb.map((v) => ((v >> 3) << 3) | (v >> 6));

export const pxPalette = (
  ladderHue,
  { lMin = 0.4, lMax = 0.85, spread = 0, cPeak = 0.17, grey = false, snes = false } = {},
) => {
  // Incomplete keeps its grey ghost: a cool near-neutral with no hue run.
  const at = grey ? () => 268 : runHue(arcHue(ladderHue), Math.max(spread, PX_SWING_MIN));
  const cp = grey ? 0.025 : cPeak;
  const n = PX_INKS.length - 1;
  const inks = PX_INKS.map(([f, share], i) => pxInk(lMin + (i * (lMax - lMin)) / n, cp * share, at(f)));
  const hot = pxInk(Math.min(0.93, lMax + 0.05), grey ? 0.008 : 0.05, at(0));
  const ramp = [hexRgb(NIGHT[0]), hexRgb(NIGHT[2]), ...inks, hot];
  return snes ? ramp.map(snes5) : ramp;
};

// How a frame is animated (2026-10-21). The first port moved the GEOMETRY —
// the edge wobbled, the rays breathed, each column flickered through eight
// states — so every frame redrew most of the curtain and a step flipped 15–34%
// of the lit pixels at once: at a 1.4s hold that read as a slideshow. Now the
// shape is frozen and only brightness moves, as a slow wave travelling UP the
// rays (a real aurora's pulsing does this). Quantised to the ramp, a small
// wave only tips the pixels already near a step boundary, so each frame
// changes a few percent of the curtain: the 16-bit palette-cycling trick,
// computed instead of hand-indexed.
//
// One cycle per loop keeps it seamless; `λ` is in art rows, so the wave
// climbs λ rows per loop. Each column carries its own phase, keyed to its ray
// so a ray pulses as one piece and its neighbour out of step.
const PX_WAVE = { amp: 0.3, lambda: 18 };

// What replaces full-field Bayer (2026-10-21). Bayer shaded every shallow
// gradient with the same 4×4 crosshatch, and a fixed screen-aligned pattern is
// the texture of 90s PC graphics, not of drawn pixel art. Hand-shaded art puts
// its transitions in CLUSTERS, broken along the form. So each column samples
// its curtain a few rows lower where its ray is bright and higher where it is
// dim: the brighter inks are carried up the rays, and every step boundary
// becomes teeth that follow the rays rather than a line that follows the rim.
//
// It is a shift in ROWS, not a nudge to the quantiser's threshold. The first
// cut nudged the threshold, and where the gradient is shallow — the whole
// upper body — a fraction of a step moved the boundary a dozen rows: flat
// topped bars, a city skyline, the equaliser look rejected on 2026-10-05.
// Rows bound it: a tooth is `PX_TOOTH` rows plus `PX_FAN` of a row per row of
// depth, whatever the slope. The shift fades in over `PX_RAMP` rows above the
// rim so the lit edge is not cut.
//
// The fan is the second pass at this (2026-10-21). With a tooth of constant
// height every step in a column slid up or down together, so the steps stayed
// parallel to one another and to the rim — contour banding, worst on the two
// forms whose body is a smooth fade, `rayed` and `dissolve`. Growing the shift
// with depth makes the steps of one column spread apart where its ray is
// bright and crowd together where it is dim, so each boundary has a different
// profile: they cut across the contour and across each other. Measured as the
// roughness of a step's depth around its own 15-column average, `dissolve`
// went from 1.9/2.1/1.7/1.3 rows (steps top to bottom) to 2.1/2.6/2.6/2.6.
//
// Bayer survives as a sliver — `PX_SEAM` is a fifth of a step — so a
// boundary still gets a one-pixel stipple where it runs flat.
//
// `shortflame` keeps the first pass's numbers: its body is already flames, it
// already measures rougher (3.0/3.8/4.4/3.8 against the others' 2.1/2.6/2.6/
// 2.6), and the fan only broke its dim back curtain into blotches.
// [rows of tooth, rows of fan per row of depth, rows to ramp in over]
const PX_TEETH = { shortflame: [4, 0, 6], rayed: [3, 0.4, 3], dissolve: [3, 0.4, 3] };
const PX_SEAM = 0.45;
const PX_STROKE = 3;

// Render one frame of `form` into `px` (RGBA) at row offset `oy`.
// A curtain may carry four flags for the layered masthead (pixelLayers), where
// each sheet holds ONE curtain. `front: false` keeps a lone back curtain from
// getting the front's hot core. `emit` is the strength its rim casts into the
// light sheet (default: 1 for the front curtain, 0 for any other) and
// `emitFrom` the lowest ramp step that casts (6, the rim, unless the curtain
// is too dim to reach it). `floor` drops pixels fainter than it, so the front
// sheet is opaque only where the single-sheet painter's order would have let
// it cover the back.
// `starP` is the share of bare sky that gets a star.
const pxFrame = (px, { W, H, oy, k, N, form, cs, ramps, fade, seed, stars = true, starP = 0.008, dither = true, emit = null }) => {
  const th = (TAU * k) / N;
  const fn = PIXEL_FORMS[form];
  const [tooth, fan, lead] = PX_TEETH[form];
  const star = hexRgb(STAR);
  const live = N > 1;
  // Per curtain, per column: the frozen edge, the crest, the ray, and the
  // column's wave phase. The forms below are called at k = 0, th = 0 for the
  // same reason: geometry does not move.
  const col = cs.map((c) =>
    Array.from({ length: W }, (_, x) => {
      const { yb, crest } = pxGeom(c, x, 0, W);
      const ray = pxSpike(c, x, 0, 0, W);
      return { yb, crest, ray, ph: TAU * (0.7 * ray + 0.3 * ihash((x >> 2) * 977 + c.seed)) };
    }),
  );
  const isFront = (i) => cs[i].front ?? i === cs.length - 1;
  for (let y = 0; y < H; y += 1) {
    // The wordmark and nav sit in the top half: light thins toward the top,
    // the pixel version of the old gradient mask. It scales intensity BEFORE
    // quantising, so the dimming lands as darker ramp steps, never as alpha.
    const m = fade[0] + (1 - fade[0]) * sstep(0, fade[1], y / H);
    for (let x = 0; x < W; x += 1) {
      // Painter's order, back to front: a curtain covers what is behind it
      // wherever it is visibly there (≥ 0.16); behind its dissolving top, the
      // brighter one shows. Max-blend everywhere made the back curtain's rim
      // weave over and under the front one.
      let best = 0;
      let who = 0;
      for (let i = 0; i < cs.length; i += 1) {
        const cc = col[i][x];
        const d = cc.yb - y;
        const shift = d > 0 ? (cc.ray - 0.4) * (tooth + fan * d) * Math.min(1, d / lead) : 0;
        let I = fn(cs[i], x, y + shift, 0, 0, W) * cs[i].gain * m;
        // The wave rides above the rim only, ramping in over three rows, so
        // the one hard line in the drawing stays still.
        // Weighted by the ray: a pulse runs up the bright rays and leaves the
        // gaps alone. Spread evenly, the same wave only tipped boundary pixels
        // chosen by the stipple — a scatter of single pixels, fizz rather
        // than anything travelling.
        if (live && I > 0 && d > 0)
          I *= 1 + PX_WAVE.amp * cc.ray * Math.min(1, d / 3) * Math.sin((TAU * d) / PX_WAVE.lambda - th + cc.ph);
        if (I >= 0.16 || I > best) {
          best = I;
          who = i;
        }
      }
      const cw = col[who][x];
      if (best < (cs[who].floor ?? 0)) best = 0;
      // The stipple: a short vertical stroke, not a grid cell. Held over
      // `PX_STROKE` rows and staggered per column, so where a boundary runs
      // flat it breaks into ragged strokes along the rays instead of a
      // checkerboard — and a bar's flat top becomes a jagged one.
      const sy = Math.floor((y + ((x * 5) % PX_STROKE)) / PX_STROKE);
      const val = best * 5.6 + (dither ? (ihash(x * 7919 + sy * 104729 + seed) - 0.5) * PX_SEAM : 0);
      let idx = val >= 0.6 ? Math.min(6, 1 + Math.floor(val + 0.4)) : 0;
      if (idx < 2) idx = 0;
      // The hot core: one row inside the front curtain's rim, on the crests.
      if (idx === 6 && isFront(who) && cw.crest > 0.86 && Math.floor(cw.yb - 1) === y) idx = 7;
      // The emitter map for the light layer: the front curtain's two top
      // inks, the rim and the core. Their strength rides the same wave as the
      // rays, at its rim phase, so the light swells as a pulse leaves the rim.
      const eg = cs[who].emit ?? (isFront(who) ? 1 : 0);
      if (emit && idx >= (cs[who].emitFrom ?? 6) && eg)
        emit[(oy + y) * W + x] = eg * (idx === 7 ? 1 : 0.7) * (live ? 1 + 0.5 * cw.ray * Math.sin(cw.ph - th) : 1);
      // Stars: single pixels in bare sky, two brightnesses, a few blinking
      // out. They change state five times a loop, not every frame, so the
      // sky's own twinkle stays slower than the aurora.
      let rgb = null;
      if (stars && idx === 0 && best < 0.05) {
        const h = ihash(x * 92821 + y * 68917 + seed);
        const kk = Math.floor((k * 5) / N);
        if (h > 1 - starP && ihash(x * 31 + y * 17 + kk * 7 + seed) > 0.15)
          rgb = h > 1 - starP * 0.375 ? star : mixRgb(hexRgb(NIGHT[0]), star, 0.55);
      } else if (idx >= 2) rgb = ramps[who][idx];
      const o = ((oy + y) * W + x) * 4;
      if (rgb) {
        px[o] = rgb[0];
        px[o + 1] = rgb[1];
        px[o + 2] = rgb[2];
        px[o + 3] = 255;
      }
    }
  }
};

// 20 frames at 0.3s (2026-10-21; was 8 at 1.4s). With only brightness moving,
// frames are cheap — most of each one repeats the last, which deflate eats —
// and a short dwell is what turns the steps into shimmer instead of a
// sequence of stills.
export const PIXEL_FRAMES = 20;
export const PIXEL_DWELL = 0.3;

// The sheet: N frames of W×H stacked vertically, RGBA. Returns the raw pixels
// so the build can encode them and the preview can inspect them.
//
// CSS MUST AGREE: the band is H×scale tall (240px), background-size is
// (W×scale) by (N×H×scale) — 960×4800 at the defaults, 1440×4800 for the back
// sheet — `steps(N)`, the keyframe to `0 -(N×H×scale)px`, and the duration
// N×dwell (6s).
//
// `dither: false` and `snes: true` are the strict-16-bit style: no stipple at
// all, and every ink snapped to the SNES's 15-bit colour. Not the default —
// kept as a dial for the style comparison.
//
// `layer` is for the masthead (pixelLayers): 'back' or 'front' draws only that
// curtain, so the two can live in sheets of different widths. `backW` tells
// the front layer how wide the back tile is, so its rays know where the back
// curtain's rim can be (see pxCap). Everything else draws both curtains into
// one sheet, which is what the button, the sig, the cards and the post bands
// still do.
export const pixelSheet = (
  dateStr,
  {
    W = PIXEL_W,
    H = PIXEL_FH,
    frames: N = PIXEL_FRAMES,
    form,
    lMax = 0.85,
    fade = [0.5, 0.5],
    dither = true,
    snes = false,
    // Posture, in fractions of the frame height: where each lit edge rides
    // and how tall each curtain stands. Ray periods are whole cycles per tile,
    // restated from the 240-wide originals as round(n × W / 240).
    // `env` is form 8's dim fill, as a share of the curtain: the lab's 0.42
    // left deep dark notches between flames at this height, and a row of
    // notched triangles is a pine forest.
    back = { base: 0.62, thick: 0.75, n1: 20, n2: 45, env: 0.65 },
    front = { base: 0.86, thick: 1.0, n1: 17, n2: 39, env: 0.65 },
    sweep = 0.1,
    stars = true,
    starP = 0.008,
    layer = null,
    backW = PIXEL_BACK_W,
  } = {},
) => {
  const hue = (hashOf(dateStr) % 360000) / 1000;
  const spread = daySpread(dateStr);
  // The back curtain gets its own ramp, 60° further along the ladder and
  // capped darker, so where the curtains overlap they separate.
  const ramps = [
    pxPalette((hue + 60) % 360, { lMin: 0.4, lMax: lMax - 0.05, spread, snes }),
    pxPalette(hue, { lMax, spread, snes }),
  ];
  const dh = hashOf(`pxgeom:${dateStr}`);
  const seed = dh % 100003;
  const dph = ((dh >>> 8) % 1000) / 1000;
  const wob = (1.2 * H) / 28; // tuned at 28 rows
  // Back curtain first.
  const cs = [
    { ...back, base: back.base * H, thick: back.thick * H, sweep: sweep * H, wob, ph: 2.4 + TAU * dph, gain: 0.7, seed: seed + 11 },
    { ...front, base: front.base * H, thick: front.thick * H, sweep: sweep * H, wob, ph: 0.2 + TAU * dph, gain: 1.0, seed: seed + 23 },
  ];
  // The front's rays stop at the back curtain's lit rim (pxRays). Sharing a
  // tile that is a plain lookup. In separate tiles of different widths the
  // front column x sits over back column (x + W·j) mod backW, with a different
  // j in every copy of the front tile, so no one answer is the rim: the
  // answer is the LOWEST rim of the alignments, which keeps a ray from ever
  // crossing the back's rim and, on the copies where the rim is higher, stops
  // it a little short.
  const backC = cs[0];
  if (layer === "front") {
    const copies = backW / gcd(W, backW);
    cs[1].capAt = (x) => {
      let low = -Infinity;
      for (let j = 0; j < copies; j += 1) low = Math.max(low, pxGeom(backC, (x + W * j) % backW, 0, backW).yb);
      return low;
    };
  } else if (!layer) cs[1].capAt = (x) => pxGeom(backC, x, 0, W).yb;

  const f = form ?? pixelForm(dateStr);
  let curtains = cs;
  let inks = ramps;
  if (layer === "back") {
    // The back curtain's rim casts light too, but less: it is behind.
    cs[0].front = false;
    cs[0].emit = PX_BACK_EMIT;
    // The back's gain (0.7) never reaches the top ink, so its rim is the
    // step below.
    cs[0].emitFrom = 5;
    curtains = [cs[0]];
    inks = [ramps[0]];
  } else if (layer === "front") {
    // Opaque wherever it is visibly there, as the painter's order had it.
    cs[1].floor = 0.16;
    curtains = [cs[1]];
    inks = [ramps[1]];
  }
  const px = new Uint8Array(W * H * N * 4);
  const emit = new Float32Array(W * H * N);
  for (let k = 0; k < N; k += 1)
    pxFrame(px, { W, H, oy: k * H, k, N, form: f, cs: curtains, ramps: inks, fade, seed, stars: stars && layer !== "front", starP, dither, emit });
  // `light` is the colour the emitters cast: the front curtain's body ink,
  // the most saturated step, so the light tints rather than whitens.
  const own = layer === "back" ? ramps[0] : ramps[1];
  return { px, w: W, h: H * N, form: f, emit, frames: N, light: own[4], rim: own[6] };
};

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// How much light the back curtain casts, against the front's 1.
const PX_BACK_EMIT = 0.55;
// The masthead's star share of bare sky: 0.008 at ×4 restated for ×5 (16/25),
// so the sky has as many stars per screen pixel as it did.
const PX_STARS = 0.0051;

// The masthead, as two sheets (2026-10-21; see the note above PIXEL_W): the
// front curtain at 192 art px wide, the back at 288. Stars live in the back
// sheet, behind everything; the front is opaque where it is drawn.
//
// CSS MUST AGREE (body::before and body::after): both sheets at the same
// frame height and frame count, so ONE animation steps them together. The
// front is 960px wide on screen and the back 1440px.
export const pixelLayers = (dateStr, opts = {}) => {
  const form = opts.form ?? pixelForm(dateStr);
  const back = pixelSheet(dateStr, {
    ...opts,
    form,
    W: PIXEL_BACK_W,
    layer: "back",
    back: { base: 0.62, thick: 0.75, n1: 30, n2: 67, env: 0.65 },
    starP: PX_STARS,
  });
  const front = pixelSheet(dateStr, { ...opts, form, W: PIXEL_W, layer: "front", backW: PIXEL_BACK_W });
  return { back, front, form };
};

// The light layer (2026-10-21, the Sea of Stars direction): the masthead's
// rim and core cast light over the whole header, wordmark and nav included,
// the way a scene-wide light pass recolours hand-pixeled sprites. The pixel
// sheet is untouched; this is a second sheet composited over it with a
// screen blend, so black here means "no light" and nothing needs alpha.
//
// The blur is BAKED, not done by CSS `filter: blur()`. A runtime blur over a
// 240px band repaints every step on every visit, which is exactly the cost a
// phone notices; baked, the browser only composites one screen blend per
// step. Baking also lets the light sheet be low-res — light has no edges, so
// half the art resolution, smooth-scaled by the browser (`image-rendering:
// auto`), loses nothing — and lets the frames carry the rim's pulse.
//
// Two blurs, as in the mock Hat picked: a tight spill that hugs the rim and a
// wide halo that reaches the wordmark. Sigmas are in ART pixels (×5 on
// screen: 2.0 and 6.8 are the mock's 10px and 34px). Horizontal blur wraps,
// so the light tiles as seamlessly as the sky; vertical blur stops at the
// band's edges, where the band does.
//
// One light sheet per sky sheet (pixelLayers): the front curtain's light has
// the front's 960px period and the back curtain's the back's 1440, so the
// glow does not repeat any sooner than the sky does. `down` must divide the
// sheet's width (192 and 288 both take 4).
//
// GUARD ROWS (2026-10-21). The light is smooth-scaled, and a smooth scale
// blends each row with its neighbours — across a frame boundary too, so the top
// ~10px of every frame wore a strip of the previous frame's bottom row, which
// is where the front rim's light is brightest. Every frame now carries one
// guard row above and below, a copy of its own edge row: the blend at the edge
// is between a row and itself. The cost is that the light sheet's frame is
// (h + 2) rows, not h, which CSS must know.
//
// CSS MUST AGREE: the same frame count, the same width and the same steps() as
// the sheet, but not the same height or offsets. A light frame is 12 rows plus
// two guards, 14, and each row is 20px on screen (down × the art scale), so
// the frame stride is 280px, the sheet 20 × 280 = 5600px tall, and the window
// starts one row (20px) down, past the top guard: 0 -20px … -5620px. The
// frame's visible 240px is the same 240px as the sky's.
export const pixelLightSheet = (
  sheet,
  { down = 4, spill = { sigma: 2.0, gain: 1.4 }, halo = { sigma: 6.8, gain: 1.3 } } = {},
) => {
  const N = sheet.frames;
  const W = sheet.w;
  const H = sheet.h / N;
  const w = W / down;
  const h = H / down;
  const blur = (src, sigma) => {
    const s = sigma / down;
    const r = Math.ceil(3 * s);
    const ker = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * s * s)));
    const sum = ker.reduce((a, b) => a + b, 0);
    const kn = ker.map((v) => v / sum);
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        let v = 0;
        for (let i = -r; i <= r; i += 1) v += kn[i + r] * src[y * w + ((((x + i) % w) + w) % w)];
        tmp[y * w + x] = v;
      }
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        let v = 0;
        for (let i = -r; i <= r; i += 1) {
          const yy = y + i;
          if (yy >= 0 && yy < h) v += kn[i + r] * tmp[yy * w + x];
        }
        out[y * w + x] = v;
      }
    return out;
  };
  // Spill takes a little of the rim's own pale colour; the halo is pure body
  // ink, so the far light is coloured rather than milky.
  const body = sheet.light.map((v) => v / 255);
  const near = sheet.rim.map((v, i) => 0.4 * (v / 255) + 0.6 * body[i]);
  // One guard row above and below every frame, copies of the frame's own edge
  // rows (see the note above). The sheet is (h + 2) rows a frame.
  const px = new Uint8Array(w * (h + 2) * N * 3);
  for (let k = 0; k < N; k += 1) {
    const src = new Float32Array(w * h);
    for (let y = 0; y < H; y += 1)
      for (let x = 0; x < W; x += 1)
        src[((y / down) | 0) * w + ((x / down) | 0)] += sheet.emit[(k * H + y) * W + x] / (down * down);
    const a = blur(src, spill.sigma);
    const b = blur(src, halo.sigma);
    for (let i = 0; i < w * h; i += 1)
      for (let c = 0; c < 3; c += 1) {
        // Soft-clipped, so a dense crest saturates toward the light's colour
        // instead of hard-clipping a channel and shifting hue.
        const v = a[i] * spill.gain * near[c] + b[i] * halo.gain * body[c];
        px[(k * w * (h + 2) + w + i) * 3 + c] = Math.round(255 * (1 - Math.exp(-v)));
      }
    const o = k * w * (h + 2) * 3;
    px.copyWithin(o, o + w * 3, o + w * 6); // guard above = row 0
    px.copyWithin(o + w * (h + 1) * 3, o + w * h * 3, o + w * (h + 1) * 3); // guard below = last row
  }
  return { px, w, h: (h + 2) * N };
};

// The same light baked into a flat image, for the surfaces that cannot stack
// a second layer: the forum sig and the 88×31 button are single images that
// other sites show as-is. Screen, as body::after does, applied once to frame
// k of an RGB buffer of the sheet's own size. Pass a light sheet made at
// `down: 1` — these images are small enough that quarter resolution would be
// a handful of pixels — and skip its guard row, the first row of each frame.
export const screenLight = (rgb, light, W, H, k = 0) => {
  const o = (k * (H + 2) + 1) * W;
  for (let i = 0; i < W * H; i += 1)
    for (let c = 0; c < 3; c += 1) {
      const a = rgb[i * 3 + c];
      const b = light.px[(o + i) * 3 + c];
      rgb[i * 3 + c] = 255 - Math.round(((255 - a) * (255 - b)) / 255);
    }
  return rgb;
};

// The post band in pixels: the night a post was written, one static frame.
// 192×20 shown at ×5 — a 960×100 tile (it was 240×24 at ×4, 96px). Static, never
// animated: five of these breathing on the home page is the same mistake as
// thirty shimmering shelf cards. The lit edge rides a little higher than the
// masthead's and the top fades harder, because the band sits under a title
// and a dateline rather than above a page. No stars: the page has its own.
export const PIXEL_BAND_H = 20;
export const pixelBand = (dateStr) =>
  pixelSheet(dateStr, {
    H: PIXEL_BAND_H,
    frames: 1,
    form: pixelBandForm(dateStr),
    lMax: 0.82,
    fade: [0.45, 0.6],
    back: { base: 0.6, thick: 0.75, n1: 20, n2: 45, env: 0.65 },
    front: { base: 0.84, thick: 1.0, n1: 17, n2: 39, env: 0.65 },
    stars: false,
  });

// The page's own night: a static star tile behind everything, reseeded each
// build so the sky changes nightly like the rest of it. Single pixels at two
// brightnesses and a rare four-point "+", drawn at the same ×5 grid as the
// aurora so a star on the page and a star in the masthead are the same size.
// Sparse on purpose — it is texture under reading, not a scene.
//
// 192 art px at ×5 is the same 960px tile it was at 240 × 4, and the density
// is restated per art pixel to keep the same stars per screen pixel:
// 0.0022 × 25/16 ≈ 0.0034, which is the same ~127 stars in a tile. The cards
// (og.js) draw on a 240-wide ×5 grid and ask for n and density themselves.
export const STAR_TILE = 192;
export const PX_STAR_DENSITY = 0.0034;
export const starTile = (dateStr, { n = STAR_TILE, density = PX_STAR_DENSITY } = {}) => {
  const px = new Uint8Array(n * n * 4);
  const seed = hashOf(`stars:${dateStr}`) % 100003;
  const bright = hexRgb(STAR);
  const dim = mixRgb(hexRgb("#0a0c18"), bright, 0.45);
  const mid = mixRgb(hexRgb("#0a0c18"), bright, 0.7);
  const put = (x, y, rgb) => {
    const o = (((y + n) % n) * n + ((x + n) % n)) * 4;
    px.set([...rgb, 255], o);
  };
  for (let y = 0; y < n; y += 1)
    for (let x = 0; x < n; x += 1) {
      const h = ihash(x * 92821 + y * 68917 + seed);
      if (h < 1 - density) continue;
      const r = ihash(x * 31 + y * 17 + seed);
      if (r > 0.97) {
        // the rare cross: a bright core and dim arms, wrapping at the tile edge
        put(x, y, bright);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + dx, y + dy, dim);
      } else put(x, y, r > 0.75 ? mid : dim);
    }
  return { px, w: n, h: n };
};

// ---------------------------------------------------------- pixel subjects
//
// The subject skies and chips in pixels (2026-10-19), on the masthead's
// pipeline: the same three forms, the same seven-step ramp, the same Bayer
// dither, fed the subject's ladder hue instead of the date's. Status and
// recency scale each curtain's intensity BEFORE quantising, so a faded sky
// lands on darker ramp steps rather than on alpha — which is what the
// alpha-carried axes needed to survive the move to pixels. The SVG versions
// above stay for og.js and as the record.
//
// One image per subject, sized for the largest box it fills and cropped by
// the rest, never stretched: a pixel image stretched to an arbitrary box
// smears. The big sky is 42×64 art pixels (210×320 at ×5, since 2026-10-21 —
// it was 52×80 at ×4; the largest box is the shelf card at ~209×314, just
// under a 704px viewport) and the chip 16×22; the scene lives in the top
// rows every box shows (35 and 16), the rest is night. The build pre-scales
// them (×5, ×2) so CSS shows them at natural size, anchored top-centre, with
// pixelated scaling. Mocked against the SVGs for ten real subjects before
// porting; Hat picked the pixel chips.
export const PX_SKY = { w: 42, h: 64, scene: 35, scale: 5 };
export const PX_CHIP = { w: 16, h: 22, scene: 16, scale: 2 };

const pxUpscale = (px, w, h, k) => {
  const out = new Uint8Array(w * k * h * k * 4);
  for (let y = 0; y < h * k; y += 1)
    for (let x = 0; x < w * k; x += 1) {
      const i = (((y / k) | 0) * w + ((x / k) | 0)) * 4;
      out.set(px.subarray(i, i + 4), (y * w * k + x) * 4);
    }
  return out;
};

export const pixelSubject = (slug, ladderHue, status, tier, { canon = false, chip = false } = {}) => {
  const { w: W, h: H, scene: SH, scale } = chip ? PX_CHIP : PX_SKY;
  const px = new Uint8Array(W * H * 4);
  const done = status === "completed";
  const night = (done ? NIGHT_DONE : NIGHT).map(hexRgb);
  // The night in three dithered steps over the scene rows, then held.
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const v = Math.min(1, y / SH) * 2 + (bay(x, y) - 0.5) * 0.6;
      px.set([...night[Math.max(0, Math.min(2, Math.round(v)))], 255], (y * W + x) * 4);
    }
  const seed = hashOf(slug) % 100003;

  if (!done) {
    const form = PIXEL_FORM_NAMES[hashOf(`form:${slug}`) % PIXEL_FORM_NAMES.length];
    // How much is left burning. Active and backlog follow recency, as the
    // SVG scenes did; the rest are fixed, like their SVG opacities.
    const g = { shelved: 0.28, owned: 0.5, incomplete: 0.4 }[status] ?? tier;
    const n1 = chip ? 2 : 4;
    const n2 = chip ? 3 : 9;
    const ph = (seed % 628) / 100;
    const ramp = (h, lMax) => pxPalette(h, { lMin: lMax < 0.8 ? 0.36 : 0.4, lMax, grey: status === "incomplete" });
    const curt = (base, thick, nn2, phase, gain, s) => ({
      base: SH * base, thick: SH * thick, n1, n2: nn2, env: 0.65,
      sweep: SH * 0.07, wob: SH * 0.035, ph: phase, gain, seed: s,
    });
    // Back to front. Incomplete keeps one grey ghost, as it always has.
    const cs = [];
    const ramps = [];
    if (status !== "incomplete") {
      cs.push(curt(chip ? 0.42 : 0.38, 0.32, n2 + 2, ph + 2.4, 0.6 * g, seed + 11));
      ramps.push(ramp((ladderHue + 60) % 360, 0.72));
    }
    cs.push(curt(chip ? 0.62 : 0.66, chip ? 0.42 : 0.5, n2, ph, g, seed + 23));
    ramps.push(ramp(ladderHue, 0.85));
    pxFrame(px, { W, H: SH, oy: 0, k: 0, N: 1, form, cs, ramps, fade: [1, 0.01], seed, stars: chip });
  } else {
    // Completed trades the aurora for the moon: a waning crescent, the lit
    // disc less an offset one, with one dithered halo step on the big sky.
    // Gold for canon (MOON_GOLD, which tracks --gold).
    const moon = hexRgb(canon ? MOON_GOLD : MOON);
    // The big moon was 8 rows by 13 down at ×4; 6.4 and 10.4 are the same
    // 32px and 52px at ×5.
    const r = chip ? W * 0.26 : 6.4;
    const cx = W / 2;
    const cy = chip ? SH * 0.42 : 10.4;
    const ox = cx + r * 0.5;
    const oy = cy - r * 0.27;
    const halo = mixRgb(night[0], moon, 0.18);
    for (let y = 0; y < SH; y += 1)
      for (let x = 0; x < W; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (Math.hypot(x + 0.5 - ox, y + 0.5 - oy) < r * 0.95) continue;
        const o = (y * W + x) * 4;
        if (d < r) px.set([...moon, 255], o);
        else if (!chip && d < r * 1.55 && bay(x, y) < 1 - (d - r) / (r * 0.55)) px.set([...halo, 255], o);
      }
  }
  // Stars wherever the sky is still bare night, the scene and below. The big
  // sky was 1.8% stars at ×4, eight times the page's density, and read as a
  // snow globe (2026-10-21); it now asks for the page's own — PX_STAR_DENSITY
  // is stars per art pixel at ×5, so a star is as common here as behind the
  // text. The chip is two screen pixels to an art pixel and a few dozen art
  // pixels to a side; at the page's density it would hold no stars, so it
  // keeps its 1.5%.
  const star = hexRgb(STAR);
  const dimStar = mixRgb(night[0], star, 0.55);
  const starP = chip ? 0.015 : PX_STAR_DENSITY;
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const h = ihash(x * 92821 + y * 68917 + seed);
      if (h <= 1 - starP) continue;
      const o = (y * W + x) * 4;
      if (night.some((c) => c[0] === px[o] && c[1] === px[o + 1] && c[2] === px[o + 2]))
        px.set([...(h > (chip ? 0.993 : 1 - starP * 0.39) ? star : dimStar), 255], o);
    }
  return { px: pxUpscale(px, W, H, scale), w: W * scale, h: H * scale };
};
