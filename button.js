// The site button: an 88×31 for other people's sidebars, drawn from the same
// curtain math as the masthead and written out as button.png (still) and
// button.gif (16 frames). Rasterised here in plain JS — no canvas, no browser
// — so the build stays a pure function of the date, same as the header.
// Design record: vault, 80_Projects/"chaosh.at Design" (2026-09-05) and
// 90_Reference/91_Documentation/"chaosh.at Design System".
import zlib from "node:zlib";
import { hashOf, palette } from "./aurora.js";

export const BUTTON_W = 88;
export const BUTTON_H = 31;
export const BUTTON_FRAMES = 16;
// Centiseconds per frame. Half the masthead's pace: on someone else's page the
// button should read as weather, not as a blink.
export const BUTTON_DELAY = 140;

const W = BUTTON_W;
const H = BUTTON_H;
const N = BUTTON_FRAMES;
const TAU = 2 * Math.PI;

const NIGHT = [10, 12, 24]; // --night
const EDGE = [43, 48, 80]; // --edge
const INK = [236, 234, 250]; // --ink
const STAR = [238, 242, 255];

// The wordmark. Silkscreen at 12px, thresholded once and kept as pixels —
// 12px is 1.5 pixels per grid unit, and the S that fell out of that is the
// point (Hat: "spiral galaxy"). Everything else was hand-squared: the dot is
// a true 2×2, the T's bar is symmetric. The dot sits at the CHAOS·HAT word
// boundary, raised to mid-height, not at the domain's ".at" — that break is
// the one place the eye should not stop. Never regenerate this from the font.
const WORDMARK = [
  "..###....##...##....###......###......#####......##...##...####...######",
  ".#####...##...##...#####.....###.....#####.......##...##..######..######",
  "##...##..##...##..##...##..##...##..##...........##...##..##..##....##..",
  "##.......#######..#######..##...##....###....##..#######..######....##..",
  "##.......#######..#######..##...##....###....##..#######..######....##..",
  "##...##..##...##..##...##..##...##.......##......##...##..##..##....##..",
  ".#####...##...##..##...##..#######...#####.......##...##..##..##....##..",
  "..###....##...##..##...##....###....#####........##...##..##..##....##..",
];

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// ---------------------------------------------------------------- raster

class Raster {
  constructor() {
    this.d = new Float32Array(W * H * 3);
  }
  blend(x, y, c, a) {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 3;
    this.d[i] += (c[0] - this.d[i]) * a;
    this.d[i + 1] += (c[1] - this.d[i + 1]) * a;
    this.d[i + 2] += (c[2] - this.d[i + 2]) * a;
  }
  rect(x, y, w, h, c, a = 1) {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) this.blend(xx, yy, c, a);
  }
  bytes() {
    const out = new Uint8Array(W * H * 3);
    for (let i = 0; i < out.length; i += 1) out[i] = Math.max(0, Math.min(255, Math.round(this.d[i])));
    return out;
  }
}

// Separable gaussian over a W×H coverage buffer.
const blur = (src, sigma) => {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  for (let i = 0; i < k.length; i += 1) k[i] /= sum;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      let v = 0;
      for (let i = -r; i <= r; i += 1) {
        const xx = x + i;
        if (xx >= 0 && xx < W) v += src[y * W + xx] * k[i + r];
      }
      tmp[y * W + x] = v;
    }
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      let v = 0;
      for (let i = -r; i <= r; i += 1) {
        const yy = y + i;
        if (yy >= 0 && yy < H) v += tmp[yy * W + x] * k[i + r];
      }
      out[y * W + x] = v;
    }
  return out;
};

