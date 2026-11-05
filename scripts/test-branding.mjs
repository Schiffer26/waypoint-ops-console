import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
const master = read('src/assets/waypoint-emblem.png');
assert.equal(createHash('sha256').update(master).digest('hex'), '8497e9968b91aebe1211987e6cb9fd2f7e9f1e0e18f2a2f72e49c27b841fd2f1', 'official master must remain unchanged');
assert.equal(createHash('sha256').update(read('src/assets/waypoint-operations-console-logo.png')).digest('hex'), 'f70ba883cfaa229be43c15caa97f16426add8d9887aace0e6512d27c551a20a3', 'original light boot artwork must remain unchanged');
assert.match(read('src/components/LightSystemInitialization.tsx').toString(), /waypoint-operations-console-logo\.png/);
assert.match(read('src/components/SystemInitialization.tsx').toString(), /waypoint-emblem\.png/);
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const tray = read('assets/tray-icon.png');
assert(tray.subarray(0,8).equals(signature));
assert.equal(tray.readUInt32BE(16), 256); assert.equal(tray.readUInt32BE(20), 256);
assert(tray.equals(read('build/icon.png')), 'packaging PNG and tray derive from the same master');
const ico = read('build/icon.ico'), sizes = [16,24,32,48,64,128,256];
assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), sizes.length);
let next = 6 + sizes.length * 16;
for (const [i, size] of sizes.entries()) {
  const e = 6 + i * 16, length = ico.readUInt32LE(e + 8), offset = ico.readUInt32LE(e + 12);
  assert.equal(ico[e] || 256, size); assert.equal(ico[e + 1] || 256, size);
  assert.equal(ico.readUInt16LE(e + 6), 32); assert.equal(offset, next);
  const png = ico.subarray(offset, offset + length); assert.equal(png.length, length);
  assert(png.subarray(0,8).equals(signature)); assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  if (size === 256) assert(png.equals(tray));
  next += length;
}
assert.equal(next, ico.length);
const config = read('electron-builder.yml').toString();
assert.match(config, /win:[\s\S]*?icon: build\/icon\.ico/);
assert.match(config, /installerIcon: build\/icon\.ico/);
assert.match(config, /uninstallerIcon: build\/icon\.ico/);
assert.match(read('electron/main.ts').toString(), /tray-icon\.png/);
console.log('Official master, generated tray and multi-resolution Windows icon references verified.');
