#!/usr/bin/env node
/**
 * Generates WAYPOINT's application / tray icon — dependency-free.
 *
 *   assets/tray-icon.png   256x256  (tray + window icon, read at runtime)
 *   build/icon.png         256x256  (electron-builder → exe/installer .ico)
 *
 * Draws the brand mark procedurally (chamfered acid tile, geometric "W",
 * two technical tick marks) and encodes a PNG with Node's built-in zlib,
 * so it reproduces identically on any machine with no image libraries.
 *
 * Run: node scripts/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const SIZE = 256;
const SS = 4; // supersampling factor (antialiasing)
const N = SIZE * SS;

const ACID = [0xff, 0xfa, 0x00];
const INK = [0x19, 0x19, 0x19];

/* ----------------------------------------------------------- geometry -- */
const poly = (...pts) => pts;

/** Thick line segment → quad polygon. */
function stroke(x1, y1, x2, y2, w) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  return poly(
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  );
}

const rect = (x, y, w, h) => poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------- layout -- */
const m = 0.085; // outer margin (fraction of canvas)
const c = 0.17; // chamfer size on the top-right corner
const x0 = m;
const x1 = 1 - m;
const y0 = m;
const y1 = 1 - m;

const tile = poly([x0, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1], [x0, y1]);

// geometric W inside the tile
const wx0 = 0.225;
const wx1 = 0.775;
const wy0 = 0.33;
const wy1 = 0.73;
const sw = 0.108; // stroke width
const px = (t) => wx0 + (wx1 - wx0) * t;
const py = (t) => wy0 + (wy1 - wy0) * t;

const wStrokes = [
  stroke(px(0.02), py(0), px(0.27), py(1), sw),
  stroke(px(0.27), py(1), px(0.5), py(0.38), sw),
  stroke(px(0.5), py(0.38), px(0.73), py(1), sw),
  stroke(px(0.73), py(1), px(0.98), py(0), sw),
];

// technical tick marks near the chamfer
const ticks = [rect(0.600, 0.168, 0.085, 0.026), rect(0.655, 0.222, 0.085, 0.026)];

/* -------------------------------------------------------------- raster -- */
const acc = new Float32Array(SIZE * SIZE * 4);

for (let sy = 0; sy < N; sy++) {
  const fy = (sy + 0.5) / N;
  for (let sx = 0; sx < N; sx++) {
    const fx = (sx + 0.5) / N;
    let rgb = null;
    if (pointInPoly(fx, fy, tile)) {
      rgb = ACID;
      for (const s of wStrokes) if (pointInPoly(fx, fy, s)) { rgb = INK; break; }
      if (rgb === ACID) for (const t of ticks) if (pointInPoly(fx, fy, t)) { rgb = INK; break; }
    }
    if (!rgb) continue;
    const dx = Math.floor(sx / SS);
    const dy = Math.floor(sy / SS);
    const o = (dy * SIZE + dx) * 4;
    acc[o] += rgb[0];
    acc[o + 1] += rgb[1];
    acc[o + 2] += rgb[2];
    acc[o + 3] += 255;
  }
}

const per = SS * SS;
const px8 = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) {
  const o = i * 4;
  const a = acc[o + 3] / per;
  if (a <= 0) continue;
  // un-premultiply so edges keep full colour with partial alpha
  const cov = acc[o + 3] / 255 || 1;
  px8[o] = Math.round(acc[o] / cov);
  px8[o + 1] = Math.round(acc[o + 1] / cov);
  px8[o + 2] = Math.round(acc[o + 2] / cov);
  px8[o + 3] = Math.round(a);
}

/* ---------------------------------------------------------- png encode -- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c2 = n;
    for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 0xedb88320 ^ (c2 >>> 1) : c2 >>> 1;
    t[n] = c2 >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c2 = 0xffffffff;
  for (const b of buf) c2 = CRC_TABLE[(c2 ^ b) & 0xff] ^ (c2 >>> 8);
  return (c2 ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = encodePng(SIZE, SIZE, px8);
mkdirSync("assets", { recursive: true });
mkdirSync("build", { recursive: true });
writeFileSync("assets/tray-icon.png", png);
writeFileSync("build/icon.png", png);
console.log(`assets/tray-icon.png + build/icon.png written (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`);
