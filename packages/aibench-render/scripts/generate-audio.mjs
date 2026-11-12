#!/usr/bin/env node
/**
 * Procedural audio for bnpanel-render.
 *
 * Pure Node — no npm dependencies. Writes 16-bit PCM mono WAV files:
 *   public/audio/bgm/bed-120bpm.wav   a seamless 120 BPM bed (arpeggio + kick)
 *   public/audio/sfx/tick.wav          short UI tick
 *   public/audio/sfx/reveal.wav        short reveal chime
 *   public/audio/sfx/whoosh.wav        noise whoosh
 *
 * Everything is synthesised from the sample buffer, so the output is byte
 * deterministic: running the script twice produces identical files.
 *
 *   node scripts/generate-audio.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SR = 44100;

/* ------------------------------------------------------------------ */
/* WAV writer                                                         */
/* ------------------------------------------------------------------ */

/** @param {Float32Array|number[]} samples */
function encodeWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // format = PCM
  buf.writeUInt16LE(1, 22); // channels
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = samples[i];
    if (!Number.isFinite(s)) s = 0;
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/* ------------------------------------------------------------------ */
/* tiny helpers                                                       */
/* ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const expEnv = (t, decay) => Math.exp(-t / decay);
const attack = (t, a) => (t < a ? t / a : 1);

/** Deterministic pseudo random in [-1, 1] — no Math.random anywhere. */
function noiseAt(i) {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Soft clip. */
const sat = (x) => Math.tanh(x);

/* ------------------------------------------------------------------ */
/* BGM: 120 BPM bed, exactly 8 seconds (16 beats) so it loops cleanly   */
/* ------------------------------------------------------------------ */

function synthBed() {
  const beat = 60 / 120; // 0.5 s
  const beats = 16;
  const total = Math.round(beats * beat * SR);
  const out = new Float32Array(total);

  // Am – F – C – G, one chord per beat-pair (2 beats each).
  const chords = [
    [220.0, 261.63, 329.63], // A minor
    [174.61, 220.0, 261.63], // F major
    [261.63, 329.63, 392.0], // C major
    [196.0, 246.94, 293.66], // G major
  ];
  const bass = [110.0, 87.31, 130.81, 98.0];

  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const beatIndex = Math.floor(t / beat);
    const chord = chords[Math.floor(beatIndex / 2) % chords.length];
    const root = bass[Math.floor(beatIndex / 2) % bass.length];

    /* --- kick on every beat ------------------------------------- */
    const tInBeat = t - beatIndex * beat;
    let kick = 0;
    if (tInBeat < 0.28) {
      const f = 45 + 95 * expEnv(tInBeat, 0.035);
      kick = Math.sin(2 * Math.PI * f * tInBeat) * expEnv(tInBeat, 0.075) * 0.62;
    }

    /* --- eighth-note arpeggio ----------------------------------- */
    const eighth = beat / 2;
    const eIndex = Math.floor(t / eighth);
    const tInEighth = t - eIndex * eighth;
    const step = eIndex % 6;
    const noteIdx = step % 3;
    const octave = step >= 3 ? 2 : 1;
    const noteHz = chord[noteIdx] * octave;
    let pluck = 0;
    if (tInEighth < 0.4) {
      const env = attack(tInEighth, 0.004) * expEnv(tInEighth, 0.13);
      const s = Math.sin(2 * Math.PI * noteHz * tInEighth);
      const s2 = Math.sin(2 * Math.PI * noteHz * 2 * tInEighth) * 0.25;
      pluck = sat((s + s2) * env) * 0.2;
    }

    /* --- sustained bass pad -------------------------------------- */
    const padEnv = 0.5 + 0.5 * Math.cos((2 * Math.PI * t) / (beat * 4));
    const pad = Math.sin(2 * Math.PI * root * t) * 0.07 * padEnv;

    /* --- soft hats on off-beats ---------------------------------- */
    let hat = 0;
    if (eIndex % 2 === 1 && tInEighth < 0.08) {
      hat = noiseAt(i) * expEnv(tInEighth, 0.022) * 0.055;
    }

    out[i] = kick + pluck + pad + hat;
  }

  // 3 ms de-click at both edges so the loop point is silent-safe.
  const edge = Math.round(0.003 * SR);
  for (let i = 0; i < edge; i++) {
    const g = i / edge;
    out[i] *= g;
    out[total - 1 - i] *= g;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* SFX                                                                */
/* ------------------------------------------------------------------ */

function synthTick() {
  const dur = 0.07;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = attack(t, 0.001) * expEnv(t, 0.014);
    const tone = Math.sin(2 * Math.PI * 1750 * t) * 0.5 + Math.sin(2 * Math.PI * 2600 * t) * 0.25;
    out[i] = sat(tone * env) * 0.75 + noiseAt(i) * env * 0.12;
  }
  return out;
}

function synthReveal() {
  const dur = 0.62;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = t / dur;
    const f = 420 + 900 * p * p;
    const env = attack(t, 0.012) * expEnv(t, 0.26);
    const a = Math.sin(2 * Math.PI * f * t) * env * 0.32;
    const b = Math.sin(2 * Math.PI * (f * 1.5) * t + 0.4) * env * 0.16;
    const c = Math.sin(2 * Math.PI * 1320 * t) * expEnv(t, 0.09) * 0.12;
    out[i] = sat(a + b + c);
  }
  return out;
}

function synthWhoosh() {
  const dur = 1.0;
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = t / dur;
    const env = Math.sin(Math.PI * Math.min(1, p)) ** 1.6;
    // one-pole low pass whose cutoff sweeps upward
    const cutoff = 0.02 + 0.5 * p * p;
    lp += cutoff * (noiseAt(i) - lp);
    const tone = Math.sin(2 * Math.PI * (180 + 520 * p) * t) * 0.18 * env;
    out[i] = sat(lp * env * 1.7 + tone);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

const targets = [
  ['public/audio/bgm/bed-120bpm.wav', synthBed()],
  ['public/audio/sfx/tick.wav', synthTick()],
  ['public/audio/sfx/reveal.wav', synthReveal()],
  ['public/audio/sfx/whoosh.wav', synthWhoosh()],
];

for (const [rel, samples] of targets) {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, encodeWav(samples));
  console.log(`wrote ${rel} (${(samples.length / SR).toFixed(2)}s, ${samples.length} samples)`);
}
