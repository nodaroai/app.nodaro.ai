import { isStorageConfigured } from "./storage.js"
import { collectRetainedVideos } from "./retained-videos.js"
import { collectRetainedImages } from "./retained-images.js"

export function startRetainedImageCleanup(report: (message: string) => void): () => Promise<void> {
  if (!isStorageConfigured()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      for (const collect of [collectRetainedImages, collectRetainedVideos]) {
        try {
          const result = await collect()
          if (result.failed) report("Some retained media could not be cleaned up; they will be retried")
        } catch { report("Retained media cleanup failed; pending objects will be retried") }
      }
    })().finally(() => { pending = undefined })
  }
  const timer = setInterval(tick, 60_000)
  timer.unref()
  tick()
  return async () => { stopped = true; clearInterval(timer); await pending }
}
