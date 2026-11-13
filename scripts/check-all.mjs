// Run every gate in sequence and report one line per gate.
//
// Spawned through execFileSync rather than a shell chain: PowerShell swallows
// stderr and misreports the exit code of a piped native command, which once made
// a failing gate look green.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const gates = [
  ['check-timeline', ['scripts/check-timeline.mjs']],
  ['check-sections', ['scripts/check-sections.mjs']],
  ['check-client-render', ['scripts/check-client-render.mjs']],
  ['check-templates', ['scripts/check-templates.mjs']],
  ['check-director', ['scripts/check-director.mjs']],
  ['check-script', ['scripts/check-script.mjs']],
  ['check-skills', ['scripts/check-skills.mjs']],
  ['check-forge', ['scripts/check-forge.mjs']],
  ['check-routes', ['scripts/check-routes.mjs']],
  ['forge-e2e', ['scripts/forge-e2e.mjs']],
  ['check-storyboard-build', ['scripts/check-storyboard-build.mjs']],
  // Renders 12 frames through the real CLI and measures them: a layout change
  // that only looks right in one aspect ratio fails here.
  ['check-layout', ['scripts/check-layout.mjs']],
  // Stages the Remotion compositor and asks its ffmpeg to encode an mp4. This is
  // the only gate that would catch a Low-integrity label above the package, where
  // stills keep working and every mp4 render dies on `write EPIPE`.
  ['check-binaries', ['scripts/check-binaries.mjs']],
  ['check-installed-layout', ['scripts/check-installed-layout.mjs']],
  ['make-icon-png', ['scripts/make-icon-png.mjs']],
  // No explicit origin: `probe.mjs` discovers the port the desktop app is
  // currently listening on. Pinning one here is what made this gate go red
  // every time the app restarted on a fresh port.
  ['probe', ['scripts/probe.mjs']],
]

let failed = 0
for (const [name, args] of gates) {
  try {
    const out = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const last = out.trim().split('\n').filter(Boolean).pop() ?? 'ok'
    console.log(`PASS  ${name} -> ${last}`)
  } catch (error) {
    failed += 1
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n')
    console.log(`FAIL  ${name}\n${out}`)
  }
}

if (failed > 0) {
  console.log(`\n${failed} gate(s) failed`)
  process.exit(1)
}
console.log('\nall gates passed')
