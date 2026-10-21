// A minimal PNG encoder: truecolour or truecolour+alpha, 8 bits, no filtering.
// Moved out of button.js when the masthead became a raster too — two images
// built from plain pixel buffers, one encoder. No canvas, no browser: the
// build stays a pure function of the date.
import zlib from "node:zlib";

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

// `px` is w*h*channels bytes, rows top to bottom; channels is 3 (RGB) or 4 (RGBA).
export const encodePng = (px, w, h, channels = 3) => {
  const row = w * channels;
  const raw = Buffer.alloc((row + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (row + 1)] = 0; // filter: none
    raw.set(px.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // truecolour (+alpha)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// Indexed colour (2026-10-21), for pixel art with a handful of inks. The
// masthead sheet is twenty frames that mostly repeat each other, but an RGBA
// frame is 57.6KB and deflate only looks back 32KB, so it could never see the
// frame before and the file grew linearly with the frame count. At one byte a
// pixel a frame is 14.4KB, the previous one is in the window, and the repeats
// cost almost nothing. Falls back to truecolour past 256 colours.
export const encodePngIndexed = (px, w, h) => {
  const index = new Map();
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const a = px[o + 3];
    const key = a === 0 ? -1 : (px[o] << 16) | (px[o + 1] << 8) | px[o + 2] | (a === 255 ? 0 : a * 2 ** 24);
    let k = index.get(key);
    if (k === undefined) {
      if (index.size === 256) return encodePng(px, w, h, 4);
      k = index.size;
      index.set(key, k);
    }
    idx[i] = k;
  }
  const plte = Buffer.alloc(index.size * 3);
  const trns = Buffer.alloc(index.size);
  for (const [key, k] of index) {
    if (key === -1) continue; // transparent: black, alpha 0
    plte[k * 3] = (key >> 16) & 255;
    plte[k * 3 + 1] = (key >> 8) & 255;
    plte[k * 3 + 2] = key & 255;
    trns[k] = key >= 2 ** 24 ? Math.floor(key / 2 ** 24) : 255;
  }
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y += 1) raw.set(idx.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("tRNS", trns),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
