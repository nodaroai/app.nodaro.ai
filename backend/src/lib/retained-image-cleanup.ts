import { isStorageConfigured } from "./storage.js"
import { collectRetainedImages } from "./retained-images.js"

export function startRetainedImageCleanup(report: (message: string) => void): () => Promise<void> {
  if (!isStorageConfigured()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      try {
        const result = await collectRetainedImages()
        if (result.failed) report("Some retained images could not be cleaned up; they will be retried")
      } catch { report("Retained image cleanup failed; pending objects will be retried") }
    })().finally(() => { pending = undefined })
  }
  const timer = setInterval(tick, 60_000)
  timer.unref()
  tick()
  return async () => { stopped = true; clearInterval(timer); await pending }
}
