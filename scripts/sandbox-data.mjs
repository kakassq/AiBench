/**
 * Point the Host's data directory at a throwaway location for this run.
 *
 * Several gates import `packages/aibench/index.js` and then exercise real write
 * routes — creating projects, writing Forge drafts, installing agents. `DATA_DIR`
 * is resolved once at module load, so without an override those writes land in
 * the user's own `<profile>/aibench/` and show up in their Studio list forever.
 * That is not hypothetical: thirteen "forge e2e" projects had to be cleaned out
 * by hand before this existed.
 *
 * Import this BEFORE the Host module. It is a side-effecting module on purpose:
 * the ordering requirement is easier to keep with an import than with a call.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')

/** One sandbox per script, so two gates running side by side cannot collide. */
function sandboxName() {
  const script = process.argv[1] ? process.argv[1].split(/[\\/]/).pop() : 'gate'
  return script.replace(/\.mjs$/, '')
}

const SANDBOX = join(ROOT, '.tmp', 'gate-data', sandboxName())

// A stale sandbox from a previous run would make "did this gate pollute the real
// data dir" untestable, and would keep yesterday's fixtures visible to assertions.
rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })

process.env.AIBENCH_DATA_DIR = SANDBOX

export const sandboxDir = SANDBOX