// The header's curtain, with its spatial frequencies scaled from 120 columns
// to 44 (see headerSheet in aurora.js for the unscaled terms). Same layers:
// a blurred glow along the lit edge, then deep / mid / edge rects per column,
// brightness pulsing in place across the 16 frames rather than marching.
const sky = (r, pal, k, { yEdge, hBase, op, glowW }) => {
  const theta = (k / N) * TAU;
  const F = k / N;
  const step = 2;
  const ebb = 1 + 0.08 * Math.sin(TAU * F + 1.9);
  const edgeY = [];
  const rects = [];
  for (let x = 0; x <= W; x += step) {
    const t = x / W;
    const y =
      yEdge +
      2.4 * Math.sin(TAU * 1 * t + 1.3) +
      1.2 * Math.sin(TAU * 2 * t + 4.1) +
      0.6 * Math.sin(TAU * 2 * t + theta);
    const yb = Math.round(y);
    edgeY.push(y);
    const n = 0.5 + 0.5 * Math.sin(TAU * 3 * t + 2.6 + theta) * Math.sin(TAU * 5 * t + 1.3 + theta);
    const pulse =
      0.55 * Math.sin(TAU * 2 * t + 1.1) * Math.sin(TAU * 1 * F + 0.7) +
      0.35 * Math.sin(TAU * 3 * t + 4.2) * Math.sin(TAU * 2 * F + 2.9) +
      0.28 * Math.sin(TAU * 5 * t + 2.0) * Math.sin(TAU * 3 * F + 5.0);
    const b = Math.min(1, Math.max(0.18, 0.6 + 0.36 * pulse));
    const flick = 0.85 + 0.15 * Math.sin(TAU * 4 * t + 0.5) * Math.sin(TAU * 2 * F + 4.0);
    const ray = hBase * (0.9 + 1.5 * n);
    rects.push([x, Math.round(yb - ray), step, Math.round(ray * 0.7), hexRgb(pal.deep), Math.max(0.08, 0.32 * b)]);
    rects.push([x, Math.round(yb - ray * 0.5), step, Math.round(ray * 0.5), hexRgb(pal.mid), Math.max(0.07, 0.58 * b * flick)]);
    rects.push([x, yb - 2, step, 3, hexRgb(pal.edge), Math.max(0.1, 0.95 * b * flick)]);
  }
  // Glow: a stroke glowW thick along the edge, blurred, at 15% — the same
  // three numbers the SVG version uses (stroke-width, stdDeviation, opacity).
  const cover = new Float32Array(W * H);
  for (let x = 0; x < W; x += 1) {
    const yc = edgeY[Math.floor(x / step)];
    for (let y = 0; y < H; y += 1) if (Math.abs(y + 0.5 - yc) <= glowW / 2) cover[y * W + x] = 1;
  }
  const soft = blur(cover, glowW / 3);
  const glow = hexRgb(pal.glow);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) r.blend(x, y, glow, op * ebb * 0.15 * soft[y * W + x]);
  for (const [x, y, w, h, c, a] of rects) r.rect(x, y, w, h, c, op * ebb * a);
};

const wordmark = (r) => {
  const w = WORDMARK[0].length;
  const h = WORDMARK.length;
  const x0 = Math.round((W - w) / 2);
  const top = 14 - Math.ceil(h / 2);
  const ink = (fn) =>
    WORDMARK.forEach((row, y) => {
      for (let x = 0; x < w; x += 1) if (row[x] === "#") fn(x0 + x, top + y);
    });
  // One-pixel night halo first, so the name holds against any band behind it.
  ink((x, y) => {
    r.blend(x - 1, y, NIGHT, 1);
    r.blend(x + 1, y, NIGHT, 1);
    r.blend(x, y - 1, NIGHT, 1);
    r.blend(x, y + 1, NIGHT, 1);
  });
  ink((x, y) => r.blend(x, y, INK, 1));
};

const frame = (pal, k) => {
  const r = new Raster();
  r.rect(0, 0, W, H, NIGHT);
  r.blend(5, 4, STAR, 0.7);
  r.blend(82, 6, STAR, 0.7);
  r.blend(44, 2, STAR, 0.45);
  // The "veil": the whole tile is sky at the masthead's own opacity, the lit
  // edge low, rays reaching up behind the name.
  sky(r, pal, k, { yEdge: 25.5, hBase: 10, op: 0.42, glowW: 12 });
  wordmark(r);
  r.rect(0, 0, W, 1, EDGE);
  r.rect(0, H - 1, W, 1, EDGE);
  r.rect(0, 0, 1, H, EDGE);
  r.rect(W - 1, 0, 1, H, EDGE);
  return r.bytes();
};

// Same hue rule as the masthead: the date picks it, so a hotlinked button
// wears the day's sky like the site does.
export const buttonFrames = (dateStr) => {
  const pal = palette((hashOf(dateStr) % 360000) / 1000);
  return Array.from({ length: N }, (_, k) => frame(pal, k));
};

// ------------------------------------------------------------------- png

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

export const encodePng = (rgb) => {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y += 1) {
    raw[y * (W * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
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
  return { png: encodePng(frames[0]), gif: encodeGif(frames) };
};
