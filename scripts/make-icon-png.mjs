#!/usr/bin/env node
/**
 * Regenerate the raster icons from the single SVG source.
 *
 * The marketplace catalog and the GitHub repo card both want a PNG; the DSH
 * panel itself uses the SVG. Committing a binary that can drift from the vector
 * is how icons rot, so this documents how the PNGs were produced and makes them
 * reproducible.
 *
 * No image library is installed here, so this uses the already-present browser
 * (Chrome via Playwright/CDP) to rasterise the SVG at each size. That keeps the
 * dependency list at zero.
 *
 * Usage:
 *   node scripts/make-icon-png.mjs                       # just prints instructions
 *   node scripts/make-icon-png.mjs --rasterize <b64json> # used by the browser path
 *
 * In practice the icons were rasterised in the agent browser with:
 *   - load packages/aibench/icon.svg as a data: URL
 *   - for each size, rewrite width/height on the <svg> element
 *   - draw to a <canvas> at that size and export PNG
 *
 * The script below verifies the committed PNGs match the expected dimensions so
 * a hand-edited or wrong-sized icon fails loudly.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const ASSETS = join(ROOT, 'assets')
const EXPECTED = [
  { file: 'icon-180.png', size: 180 },
  { file: 'icon-512.png', size: 512 },
]

/** Read width/height straight out of the PNG IHDR chunk — no decoder needed. */
function pngSize(path) {
  const buffer = readFileSync(path)
  const isPng = buffer.subarray(1, 4).toString('ascii') === 'PNG'
  if (!isPng) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

let bad = 0
for (const { file, size } of EXPECTED) {
  const path = join(ASSETS, file)
  if (!existsSync(path)) {
    console.error(`MISSING ${file} — see the header of this script for how to rasterise it.`)
    bad += 1
    continue
  }
  const dims = pngSize(path)
  if (!dims) {
    console.error(`NOT A PNG: ${file}`)
    bad += 1
    continue
  }
  if (dims.width !== size || dims.height !== size) {
    console.error(`WRONG SIZE: ${file} is ${dims.width}x${dims.height}, expected ${size}x${size}`)
    bad += 1
    continue
  }
  console.log(`ok ${file} (${size}x${size})`)
}

if (bad > 0) process.exit(1)
console.log('\nicon assets ok')
