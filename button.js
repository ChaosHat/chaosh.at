// The site button: an 88×31 for other people's sidebars, drawn from the same
// pixel aurora as the masthead (aurora.js pixelSheet) with the comet mark on
// top, and written out as button.png (still) and button.gif (8 frames). Rasterised here in plain JS — no canvas, no browser
// — so the build stays a pure function of the date, same as the header.
// Design record: vault, 80_Projects/"chaosh.at Design" (2026-09-05) and
// 90_Reference/91_Documentation/"chaosh.at Design System".
import { encodePng } from "./png.js";
import { dayFrame, daySpread, hashOf, palette, pixelSheet } from "./aurora.js";

export const BUTTON_W = 88;
export const BUTTON_H = 31;
export const BUTTON_FRAMES = 8;
// Centiseconds per frame: 1.4s a frame, 8 frames over 11.2s. That was the
// masthead's own pace; the masthead has since gone to 20 frames at 0.3s
// (aurora.js PIXEL_FRAMES, PIXEL_DWELL) and the button was left at the slow
// breath, so it no longer matches the header it came from.
export const BUTTON_DELAY = 140;

const W = BUTTON_W;
const H = BUTTON_H;
const N = BUTTON_FRAMES;

const NIGHT = [10, 12, 24]; // --night
const INK = [236, 234, 250]; // --ink

// The wordmark. Silkscreen at 12px, thresholded once and kept as pixels —
// 12px is 1.5 pixels per grid unit, and the S that fell out of that is the
// point (Hat: "spiral galaxy"). Everything else was hand-squared: the dot is
// a true 2×2, the T's bar is symmetric. The dot sits at the CHAOS·HAT word
// boundary, raised to mid-height, not at the domain's ".at" — that break is
// the one place the eye should not stop. Never regenerate this from the font.
export const WORDMARK = [
  "..###....##...##....###......###......#####......##...##...####...######",
  ".#####...##...##...#####.....###.....#####.......##...##..######..######",
  "##...##..##...##..##...##..##...##..##...........##...##..##..##....##..",
  "##.......#######..#######..##...##....###....##..#######..######....##..",
  "##.......#######..#######..##...##....###....##..#######..######....##..",
  "##...##..##...##..##...##..##...##.......##......##...##..##..##....##..",
  ".#####...##...##..##...##..#######...#####.......##...##..##..##....##..",
  "..###....##...##..##...##....###....#####........##...##..##..##....##..",
];

// The same bitmap as an inline SVG for the masthead, so the site's name and
// its button are one mark at two sizes. Rows are run-length encoded into a
// single path; currentColor lets it take the link's colour like text would.
export const wordmarkSvg = (scale = 2, label = "chaosh.at") => {
  const w = WORDMARK[0].length;
  const h = WORDMARK.length;
  let d = "";
  WORDMARK.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      if (row[x] !== "#") {
        x += 1;
        continue;
      }
      let run = 0;
      while (row[x + run] === "#") run += 1;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return (
    `<svg class="wordmark" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" ` +
    `role="img" aria-label="${label}" shape-rendering="crispEdges"><path fill="currentColor" d="${d}"/></svg>`
  );
};

