#!/usr/bin/env node
/** Generate runtime and Windows icons from the unchanged official PNG master.
 * No external image tool is required. The PNG decoder intentionally supports
 * the master format (non-interlaced, 8-bit RGBA) and fails on other formats.
 * Each output is proportionally contained and centered, never cropped.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../src/assets/waypoint-emblem.png", import.meta.url));
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!source.subarray(0, 8).equals(signature)) throw new Error("The emblem master must be a PNG");
let width = 0, height = 0, formatValid = false;
const chunks = [];
for (let pos = 8; pos + 12 <= source.length;) {
  const length = source.readUInt32BE(pos), type = source.toString("ascii", pos + 4, pos + 8);
  const end = pos + 12 + length;
  if (end > source.length) throw new Error("Truncated emblem PNG");
  const data = source.subarray(pos + 8, pos + 8 + length);
  if (type === "IHDR") {
    width = data.readUInt32BE(0); height = data.readUInt32BE(4);
    formatValid = data[8] === 8 && data[9] === 6 && data[10] === 0 && data[11] === 0 && data[12] === 0;
  } else if (type === "IDAT") chunks.push(data);
  if (type === "IEND") break;
  pos = end;
}
if (!formatValid || !width || !height || !chunks.length) throw new Error("Emblem master must be non-interlaced 8-bit RGBA PNG");
const scan = inflateSync(Buffer.concat(chunks));
const stride = width * 4;
if (scan.length !== (stride + 1) * height) throw new Error("Invalid emblem scanlines");
const pixels = Buffer.alloc(stride * height);
function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}
for (let y = 0; y < height; y++) {
  const filter = scan[y * (stride + 1)];
  if (filter > 4) throw new Error("Unsupported emblem PNG filter");
  for (let x = 0; x < stride; x++) {
    const offset = y * stride + x, left = x >= 4 ? pixels[offset - 4] : 0;
    const up = y ? pixels[offset - stride] : 0;
    const upperLeft = y && x >= 4 ? pixels[offset - stride - 4] : 0;
    const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
    pixels[offset] = (scan[y * (stride + 1) + 1 + x] + predictor) & 255;
  }
}

/** Area averaging in premultiplied alpha keeps thin edges crisp at tray size. */
function contain(size) {
  const scale = size / Math.max(width, height);
  const drawWidth = Math.max(1, Math.round(width * scale)), drawHeight = Math.max(1, Math.round(height * scale));
  const left = Math.floor((size - drawWidth) / 2), top = Math.floor((size - drawHeight) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let dy = 0; dy < drawHeight; dy++) {
    const y0 = dy * height / drawHeight, y1 = (dy + 1) * height / drawHeight;
    for (let dx = 0; dx < drawWidth; dx++) {
      const x0 = dx * width / drawWidth, x1 = (dx + 1) * width / drawWidth;
      let r = 0, g = 0, b = 0, alpha = 0, total = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const weight = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = (sy * width + sx) * 4, a = pixels[i + 3] / 255;
          r += pixels[i] * a * weight; g += pixels[i + 1] * a * weight; b += pixels[i + 2] * a * weight;
          alpha += a * weight; total += weight;
        }
      }
      const o = ((top + dy) * size + left + dx) * 4;
      if (alpha > 0) { out[o] = Math.round(r / alpha); out[o + 1] = Math.round(g / alpha); out[o + 2] = Math.round(b / alpha); }
      out[o + 3] = Math.round(alpha / total * 255);
    }
  }
  return out;
}
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, {level:9})), chunk("IEND", Buffer.alloc(0))]);
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => encodePng(size, contain(size)));
// Windows Vista and later accept PNG-encoded frames inside a standard ICO.
const header = Buffer.alloc(6 + sizes.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16, size = sizes[i], png = images[i];
  header[entry] = size === 256 ? 0 : size; header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += png.length;
}
mkdirSync("assets", {recursive:true}); mkdirSync("build", {recursive:true});
writeFileSync("assets/tray-icon.png", images.at(-1));
writeFileSync("build/icon.png", images.at(-1));
writeFileSync("build/icon.ico", Buffer.concat([header, ...images]));
console.log(`Generated official emblem icons: PNG 256px and ICO ${sizes.join("/")}px.`);
