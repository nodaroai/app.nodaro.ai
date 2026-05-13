import { useCallback, useEffect, useRef, useState } from "react"
import { cancelJob, getJobStatus } from "@/lib/api"

export type StudioAssetType = "expressions" | "poses" | "angles" | "lighting" | "motions"

interface PendingJob {
  assetType: StudioAssetType
  name: string
  /** Latest progress percentage (0–100) reported by the worker. Stays 0 until
   *  the worker starts ramping. Used by the spinner card to render the
   *  progress bar. */
  progress: number
}

interface ResolvedAsset {
  assetType: StudioAssetType
  name: string
  url: string
}

export interface CharacterStudioJobs {
  /** jobId -> pending metadata; consumers render a spinner card for each */
  pending: Map<string, PendingJob>
  /** add a job to track */
  track: (jobId: string, assetType: StudioAssetType, name: string) => void
  /** cancel an in-flight job (backend marks status=cancelled, refunds credits,
   *  evicts from BullMQ). Removes the entry from `pending` immediately so the
   *  spinner card disappears without waiting for the next poll cycle. */
  cancel: (jobId: string) => Promise<void>
  /** asset types currently generating (for setting *Status on save) */
  runningTypes: () => Set<StudioAssetType>
}

const POLL_MS = 2000

/**
 * @param onResolved called when a job completes successfully — push { name, url } into the matching staged array
 * @param onFailed   called when a job fails — mark the pending card errored
 */
export function useCharacterStudioJobs(
  onResolved: (a: ResolvedAsset) => void,
  onFailed: (jobId: string, assetType: StudioAssetType) => void,
): CharacterStudioJobs {
  const [pending, setPending] = useState<Map<string, PendingJob>>(new Map())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  // keep callbacks + latest pending in refs so the polling effect depends only on whether
  // there's anything to poll — avoids recreating the interval on every staged-state change
  const onResolvedRef = useRef(onResolved); onResolvedRef.current = onResolved
  const onFailedRef = useRef(onFailed); onFailedRef.current = onFailed
  const pendingRef = useRef(pending); pendingRef.current = pending

  const track = useCallback((jobId: string, assetType: StudioAssetType, name: string) => {
    setPending((prev) => {
      const next = new Map(prev)
      next.set(jobId, { assetType, name, progress: 0 })
      return next
    })
  }, [])

  const cancel = useCallback(async (jobId: string) => {
    // Drop the spinner immediately for snappy UX — the backend call confirms
    // server-side cancellation in the background. If the cancel actually fails,
    // the next poll cycle would re-surface the job, but for that to happen the
    // caller would have to re-track it; since we don't, the worst case is the
    // job completes anyway and lands on the row via auto-attach (visible on
    // next refetch). That's a safe failure mode for "user clicked cancel".
    setPending((prev) => {
      if (!prev.has(jobId)) return prev
      const next = new Map(prev)
      next.delete(jobId)
      return next
    })
    try {
      await cancelJob(jobId)
    } catch {
      // Swallow — the spinner is already gone; if the worker writes the
      // result anyway, the refetch picks it up.
    }
  }, [])

  const hasPending = pending.size > 0
  useEffect(() => {
    if (!hasPending) {
      if (timer.current) { clearInterval(timer.current); timer.current = null }
      return
    }
    if (timer.current) return
    timer.current = setInterval(async () => {
      const snapshot = pendingRef.current
      for (const jobId of Array.from(snapshot.keys())) {
        try {
          const job = await getJobStatus(jobId)
          const meta = pendingRef.current.get(jobId)
          if (!meta) continue
          if (job.status === "completed") {
            const out = job.output_data as { imageUrl?: string; videoUrl?: string } | undefined
            const resolvedUrl = meta.assetType === "motions" ? out?.videoUrl : out?.imageUrl
            if (resolvedUrl) onResolvedRef.current({ assetType: meta.assetType, name: meta.name, url: resolvedUrl })
            setPending((prev) => { const n = new Map(prev); n.delete(jobId); return n })
          } else if (job.status === "failed" || job.status === "cancelled") {
            // Cancelled jobs disappear silently (no error card). Failed ones
            // get the red "failed" overlay via onFailed.
            if (job.status === "failed") onFailedRef.current(jobId, meta.assetType)
            setPending((prev) => { const n = new Map(prev); n.delete(jobId); return n })
          } else if (typeof job.progress === "number" && job.progress !== meta.progress) {
            // Only re-render when progress actually moved — avoids a fresh
            // Map every 2s when the worker isn't reporting new numbers.
            setPending((prev) => {
              const cur = prev.get(jobId)
              if (!cur || cur.progress === job.progress) return prev
              const n = new Map(prev)
              n.set(jobId, { ...cur, progress: job.progress })
              return n
            })
          }
        } catch {
          /* transient — retry next tick */
        }
      }
    }, POLL_MS)
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
  }, [hasPending])

  const runningTypes = useCallback(() => {
    const s = new Set<StudioAssetType>()
    for (const v of pending.values()) s.add(v.assetType)
    return s
  }, [pending])

  return { pending, track, cancel, runningTypes }
}