// The masthead mark (2026-10-19): the wordmark with a comet falling out of the
// sky through it — arcing over CHAOS from the top left, crossing the H at an
// angle, and landing as a fireball (ball, flame funnel, glint) under the A/T
// gap. Drawn once in a mock session and frozen here like WORDMARK; only the
// colours move. The comet sits in front of the name, but its night outline
// never cuts letter ink and the S is redrawn on top. Slots: n night outline,
// i ink, d/m/g/e the day's deep/mid/glow/edge — so the comet wears the same
// sky as the masthead. `deep` only reaches the dotted tail: further in, it
// matched the aurora behind it and the trail vanished.
// Reads as a cousin of the FFVII Meteor logo; that's welcome.
// Redrawn the same day (round "A2e", the sig session): the tail is one smooth
// cubic from the flat dotted run into the drop — the first version had a hard
// knee where it turned down — and it passes BEHIND the name: every letter
// keeps its night outline, so HAT stays legible where the trail crosses it,
// and the trail shows only in the gaps. The fireball (funnel, ball, glint) is
// the first version's, transplanted onto the new curve's end, and set as far
// left as it goes (its funnel brushes the T's foot) so name and fireball span
// exactly the button's 86 inside columns.
export const COMET_MARK = [
  "n...n...n.n.n.n.n.n.n.n.n.n.nnnnnnnnnnnnnnn........................................................",
  "dn.ndn.ndndndndndndndndndndndmmmmmmmmmmmmmmnnnnnnnnn...............................................",
  "n...n...n.n.n.n.n.n.n.n.n.n.nnnnnnnnnmmmmmmmmmmmmmmmnnnnnn.........................................",
  ".....................................nnnnnnnnnnmmmmmmmmmmmnnnnn....................................",
  "...............................................nnnnnnnmmmmmggggnnnn................................",
  "................nnn....nn...nn....nnn......nnn......nnnnnnnggggnnggnnnn..nnnn...nnnnnn.............",
  "...............niiin..niin.niin..niiin....niiin....niiiiin.nnnniingniinnniiiin.niiiiiin............",
  "..............niiiiin.niin.niin.niiiiin..nniiinn..niiiiin.....niingniinniiiiiinniiiiiin............",
  ".............niinnniinniinnniinniinnniinniinnniinniinnnn...nn.niinnniinniinniin.nniinn.............",
  ".............niin..nn.niiiiiiinniiiiiiinniin.niin.nniiin..niinniiiiiiinniiiiiinnnniin..............",
  ".............niin..nn.niiiiiiinniiiiiiinniin.niin..niiinn.niinniiiiiiinniiiiiineeniin..............",
  ".............niinnniinniinnniinniinnniinniinnniin..nnnniin.nn.niinnniinniinniineeniin..............",
  "..............niiiiin.niin.niinniin.niinniiiiiiin.niiiiin.....niin.niinniinniieeeegimn.............",
  "...............niiin..niin.niinniin.niin.nniiinn.niiiiin......niin.niinniinniigneeegngnnn..........",
  "................nnn....nn...nn..nn...nn....nnn....nnnnn........nn...nn..nn..nnnmeeeeengmmn.........",
  "...............................................................................nmeeeeeneeenn.......",
  "................................................................................ngeeieeiiieen......",
  "...............................................................................nmggeneiiiiien......",
  "................................................................................nngneiiiiiiien.....",
  ".................................................................................nmgeiiiiiiienn....",
  ".................................................................................nmmeiiiiiiienin...",
  "..................................................................................nmneiiiiiennin...",
  "...................................................................................nmeeiiieeneienn.",
  "....................................................................................nnneeeniiiiiiin",
  ".......................................................................................nnn.nneienn.",
  ".............................................................................................nin...",
  ".............................................................................................nin...",
  "..............................................................................................n....",
];
// Where WORDMARK's top-left falls inside COMET_MARK, in art pixels.
export const COMET_ORIGIN = [14, 6];

export const cometMarkSvg = (dateStr, scale = 2, label = "chaosh.at") => {
  const hue = (hashOf(dateStr) % 360000) / 1000;
  const pal = palette(hue, { lMax: 0.85, spread: daySpread(dateStr) });
  const fill = { n: "#0a0c18", i: "#eceafa", d: pal.deep, m: pal.mid, g: pal.glow, e: pal.edge };
  const w = COMET_MARK[0].length;
  const h = COMET_MARK.length;
  const d = {};
  COMET_MARK.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x];
      if (c === ".") {
        x += 1;
        continue;
      }
      let run = 0;
      while (row[x + run] === c) run += 1;
      d[c] = (d[c] ?? "") + `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  const paths = Object.entries(d).map(([c, p]) => `<path fill="${fill[c]}" d="${p}"/>`).join("");
  return (
    `<svg class="wordmark comet-mark" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" ` +
    `role="img" aria-label="${label}" shape-rendering="crispEdges">${paths}</svg>`
  );
};

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// ---------------------------------------------------------------- raster

// The comet mark is 99×28; the button's inside is 86×29. The mark goes in at
// 1× (its own art pixels — scaling pixel art is the one thing it can't take),
// so it gives up BUTTON_CROP columns of the dotted tail on the left, which
// reads as the comet coming in from off the tile. One row of sky below it.
const BUTTON_CROP = 13;

