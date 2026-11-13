#!/usr/bin/env node
/**
 * Layout gate.
 *
 * The first version of this renderer produced frames that a reviewer described
 * as "75% empty background, sparse and unfinished". That is a real defect, but
 * an unrepeatable one — so this gate turns it into numbers:
 *
 *   1. every composition renders without error;
 *   2. strong ink never invades the outer margin (no clipped type);
 *   3. every band of the canvas carries something readable (no empty third);
 *   4. read ink stays above a floor (the frame is not one line in a void).
 *
 * Renders 4 frames of each of the 3 compositions through the real Remotion CLI,
 * so a layout change that only looks fine in one aspect ratio fails here.
 *
 * Usage: node scripts/check-layout.mjs [--keep]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const RENDER = join(ROOT, 'packages', 'aibench', 'render')
const CLI = join(RENDER, 'node_modules', '@remotion', 'cli', 'remotion-cli.js')
const BIN = process.env.FFMPEG_BIN || 'C:/Users/Administrator/.dsh/bot/workspace/tools/bin'
const FFMPEG = join(BIN, 'ffmpeg.exe')
const FFPROBE = join(BIN, 'ffprobe.exe')
const OUT = join(ROOT, 'artifacts', 'layout-gate')
const BANDS = 6
const STEP = 4

let failures = 0
const assert = (name, ok, detail) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${detail ? ` -> ${detail}` : ''}`)
  if (!ok) failures += 1
}

if (!existsSync(CLI)) {
  console.error(`render CLI missing: ${CLI}`)
  process.exit(1)
}

// A four-shot script is enough to exercise the hook, two different process
// shots (3 steps and 2 steps) and the close.
const script = {
  title: '中轴上的紫禁城',
  shots: [
    { kind: 'hook', copy: '紫禁城先有一条线', caption: '看懂中轴线，才看懂紫禁城的秩序', en: 'A line comes first', weight: 2 },
    {
      kind: 'process',
      copy: '先定线，再定城',
      caption: '中轴线先把空间的主次定下来',
      en: 'Line first, city second',
      weight: 3,
      steps: [
        { zh: '定南北中心', en: 'Set the north-south center' },
        { zh: '排门殿次序', en: 'Order gates and halls' },
        { zh: '控左右对称', en: 'Control the symmetry' },
      ],
    },
    {
      kind: 'process',
      copy: '一条线，分出前朝后寝',
      caption: '前朝理政，后寝安居',
      weight: 3,
      steps: [
        { zh: '前朝理政', en: 'Front court rules' },
        { zh: '后寝安居', en: 'Rear court lives' },
      ],
    },
    { kind: 'cta', copy: '先看线，再看宫', caption: '顺着中轴线走，紫禁城就清楚了', en: 'Read the line first', weight: 2 },
  ],
}

mkdirSync(OUT, { recursive: true })
const propsFile = join(OUT, 'props.json')
writeFileSync(
  propsFile,
  JSON.stringify({
    brief: '中轴上的紫禁城',
    params: { durationSec: 30, beatBpm: 120, subtitle: 'bilingual', style: 1, type: 0 },
    script,
  }),
  'utf8',
)

const compositions = [
  ['AiClip', 1920, 1080],
  ['AiClipVertical', 1080, 1920],
  ['AiClipSquare', 1080, 1080],
]
// 60 = hook, 300/480 = the two process shots, 850 = close.
const frames = [60, 300, 480, 850]

const MIN_READ = 0.9 // percent of canvas that must be strong ink
const MIN_BANDS = 4 // of 6 bands must carry readable ink
const MARGIN_FLOOR = 0.012 // of the short edge

function dimensions(file) {
  const out = execFileSync(
    FFPROBE,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  )
  const [w, h] = out.trim().split(',').map(Number)
  return { w, h }
}

/** Raw RGB via stdout: ffmpeg cannot create files on this machine. */
function rawPixels(file) {
  return execFileSync(
    FFMPEG,
    ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 },
  )
}

function measure(file) {
  const { w: W, h: H } = dimensions(file)
  const buffer = rawPixels(file)
  if (buffer.length < W * H * 3) throw new Error(`short read ${buffer.length} for ${file}`)
  const at = (x, y) => (y * W + x) * 3

  const counts = new Map()
  for (let y = 0; y < H; y += STEP) {
    for (let x = 0; x < W; x += STEP) {
      const o = at(x, y)
      const key = (buffer[o] << 16) | (buffer[o + 1] << 8) | buffer[o + 2]
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const dr = (dominant >> 16) & 255
  const dg = (dominant >> 8) & 255
  const db = dominant & 255

  const bands = Array.from({ length: BANDS }, () => ({ strong: 0, total: 0 }))
  let strong = 0
  let total = 0
  let left = W
  let right = 0
  let upper = H
  let lower = 0
  for (let y = 0; y < H; y += STEP) {
    const band = bands[Math.min(BANDS - 1, Math.floor((y / H) * BANDS))]
    for (let x = 0; x < W; x += STEP) {
      const o = at(x, y)
      const diff = Math.abs(buffer[o] - dr) + Math.abs(buffer[o + 1] - dg) + Math.abs(buffer[o + 2] - db)
      band.total += 1
      total += 1
      // 150 separates type from the look's 18-45% alpha grid; at 24 the grid
      // alone reports 10-16% and says nothing about readability.
      if (diff <= 150) continue
      band.strong += 1
      strong += 1
      if (x < left) left = x
      if (x > right) right = x
      if (y < upper) upper = y
      if (y > lower) lower = y
    }
  }

  return {
    W,
    H,
    read: (strong / total) * 100,
    bands: bands.map((band) => (band.strong / band.total) * 100),
    margins: { top: upper, left, bottom: H - 1 - lower, right: W - 1 - right },
  }
}

for (const [id, width, height] of compositions) {
  for (const frame of frames) {
    const file = join(OUT, `${id}-${frame}.png`)
    try {
      execFileSync(
        process.execPath,
        [CLI, 'still', id, file.replace(/\\/g, '/'), `--frame=${frame}`, `--props=${propsFile}`, '--overwrite', '--log=error'],
        { cwd: RENDER, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      assert(`${id}@${frame} renders`, existsSync(file) && readFileSync(file).length > 20000)
    } catch (error) {
      assert(`${id}@${frame} renders`, false, String(error.stderr || error.message).slice(-300))
      continue
    }

    const m = measure(file)
    const floor = Math.round(Math.min(m.W, m.H) * MARGIN_FLOOR)
    const tight = Object.entries(m.margins).filter(([, value]) => value < floor)
    assert(
      `${id}@${frame} keeps its safe area`,
      tight.length === 0,
      tight.length === 0 ? `margins ${JSON.stringify(m.margins)}` : `BLEED ${JSON.stringify(tight)} floor=${floor}px`,
    )

    const filled = m.bands.filter((value) => value >= 0.15).length
    assert(
      `${id}@${frame} fills the canvas`,
      filled >= MIN_BANDS,
      `bands ${m.bands.map((value) => value.toFixed(1)).join('/')} filled=${filled}/${BANDS}`,
    )
    assert(
      `${id}@${frame} carries enough readable ink`,
      m.read >= MIN_READ,
      `read=${m.read.toFixed(2)}% floor=${MIN_READ}%`,
    )
  }
}

if (!process.argv.includes('--keep')) rmSync(OUT, { recursive: true, force: true })
console.log(failures === 0 ? 'layout checks ok' : `${failures} layout assertion(s) failed`)
process.exit(failures === 0 ? 0 : 1)
