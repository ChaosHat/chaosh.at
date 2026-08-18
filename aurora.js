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
const arcHue = (ladderHue) => ARC_START + (ladderHue / 360) * ARC_SPAN;

const palette = (ladderHue) => {
  const H = arcHue(ladderHue);
  return {
    edge: oklch(0.9, 0.13, H),
    mid: oklch(0.74, 0.15, H),
    deep: oklch(0.55, 0.11, H + 8),
    glow: oklch(0.78, 0.13, H),
  };
};

const GREY = { edge: "#8d93a8", mid: "#5c6273", deep: "#3a3f4e", glow: "#6a7082" };

// Night base and furniture. Neutral for every subject: identity lives in the
// curtains, the ground stays out of the argument.
const NIGHT = ["#14152e", "#1a1c38", "#202544"];
const NIGHT_DONE = ["#0e0f20", "#111227", "#14162e"];
const STAR = "#eef2ff";
const MOON = "#ecf0fb";

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

// A curtain: bright lower edge, vertical rays of jittered heights fading
// upward, brightness pulsing along the length. The per-column jitter is what
// keeps it from ever reading as a banded stripe.
//
// `sway` scales the vertical wander (wave amplitude and end-to-end drift),
// `edgeH` the thickness of the bright edge, `quant` the y grid the edge snaps
// to, and `step` the column width. All four exist for the banner, whose box is
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
export const subjectSvg = (slug, ladderHue, status, tier) => {
  const rand = mulberry32(hashOf(slug));
  const pal = palette(ladderHue);
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
      `<circle cx='48' cy='56' r='51' fill='${MOON}' fill-opacity='0.16'/>` +
      `<circle cx='48' cy='56' r='30' fill='${MOON}'/>` +
      `</g>`;
  } else if (status === "abandoned") {
    body += curtain(rand, GREY, { yMin: 42, yMax: 58, hBase: 14, op: 0.3 });
  } else if (status === "shelved") {
    body += curtain(rand, pal, { yMin: 16, yMax: 24, hBase: 5, op: 0.25 });
    body += curtain(rand, pal, { yMin: 42, yMax: 58, hBase: 10, op: 0.35 });
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
export const chipSvg = (slug, ladderHue, status, tier) => {
  const rand = mulberry32(hashOf(slug));
  const pal = status === "abandoned" ? GREY : palette(ladderHue);
  const W = 24;
  const H = 32;
  const op =
    status === "completed" ? 0 : status === "abandoned" ? 0.5 : status === "shelved" ? 0.45 : Math.max(tier, 0.5);
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
    body += `<circle cx='16' cy='9' r='4' fill='${MOON}'/>`;
  }
  body += `<rect x='${(rand() * W).toFixed(0)}' y='${(rand() * 8).toFixed(0)}' width='1' height='1' fill='${STAR}'/>`;
  body += `<rect x='${(rand() * W).toFixed(0)}' y='${(20 + rand() * 10).toFixed(0)}' width='1' height='1' fill='${STAR}'/>`;
  return svgWrap(W, H, body);
};

// The banner: what a sky becomes when a shelf tile is carrying SOURCED cover
// art and the generated art steps back to being a status light. Not the tile
// squashed — squashing flattens the curtains into the graph-line failure the
// chip was invented to dodge. It is the same night through a WIDE window: two
// curtains at tile scale, cropped by a short frame, rays running off the top
// the way a real curtain running out of frame does.
//
// Same seed as the tile, so a subject's banner and its tile are the same sky
// and not two pictures. Both meaning axes survive the crop: status still says
// how much aurora is left (three-then-two curtains, grey ghost, moon), recency
// still says how brightly it burns. Only the identifying job moves — that's the
// cover's now, which is the point of the whole arrangement.
//
// 96 wide is not a free choice — it is the TILE's width, and the banner has to
// keep it. curtain()'s per-column ray jitter is a function of raw x, so its
// spatial frequency is fixed per unit of width: at 192 the rays came out twice
// as fine, and a wide strip of high-frequency rays is precisely the "banded
// stripe" this drawing was built to avoid. Same width, same hue, same chunk.
//
// Height is the one knob, and every other number below is derived from it as a
// fraction. Tuning this by hand once produced a strip that only looked right at
// one height; expressed as fractions, changing BANNER_H alone re-tunes the
// wander, the ray length, the edge weight and the moon together, and the strip
// stays a strip at any size worth using. Sane range is roughly 10–20.
export const BANNER_W = 96;
export const BANNER_H = 17;