// Same hue, palette and posture as the masthead, at 88×31: the sky is
// pixelSheet's own curtains and stars, with the ray periods scaled to the
// tile so a ray is as many pixels wide as it is in the header. The frame is
// the day's frame colour, like every box on the site.
export const buttonFrames = (dateStr) => {
  const pal = palette((hashOf(dateStr) % 360000) / 1000, { lMax: 0.85, spread: daySpread(dateStr) });
  const fill = { n: NIGHT, i: INK, d: hexRgb(pal.deep), m: hexRgb(pal.mid), g: hexRgb(pal.glow), e: hexRgb(pal.edge) };
  const frameRgb = hexRgb(dayFrame(dateStr));
  const sheet = pixelSheet(dateStr, {
    W,
    H,
    frames: N,
    lMax: 0.8,
    fade: [0.55, 0.6],
    back: { base: 0.95, thick: 0.8, n1: 9, n2: 21, env: 0.65, cell: 22 },
    front: { base: 1.15, thick: 1.0, n1: 8, n2: 18, env: 0.65, cell: 22 },
  });
  return Array.from({ length: N }, (_, k) => {
    const rgb = new Uint8Array(W * H * 3);
    const put = (x, y, c) => {
      if (x >= 0 && x < W && y >= 0 && y < H) rgb.set(c, (y * W + x) * 3);
    };
    for (let i = 0; i < W * H; i += 1) {
      const o = (k * W * H + i) * 4;
      rgb.set(sheet.px[o + 3] ? sheet.px.subarray(o, o + 3) : NIGHT, i * 3);
    }
    COMET_MARK.forEach((row, y) =>
      [...row].forEach((c, x) => c !== "." && x >= BUTTON_CROP && put(1 + x - BUTTON_CROP, 1 + y, fill[c])),
    );
    for (let x = 0; x < W; x += 1) {
      put(x, 0, frameRgb);
      put(x, H - 1, frameRgb);
    }
    for (let y = 0; y < H; y += 1) {
      put(0, y, frameRgb);
      put(W - 1, y, frameRgb);
    }
    return rgb;
  });
};

// ------------------------------------------------------------------- gif

// One global palette for all frames. Colours are snapped to `bits` per channel
// and the precision drops until the table fits 256 entries; on a night-dark
// tile this settles at 6 or 7 bits, well past what an 88×31 can show.
const quantise = (frames) => {
  for (let bits = 8; bits >= 3; bits -= 1) {
    const shift = 8 - bits;
    const max = (1 << bits) - 1;
    const snap = (v) => Math.round(((v >> shift) * 255) / max);
    const table = new Map();
    const indexed = frames.map((rgb) => {
      const idx = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i += 1) {
        const key = (snap(rgb[i * 3]) << 16) | (snap(rgb[i * 3 + 1]) << 8) | snap(rgb[i * 3 + 2]);
        let c = table.get(key);
        if (c === undefined) {
          c = table.size;
          table.set(key, c);
        }
        idx[i] = c;
      }
      return idx;
    });
    if (table.size <= 256) return { table: [...table.keys()], indexed, bits };
  }
  throw new Error("button.gif: palette would not fit 256 colours");
};

// GIF-flavoured LZW (variable code width, early clear at 4096).
const lzw = (indices, minCodeSize) => {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map();
  const out = [];
  let acc = 0;
  let accBits = 0;
  const emit = (code) => {
    acc |= code << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      accBits -= 8;
    }
  };
  emit(clear);
  let w = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i];
    const key = (w << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      w = hit;
      continue;
    }
    emit(w);
    if (next === 4096) {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize += 1;
      dict.set(key, next);
      next += 1;
    }
    w = k;
  }
  emit(w);
  emit(eoi);
  if (accBits > 0) out.push(acc & 0xff);
  return Buffer.from(out);
};

const subBlocks = (data) => {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) {
    const slice = data.subarray(i, i + 255);
    parts.push(Buffer.from([slice.length]), slice);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
};

export const encodeGif = (frames, delay = BUTTON_DELAY) => {
  const { table, indexed } = quantise(frames);
  let bitsPerPixel = 1;
  while (1 << bitsPerPixel < table.length) bitsPerPixel += 1;
  bitsPerPixel = Math.max(2, bitsPerPixel);
  const ct = Buffer.alloc(3 * (1 << bitsPerPixel));
  table.forEach((key, i) => {
    ct[i * 3] = key >> 16;
    ct[i * 3 + 1] = (key >> 8) & 0xff;
    ct[i * 3 + 2] = key & 0xff;
  });
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(W, 0);
  lsd.writeUInt16LE(H, 2);
  lsd[4] = 0x80 | 0x70 | (bitsPerPixel - 1); // global table, 8-bit colour, table size
  const loop = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "ascii"), 0x03, 0x01, 0x00, 0x00, 0x00]);
  const parts = [Buffer.from("GIF89a", "ascii"), lsd, ct, loop];
  for (const idx of indexed) {
    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, delay & 0xff, delay >> 8, 0x00, 0x00]);
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(W, 5);
    desc.writeUInt16LE(H, 7);
    parts.push(gce, desc, Buffer.from([bitsPerPixel]), subBlocks(lzw(idx, bitsPerPixel)));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
};

export const buttonFiles = (dateStr) => {
  const frames = buttonFrames(dateStr);
  return { png: encodePng(frames[0], W, H), gif: encodeGif(frames) };
};
