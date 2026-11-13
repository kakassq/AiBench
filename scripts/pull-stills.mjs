const base = process.argv[2] || 'http://127.0.0.1:61013/aibench-api'
const pid = process.argv[3] || 'p_bca88be3d0334a'
const outDir = process.argv[4] || 'D:/AI/Vibe/AiBench/artifacts/forbidden-city'
const origin = base.replace(/\/aibench-api$/, '')

const fs = await import('node:fs')
const path = await import('node:path')
fs.mkdirSync(outDir, { recursive: true })

const list = await (await fetch(`${base}/projects`)).json()
const project = list.items.find((item) => item.id === pid)
const stills = project.outputs?.stills ?? []
for (const entry of stills.slice(-6)) {
  const rel = typeof entry === 'string' ? entry : entry?.url
  if (!rel) continue
  const buffer = Buffer.from(await (await fetch(origin + rel)).arrayBuffer())
  const name = rel.split('/').pop()
  const target = path.join(outDir, name)
  fs.writeFileSync(target, buffer)
  console.log(name, buffer.length)
}
