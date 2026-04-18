import { runOnce } from './runRequestWorker.js'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loop() {
  const intervalMs = Number.parseInt(process.env.WORKER_INTERVAL_MS ?? '5000', 10)
  const delay = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000

  for (;;) {
    try {
      await runOnce()
    } catch (e) {
      console.error(e)
    }
    await sleep(delay)
  }
}

loop().catch((e) => {
  console.error(e)
  process.exit(1)
})

