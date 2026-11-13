import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const BIN = 'C:/Users/Administrator/.dsh/bot/workspace/tools/bin'
const src = process.argv[2]
const frame = Number(process.argv[3] ?? 300)
const out = process.argv[4]

// ffmpeg cannot create files on this machine, so decode to stdout and write the
// PNG from Node.
const png = execFileSync(`${BIN}/ffmpeg.exe`, [
  '-v', 'error',
  '-i', src,
  '-vf', `select=eq(n\\,${frame})`,
  '-vframes', '1',
  '-f', 'image2pipe',
  '-c:v', 'png',
  'pipe:1',
], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })

writeFileSync(out, png)
console.log(`${out} ${png.length} bytes (frame ${frame})`)