export const bannerSvg = (slug, ladderHue, status, tier, h = BANNER_H) => {
  const rand = mulberry32(hashOf(slug));
  const pal = palette(ladderHue);
  const W = BANNER_W;
  const H = h;

  // The main curtain rides low on purpose: the strip's bottom edge IS the top
  // of the cover, so an edge sitting near it reads as aurora over a horizon
  // rather than a band floating above a dark gap.
  const lowY = 0.68 * H;
  const highY = 0.3 * H;
  // sway is calibrated so the wave amplitude lands near an eighth of the frame
  // whatever the frame is: range(5,9) averages 7, so 0.018*H puts amp ≈ 0.125*H.
  // quant 1 because at these heights the tile's 3-unit grid is a quarter of the
  // whole box — it would step the edge in visible jumps instead of a wave.
  const shape = {
    sway: 0.018 * H,
    edgeH: Math.max(2, Math.round(0.14 * H)),
    quant: 1,
    step: 2, // finer than the tile's 4 — see the aliasing note on curtain()
  };
  const band = (y) => ({ yMin: y - 0.05 * H, yMax: y + 0.05 * H });

  let body = nightBase(status === "completed" ? NIGHT_DONE : NIGHT, W, H);
  body += stars(rand, Math.round((status === "completed" ? 0.5 : 0.35) * H), { w: W, h: H });

  if (status === "completed") {
    // The tile's waning crescent, same construction — lit disc with the
    // night-side disc masked out, halo carved by the same mask — hung left so
    // the rest of the strip stays open night. The HALO is what has to fit
    // inside H, not the disc: clipped, its soft edge becomes a hard chord and
    // the thing stops reading as a moon and starts reading as a grey badge.
    const r = 0.28 * H; // lit disc
    const cx = 1.2 * H;
    const cy = 0.5 * H;
    const f = (n) => n.toFixed(2);
    body +=
      `<mask id='m'><circle cx='${f(cx)}' cy='${f(cy)}' r='${f(r * 1.86)}' fill='#fff'/>` +
      `<circle cx='${f(cx + r * 0.5)}' cy='${f(cy - r * 0.27)}' r='${f(r * 0.93)}' fill='#000'/></mask>` +
      `<g mask='url(#m)'>` +
      `<circle cx='${f(cx)}' cy='${f(cy)}' r='${f(r * 1.7)}' fill='${MOON}' fill-opacity='0.16'/>` +
      `<circle cx='${f(cx)}' cy='${f(cy)}' r='${f(r)}' fill='${MOON}'/>` +
      `</g>`;
  } else if (status === "abandoned") {
    body += curtain(rand, GREY, { ...shape, ...band(lowY), hBase: 0.5 * H, op: 0.3 });
  } else if (status === "shelved") {
    if (H >= 16) body += curtain(rand, pal, { ...shape, ...band(highY), hBase: 0.12 * H, op: 0.25 });
    body += curtain(rand, pal, { ...shape, ...band(lowY), hBase: 0.36 * H, op: 0.35 });
  } else {
    // A second curtain only when there is room for one. Below ~16 the two
    // overlap into a single smear, which reads as less sky rather than more —
    // the same reduction the chip makes, for the same reason.
    if (H >= 16) body += curtain(rand, pal, { ...shape, ...band(highY), hBase: 0.12 * H, op: 0.4 * tier });
    body += curtain(rand, pal, { ...shape, ...band(lowY), hBase: 0.57 * H, op: 0.8 * tier });
  }
  return svgWrap(W, H, body);
};

// The header: one wide curtain, edge to edge, in that night's hue — the date
// seeds the color, so the sky over the masthead changes at each 2am publish
// and holds all day. One SVG holds all 16 frames stacked as a sprite sheet;
// CSS steps background-position through them — no per-frame decode, no
// first-cycle flicker. The curtain is strictly periodic (every x-term is an
// integer number of cycles over the tile) so it repeats seamlessly at a fixed
// 480px width: pixel density never changes with the viewport. Every animated
// term advances a whole number of cycles across the 16 frames, so the loop
// closes. Motion is two layers: the geometry drifts gently (sway + ray
// drift), while brightness runs on standing waves — three pulse patterns at
// different scales plus a slow whole-curtain ebb — so patches glow and dim in
// place instead of marching along the curtain.
export const HEADER_W = 480;
export const HEADER_FH = 112;
export const HEADER_FRAMES = 16;

