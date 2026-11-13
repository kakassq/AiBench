const BASE = 'http://127.0.0.1:61013/aibench-api'
const pid = process.argv[2]
const quality = process.argv[3] || 'preview'

const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(60000),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const get = async (path) => {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(60000) })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const queued = await post(`/projects/${pid}/render`, { quality })
console.log('queue:', queued.status, JSON.stringify(queued.json?.job ?? queued.json))
if (queued.status !== 200) process.exit(1)
const jobId = queued.json.jobId

const started = Date.now()
for (;;) {
  await new Promise((r) => setTimeout(r, 3000))
  const { json } = await get(`/jobs/${jobId}`)
  const job = json?.job
  const secs = Math.round((Date.now() - started) / 1000)
  console.log(`[${secs}s] ${job?.status} ${job?.progress}%`)
  if (job?.status === 'done') {
    console.log('OUTPUT', job.output)
    const media = await fetch('http://127.0.0.1:61013' + job.output, { signal: AbortSignal.timeout(60000) })
    const buf = Buffer.from(await media.arrayBuffer())
    console.log('bytes', buf.length)
    process.exit(0)
  }
  if (job?.status === 'failed') {
    console.log('ERROR >>>')
    console.log(job.error)
    process.exit(2)
  }
  if (secs > 900) {
    console.log('timeout waiting')
    process.exit(3)
  }
}
