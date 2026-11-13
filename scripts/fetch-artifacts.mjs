import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:61013/aibench-api'
const pid = process.argv[3]
const outDir = process.argv[4] || 'D:/AI/Vibe/AiBench/artifacts/forbidden-city'
mkdirSync(outDir, { recursive: true })

const origin = base.replace(/\/aibench-api$/, '')
const list = await (await fetch(`${base}/projects`)).json()
const project = list.items.find((item) => item.id === pid)
if (!project) {
  console.error(`no project ${pid}`)
  process.exit(1)
}
console.log('title:', project.title, '| job:', project.jobId)

const stills = project.outputs?.stills ?? []
for (const entry of stills.slice(-8)) {
  // `outputs.stills` holds `{ frame, url, at }` records, not bare paths.
  const rel = typeof entry === 'string' ? entry : entry?.url
  if (!rel) continue
  const url = origin + rel
  const buffer = Buffer.from(await (await fetch(url)).arrayBuffer())
  const name = rel.split('/').pop()
  writeFileSync(join(outDir, name), buffer)
  console.log(name, buffer.length)
}

if (project.outputs?.video) {
  const rel = typeof project.outputs.video === 'string' ? project.outputs.video : project.outputs.video.url
  const url = origin + rel
  const buffer = Buffer.from(await (await fetch(url)).arrayBuffer())
  const name = rel.split('/').pop()
  writeFileSync(join(outDir, name), buffer)
  console.log(name, buffer.length)
} else {
  console.log('no video yet')
}
