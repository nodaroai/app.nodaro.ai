import { scene3DPrivateStore } from "./private-plugins/scene3d-storage.js"
import { sweepExpiredScene3DArtifacts, sweepExpiredScene3DUploadIntents, runScene3DArtifactGcBatch } from "../services/scene3d-artifacts/gc.js"

/** SQL claims coordinate replicas. The local guard prevents overlapping slow sweeps. */
export function startScene3DArtifactCleanup(report: (message: string) => void): () => Promise<void> {
  const store = scene3DPrivateStore()
  if (!store) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      try {
        await sweepExpiredScene3DUploadIntents()
        await sweepExpiredScene3DArtifacts()
        const outcome = await runScene3DArtifactGcBatch(store)
        if (outcome.failed || outcome.skipped) report(`Scene artifact cleanup: ${outcome.failed} failed, ${outcome.skipped} skipped`)
      } catch {
        report("Scene artifact cleanup failed; pending objects will be retried")
      }
    })().finally(() => { pending = undefined })
  }
  const timer = setInterval(tick, 60_000)
  timer.unref()
  tick()
  return async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }
}