export const headerSheet = (dateStr) => {
  const hue = (hashOf(dateStr) % 360000) / 1000;
  const pal = palette(hue);
  const TAU = 2 * Math.PI;
  const W = HEADER_W;
  const FH = HEADER_FH;
  const N = HEADER_FRAMES;

  // Each frame is clipped to its own band: the tallest rays reach ~34px above
  // the frame, and without the clip a frame's ray tips render into the bottom
  // of the frame above it — visible on the site as cut-off repeats.
  let frames = "";
  let clips = "";
  for (let k = 0; k < N; k += 1) {
    const theta = (k / N) * TAU;
    const F = k / N;
    const yoff = k * FH;
    const ebb = 1 + 0.08 * Math.sin(TAU * F + 1.9);
    const edge = [];
    let rects = "";
    for (let x = 0; x <= W; x += 4) {
      const t = x / W;
      const y =
        62 +
        9 * Math.sin(TAU * 1 * t + 1.3) +
        4.5 * Math.sin(TAU * 3 * t + 4.1) +
        1.6 * Math.sin(TAU * 3 * t + theta);
      const yb = Math.round(y / 3) * 3;
      edge.push([x, y + yoff]);
      const n =
        0.5 +
        0.5 * Math.sin(TAU * 7 * t + 2.6 + theta) * Math.sin(TAU * 11 * t + 1.3 + theta);
      const pulse =
        0.55 * Math.sin(TAU * 3 * t + 1.1) * Math.sin(TAU * 1 * F + 0.7) +
        0.35 * Math.sin(TAU * 7 * t + 4.2) * Math.sin(TAU * 2 * F + 2.9) +
        0.28 * Math.sin(TAU * 12 * t + 2.0) * Math.sin(TAU * 3 * F + 5.0);
      const b = Math.min(1, Math.max(0.18, 0.6 + 0.36 * pulse));
      const flick = 0.85 + 0.15 * Math.sin(TAU * 9 * t + 0.5) * Math.sin(TAU * 2 * F + 4.0);
      const ray = 34 * (0.9 + 1.5 * n);
      rects +=
        `<rect x='${x}' y='${(yoff + yb - ray).toFixed(0)}' width='4' height='${(ray * 0.7).toFixed(0)}' fill='${pal.deep}' fill-opacity='${Math.max(0.08, 0.32 * b).toFixed(2)}'/>` +
        `<rect x='${x}' y='${(yoff + yb - ray * 0.5).toFixed(0)}' width='4' height='${(ray * 0.5).toFixed(0)}' fill='${pal.mid}' fill-opacity='${Math.max(0.07, 0.58 * b * flick).toFixed(2)}'/>` +
        `<rect x='${x}' y='${yoff + yb - 7}' width='4' height='9' fill='${pal.edge}' fill-opacity='${Math.max(0.1, 0.95 * b * flick).toFixed(2)}'/>`;
    }
    const d =
      `M${edge[0][0]} ${edge[0][1].toFixed(1)}` +
      edge.slice(1).map(([px, py]) => ` L${px} ${py.toFixed(1)}`).join("");
    const glow = `<path d='${d}' fill='none' stroke='${pal.glow}' stroke-opacity='0.15' stroke-width='55' stroke-linecap='round' filter='url(#b)'/>`;
    clips += `<clipPath id='f${k}'><rect x='0' y='${yoff}' width='${W}' height='${FH}'/></clipPath>`;
    frames += `<g clip-path='url(#f${k})' opacity='${(0.45 * ebb).toFixed(3)}'>${glow}${rects}</g>`;
  }

  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${FH * N}' ` +
    `width='${W}' height='${FH * N}' preserveAspectRatio='none'>` +
    `<defs><filter id='b' x='-60%' y='-60%' width='220%' height='220%'>` +
    `<feGaussianBlur stdDeviation='7'/></filter>${clips}</defs>${frames}</svg>`
  );
};
