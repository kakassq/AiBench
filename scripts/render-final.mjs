const base = process.argv[2] || 'http://127.0.0.1:61013/aibench-api'
const pid = process.argv[3] || 'p_bca88be3d0334a'
const quality = process.argv[4] || 'final'

const started = Date.now()
const res = await fetch(`${base}/projects/${pid}/render`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ quality }),
})
const payload = await res.json()
console.log('POST', res.status, JSON.stringify(payload).slice(0, 300))
if (!payload.ok) process.exit(1)

const jobId = payload.job?.id ?? payload.jobId
if (!jobId) {
  console.error('no job id in response')
  process.exit(1)
}

for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  const job = await (await fetch(`${base}/jobs/${jobId}`)).json()
  const row = job.item ?? job.job ?? job
  console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${row.status} ${row.progress ?? ''}%`)
  if (row.status === 'done') {
    console.log('output:', row.output)
    break
  }
  if (row.status === 'failed') {
    console.error('FAILED', row.error)
    process.exit(1)
  }
}
