#!/usr/bin/env node
/**
 * Prove the render binaries can write an mp4 on this machine.
 *
 * This exists because the whole failure mode it guards against is invisible to
 * every other gate: `check-routes.mjs` and `forge-e2e.mjs` either never launch
 * ffmpeg or run with Remotion's own compositor, and `still` renders never launch
 * it at all. So the engine reports `available: true`, stills come out fine, and
 * every `render` dies on `write EPIPE`.
 *
 * The gate asserts the mechanism, not the symptom:
 *   1. the compositor package is locatable from the installed render engine
 *   2. staging copies it out (default target: the data dir's bin/compositor)
 *   3. the staged ffmpeg can really encode an mp4 where renders write
 *
 * It deliberately does NOT assert "the render works" — that needs a full Discord
 * of frames and belongs to the manual acceptance run. What it pins down is the
 * part that silently regressed.
 */
import './sandbox-data.mjs'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const mod = await import('../packages/aibench/index.js')

let failures = 0
function assert(label, ok, detail = '') {
  if (ok) {
    console.log(`PASS  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const sandbox = process.env.AIBENCH_DATA_DIR
const binRoot = join(sandbox, 'bin')
process.env.AIBENCH_BIN_DIR = binRoot

// 1. The compositor must be findable from where the render engine actually is.
const compositor = mod.resolveCompositorDir()
assert('compositor package is locatable', Boolean(compositor), `got ${compositor}`)
if (compositor) {
  assert(
    'compositor ships ffmpeg.exe',
    existsSync(join(compositor, 'ffmpeg.exe')),
    join(compositor, 'ffmpeg.exe'),
  )
  assert(
    'compositor ships remotion.exe (needed for --binaries-directory)',
    existsSync(join(compositor, 'remotion.exe')),
    join(compositor, 'remotion.exe'),
  )
}

// 2. Staging must copy the binaries into the data dir and report that directory.
const probeDir = join(sandbox, 'probe-out')
mkdirSync(probeDir, { recursive: true })
rmSync(join(binRoot, 'compositor'), { recursive: true, force: true })
const staged = mod.binaryDirectory(probeDir)
assert('binaryDirectory() stages the compositor', Boolean(staged), `got ${staged}`)
if (staged) {
  assert('staged dir is <bin>/compositor', staged === join(binRoot, 'compositor'), staged)
  const files = readdirSync(staged)
  assert('staged ffmpeg.exe exists', files.includes('ffmpeg.exe'), files.join(','))
  assert('staged remotion.exe exists', files.includes('remotion.exe'), files.join(','))
  const dlls = files.filter((name) => name.endsWith('.dll'))
  assert('staged the ffmpeg DLLs', dlls.length >= 8, `${dlls.length} dlls`)
  const size = statSync(join(staged, 'ffmpeg.exe')).size
  assert('staged ffmpeg matches the source size', size === statSync(join(compositor, 'ffmpeg.exe')).size)
}

// 3. The staged binary must encode an mp4 where renders actually write.
//    Skipped when staging did not happen, because a missing compositor is a
//    different (already reported) problem.
if (staged) {
  const probeFile = join(probeDir, 'gate-probe.mp4')
  // One PNG through image2pipe: the same pipeline Remotion uses for real renders
  // (`-vcodec mjpeg -i -` → libx264). The bundled ffmpeg has no filter graph and
  // no rawvideo demuxer, so lavfi/rawvideo probes fail on a healthy binary.
  const result = spawnSync(
    join(staged, 'ffmpeg.exe'),
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-vcodec', 'png', '-i', '-',
      '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', probeFile,
    ],
    { cwd: staged, windowsHide: true, timeout: 60000, encoding: 'utf8', input: mod.tinyPng(64, 64, [0x18, 0x20, 0x34]) },
  )
  const wrote = existsSync(probeFile) && statSync(probeFile).size > 0
  assert(
    'staged ffmpeg can encode an mp4 into an output directory',
    result.status === 0 && wrote,
    `status=${result.status} wrote=${wrote} ${(result.stderr || '').toString().trim().slice(-300)}`,
  )
  if (wrote) {
    const head = spawnSync(join(staged, 'ffprobe.exe'), [
      '-v', 'error', '-show_entries', 'format=size', '-of', 'csv=p=0', probeFile,
    ], { cwd: staged, windowsHide: true, timeout: 30000, encoding: 'utf8' })
    assert('ffprobe reads the probe back', head.status === 0 && Number(head.stdout.trim()) > 0, head.stdout)
  }
}

// 4. The health payload must expose the staged dir so a user can see it.
const status = mod.getRenderStatus()
assert('render status reports the engine as available', status.available === true)
assert('render status exposes the binaries dir or null', 'binaries' in status, Object.keys(status).join(','))

rmSync(join(sandbox, 'probe-out'), { recursive: true, force: true })

console.log(failures === 0 ? '\nbinaries checks ok' : `\n${failures} binaries check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
