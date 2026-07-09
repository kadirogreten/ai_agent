import './loadEnv.js'
import { tick } from './operationLoopTick.js'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loop() {
  const intervalMs = Number.parseInt(process.env.OPERATION_TICK_INTERVAL_MS ?? '30000', 10)
  const delay = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30000

  for (;;) {
    try {
      await tick()
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
