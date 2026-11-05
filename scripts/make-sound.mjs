#!/usr/bin/env node
/**
 * Generates assets/notify-subtle.wav — WAYPOINT's SUBTLE notification tone.
 *
 * A short two-step rising blip (E6 → B6) with a soft exponential decay and a
 * faint harmonic, 16-bit / 44.1 kHz mono. Deliberately quiet and brief so it
 * reads as a console acknowledgement rather than an alert.
 *
 * Run: node scripts/make-sound.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 44100;
const DUR = 0.42;
const n = Math.floor(RATE * DUR);
const samples = new Float32Array(n);

const blip = (t, start, len, freq, gain) => {
  if (t < start || t > start + len) return 0;
  const u = (t - start) / len;
  const env = Math.pow(1 - u, 2.6) * Math.min(1, u * 60); // fast attack, soft tail
  const body = Math.sin(2 * Math.PI * freq * (t - start));
  const harm = 0.18 * Math.sin(2 * Math.PI * freq * 2 * (t - start));
  return env * (body + harm) * gain;
};

for (let i = 0; i < n; i++) {
  const t = i / RATE;
  let v = 0;
  v += blip(t, 0.0, 0.16, 1318.5, 0.3); // E6
  v += blip(t, 0.12, 0.3, 1975.5, 0.26); // B6
  samples[i] = Math.max(-1, Math.min(1, v));
}

const data = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(samples[i] * 32767 * 0.9), i * 2);

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

mkdirSync("assets", { recursive: true });
writeFileSync("assets/notify-subtle.wav", Buffer.concat([header, data]));
console.log(`assets/notify-subtle.wav written (${((44 + data.length) / 1024).toFixed(1)} KB)`);
