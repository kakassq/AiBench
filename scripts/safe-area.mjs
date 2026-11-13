/**
 * Safe-area bleed check.
 *
 * A layout bug that a screenshot review can only describe as "text looks cut
 * off" is, measurably, strong ink sitting inside the outer margin. Report, per
 * frame, the distance from each edge to the nearest strong-ink pixel so a
 * regression shows up as a number instead of an opinion.
 *
 * Usage: node scripts/safe-area.mjs <dir> [suffix]
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const FFMPEG = process.env.FFMPEG || 'C:/Users/Administrator/.dsh/bot/workspace/tools/bin/ffmpeg.exe'
const dir = process.argv[2] || 'D:/AI/Vibe/AiBench/artifacts/layout-check'
const suffix = process.argv[3] || ''

// Every frame is 1080 or 1920 on the long edge; read the real size from ffprobe
// so the script works for any composition.
const PROBE = 'C:/Users/Administrator/.dsh/bot/workspace/tools/bin/ffprobe.exe'

function dimensions(file) {
  const out = execFileSync(PROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    file,
  ], { encoding: 'utf8' })
  const [w, h] = out.trim().split(',').map(Number)
  return { w, h }
}

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.png'))
  .filter((name) => (suffix ? name.includes(suffix) : true))
  .sort()

let bleed = 0
for (const file of files) {
  const path = join(dir, file)
  const { w, h } = dimensions(path)
  const buffer = execFileSync(FFMPEG, [
    '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 })

  // Dominant colour = background.
  const buckets = new Map()
  const STEP = 4
  for (let y = 0; y < h; y += STEP) {
    for (let x = 0; x < w; x += STEP) {
      const o = (y * w + x) * 3
      const key = `${buffer[o] >> 4}:${buffer[o + 1] >> 4}:${buffer[o + 2] >> 4}`
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
  }
  const top = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const [dr, dg, db] = top.split(':').map((v) => Number(v) << 4)

  let left = w, right = 0, upper = h, lower = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const o = (y * w + x) * 3
      const diff = Math.abs(buffer[o] - dr) + Math.abs(buffer[o + 1] - dg) + Math.abs(buffer[o + 2] - db)
      if (diff <= 150) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < upper) upper = y
      if (y > lower) lower = y
    }
  }

  const margins = { top: upper, left, bottom: h - 1 - lower, right: w - 1 - right }
  // 1.2% of the long edge is the smallest margin the layout ever intends; below
  // that, type is close enough to the edge to read as clipped on a phone.
  const floor = Math.round(Math.min(w, h) * 0.012)
  const tight = Object.entries(margins).filter(([, value]) => value < floor)
  const flag = tight.length > 0 ? `  BLEED ${tight.map(([k, v]) => `${k}=${v}px`).join(' ')}` : ''
  if (tight.length > 0) bleed += 1
  console.log(
    `${file.padEnd(30)} ${String(w).padStart(4)}x${String(h).padEnd(4)} ` +
      `margins t=${margins.top} l=${margins.left} b=${margins.bottom} r=${margins.right}${flag}`,
  )
}

console.log(bleed === 0 ? 'no safe-area bleed' : `${bleed} frame(s) bleed past the ${Math.round(Math.min(1080, 1920) * 0.012)}px floor`)
process.exit(bleed === 0 ? 0 : 1)
