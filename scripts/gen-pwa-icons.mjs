#!/usr/bin/env node
/**
 * gen-pwa-icons.mjs — writes the PWA install icons with no dependencies.
 *
 * Renders a solid #f4c542 rounded-rect card with five dark dice pips (a "5")
 * into a true RGBA PNG for 192² and 512², straight through node:zlib: each
 * scanline gets the required deflate filter byte 0, the pixel data is
 * deflate-compressed, and CRC-32 chunk framing is hand-rolled (table built
 * once per run). After generating, the script parses every file back —
 * signature, IHDR geometry, IDAT inflation, sampled pixels — and only reports
 * success if the bytes round-trip; a broken generator fails the build, not
 * the install sheet.
 *
 * Usage: node scripts/gen-pwa-icons.mjs
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GOLD = [244, 197, 66]; // #f4c542 — matches the app's accent + theme_color.
const DARK = [26, 26, 33]; // #1a1a21 axis pips, echoing the dice faces.
const SIZES = [192, 512];
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable = null;

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'BankGame', 'client', 'public', 'icons');

// ---- CRC-32 (PNG's chunk checksum is its own flavour of CRC-32/ISO-HDLC) ----

function crcTable_() {
  if (crcTable) return crcTable;
  crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }
  return crcTable;
}

function crc32(buf) {
  const table = crcTable_();
  let c = -1; // bitwise complement of 0xffffffff
  for (const b of buf) {
    c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const IEND = chunk('IEND', Buffer.alloc(0));

// ---- Geometry: card, pips, and the pixel raster -------------------------------

function inCard(x, y, size, radius) {
  // Inside the rounded rect: true in the middle band on either axis; corners
  // fall back to the corner circle.
  if (x >= radius && x < size - radius) return true;
  if (y >= radius && y < size - radius) return true;
  const cx = x < radius ? radius : size - 1 - radius;
  const cy = y < radius ? radius : size - 1 - radius;
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Pip list for a die "5" — four corners + the middle of the card. */
function pips(size) {
  const radius = Math.round(size * (size >= 512 ? 0.14 : 0.14));
  const pipR = Math.max(6, Math.round(size * 0.075));
  const arm = Math.round(size * 0.2);
  const lows = Math.round(size * 0.8);
  return [
    [arm, arm],
    [lows, arm],
    [Math.round(size * 0.5), Math.round(size * 0.5)],
    [arm, lows],
    [lows, lows],
  ].map(([px, py]) => ({ cx: px, cy: py, r: pipR }))
    .filter((p) => inCard(p.cx, p.cy, size, radius)); // keep pips inside the card corners
}

function render(size) {
  const radius = Math.round(size * 0.14);
  const pills = pips(size);
  // RGBA, one filter byte per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const off = row + 1 + x * 4;
      if (!inCard(x, y, size, radius)) {
        raw[off + 3] = 0; // transparent corners — nothing but the gold card below
        continue;
      }
      const pip = pills.find((p) => (x - p.cx) ** 2 + (y - p.cy) ** 2 <= p.r * p.r);
      const [r, g, b] = pip ? DARK : GOLD;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = 255;
    }
  }
  return raw;
}

function png(size) {
  const raw = render(size);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    IEND,
  ]);
}

// ---- Self-check: parse the bytes back, pixel-sampling the inflation ----------

function assertValid(file, buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error(`${file}: bad signature`);
  let off = 8;
  const width = (() => {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type !== 'IHDR' || len !== 13) throw new Error(`${file}: bad IHDR framing`);
    // IHDR data: width (4), height (4), bit depth (1), colour type (1), rest (3).
    off += 8;
    const w = buf.readUInt32BE(off);
    const h = buf.readUInt32BE(off + 4);
    if (buf[off + 8] !== 8 || buf[off + 9] !== 6) throw new Error(`${file}: not RGBA8`);
    off += 13;
    return { w, h };
  })();
  if (width.w !== width.h || !SIZES.includes(width.w)) throw new Error(`${file}: bad geometry ${width.w}x${width.h}`);
  // IDAT(s) — the pixels — then IEND, in order.
  const idatChunks = [];
  for (;;) {
    off += 4; // CRC of previous chunk
    if (off >= buf.length) throw new Error(`${file}: truncated before IEND`);
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IEND') break;
    if (type !== 'IDAT') throw new Error(`${file}: unexpected ${type} chunk`);
    idatChunks.push(buf.subarray(off + 8, off + 8 + len));
    off += 8 + len;
  }
  const pixels = inflateSync(Buffer.concat(idatChunks));
  const size = width.w;
  const atPixel = (x, y) => {
    const row = y * (size * 4 + 1) + 1;
    return [pixels[row + x * 4], pixels[row + x * 4 + 1], pixels[row + x * 4 + 2], pixels[row + x * 4 + 3]];
  };
  const corner = atPixel(2, 2);
  if (corner[3] !== 0) throw new Error(`${file}: corner should be transparent`);
  const gold = atPixel(Math.round(size * 0.3), Math.round(size * 0.75));
  if (gold[3] !== 255 || Math.abs(gold[0] - 244) > 4) throw new Error(`${file}: gold card missing`);
  const pip = atPixel(Math.round(size * 0.5), Math.round(size * 0.5));
  if (pip[0] > 80) throw new Error(`${file}: centre pip missing`);
  return size;
}

// ---- Generate ----------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = join(outDir, `app-icon-${size}.png`);
  const buf = png(size);
  assertValid(file, buf);
  writeFileSync(file, buf);
  console.log(`wrote ${file} (${buf.length} bytes)`);
}
