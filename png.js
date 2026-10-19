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
