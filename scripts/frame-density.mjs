#!/usr/bin/env node
/**
 * Frame density report.
 *
 * "Looks sparse" is a real defect but an unmeasurable one, so measure the
 * measurable part: how much of the canvas actually carries ink. Converts each
 * PNG to raw RGB with ffmpeg (no image library on this machine), then reports,
 * per frame and per band, the share of pixels that differ from the frame's own
 * dominant colour. An empty band is a wasted band.
 *
 * Two thresholds, because one is not enough: `ink` (>24) counts the look's
 * grid and grain, `read` (>150) counts what a viewer can actually read. A frame
 * can be 40% ink and still be unreadable.
 *
 * Usage: node scripts/frame-density.mjs [dir] [name-filter]
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const BIN = process.env.FFMPEG_BIN || 'C:/Users/Administrator/.dsh/bot/workspace/tools/bin'
const FFMPEG = join(BIN, 'ffmpeg.exe')
const FFPROBE = join(BIN, 'ffprobe.exe')
const dir = process.argv[2] || 'D:/AI/Vibe/AiBench/artifacts/forbidden-city'
const filter = process.argv[3] || ''
const BANDS = 6
const STEP = 4

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.png'))
  .filter((name) => (filter ? name.includes(filter) : true))
  .sort()

if (files.length === 0) {
  console.error(`no PNG frames in ${dir}`)
  process.exit(1)
}

/** Read the real canvas size: the three compositions differ. */
function dimensions(file) {
  const out = execFileSync(
    FFPROBE,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  )
  const [w, h] = out.trim().split(',').map(Number)
  return { w, h }
}

/** Percentile of luminance distance from the dominant colour, for a feel of spread. */
function report(file) {
  const path = join(dir, file)
  const { w: W, h: H } = dimensions(path)
  // Pipe to stdout instead of writing a file: ffmpeg is denied file creation
  // anywhere on this machine (the OS temp dir included), but reading a PNG and
  // writing raw frames to a pipe are both allowed.
  const buffer = execFileSync(
    FFMPEG,
    ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 },
  )

  const pixels = W * H
  if (buffer.length < pixels * 3) return `${file}: short read ${buffer.length}`

  const at = (x, y) => (y * W + x) * 3
  // Exact colours, not 4-bit buckets: quantising to a bucket floor puts up to
  // 15 levels of error into every channel, which is enough to make a flat
  // background read as 100% ink.
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
  let ink = 0
  let strong = 0
  let total = 0
  const box = { x1: W, y1: H, x2: 0, y2: 0 }
  for (let y = 0; y < H; y += STEP) {
    const band = bands[Math.min(BANDS - 1, Math.floor((y / H) * BANDS))]
    for (let x = 0; x < W; x += STEP) {
      const o = at(x, y)
      const diff = Math.abs(buffer[o] - dr) + Math.abs(buffer[o + 1] - dg) + Math.abs(buffer[o + 2] - db)
      band.total += 1
      total += 1
      if (diff > 24) ink += 1
      if (diff > 150) {
        band.strong += 1
        strong += 1
        if (x < box.x1) box.x1 = x
        if (y < box.y1) box.y1 = y
        if (x > box.x2) box.x2 = x
        if (y > box.y2) box.y2 = y
      }
    }
  }

  const pct = ((ink / total) * 100).toFixed(1)
  const strongPct = ((strong / total) * 100).toFixed(1)
  const perBand = bands.map((band) => ((band.strong / band.total) * 100).toFixed(0).padStart(3))
  const emptyBands = bands.filter((band) => band.strong / band.total < 0.002).length
  const coverH = strong > 0 ? ((box.y2 - box.y1) / H) * 100 : 0
  const coverW = strong > 0 ? ((box.x2 - box.x1) / W) * 100 : 0
  return (
    `${file.padEnd(28)} ${String(W).padStart(4)}x${String(H).padEnd(4)} ` +
    `ink ${String(pct).padStart(5)}%  read ${String(strongPct).padStart(5)}%  ` +
    `bands[${perBand.join('|')}]  empty ${emptyBands}/${BANDS}  cover ${coverW.toFixed(0)}x${coverH.toFixed(0)}%`
  )
}

for (const file of files) console.log(report(file))
