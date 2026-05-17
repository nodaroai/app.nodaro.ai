import { useCallback, useEffect, useRef, useState } from "react"
import { cancelJob, getJobStatus } from "@/lib/api"

export type StudioAssetType =
  | "expressions"
  | "poses"
  | "angles"
  | "bodyAngles"
  | "lighting"
  | "motions"

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
  /** Like `track`, but also returns a Promise that resolves with the asset URL
   *  when the job completes (or rejects when it fails / is cancelled). Wires
   *  through the SAME poll cycle as `track` so callers get the spinner card
   *  AND the `onResolved`-driven staged-array merge for free — the Promise is
   *  a side channel for orchestration (e.g. "wait for body angle before
   *  motion gen"). */
  trackAndWait: (jobId: string, assetType: StudioAssetType, name: string) => Promise<string>
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
  // Side-channel: jobId -> { resolve, reject }. Populated by `trackAndWait`;
  // drained when the poll loop sees the job hit a terminal state. Lives in a
  // ref (NOT React state) because settling a Promise doesn't need to trigger
  // a re-render and we want the latest value visible to the interval callback.
  const waitersRef = useRef<Map<string, { resolve: (url: string) => void; reject: (err: Error) => void }>>(
    new Map(),
  )

  const track = useCallback((jobId: string, assetType: StudioAssetType, name: string) => {
    setPending((prev) => {
      const next = new Map(prev)
      next.set(jobId, { assetType, name, progress: 0 })
      return next
    })
  }, [])

  const trackAndWait = useCallback(
    (jobId: string, assetType: StudioAssetType, name: string): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        // Register the waiter BEFORE adding to pending so we can't miss a
        // completion that lands between `track` and our resolver hook-up
        // (the poll interval only fires once every 2s, so this is more about
        // belt-and-braces than a real race).
        waitersRef.current.set(jobId, { resolve, reject })
        setPending((prev) => {
          const next = new Map(prev)
          next.set(jobId, { assetType, name, progress: 0 })
          return next
        })
      })
    },
    [],
  )

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
    // Reject any awaiting Promise so the chain (e.g. body-angle → motion)
    // breaks cleanly instead of leaking a never-resolving await.
    const waiter = waitersRef.current.get(jobId)
    if (waiter) {
      waitersRef.current.delete(jobId)
      waiter.reject(new Error("cancelled"))
    }
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
            const waiter = waitersRef.current.get(jobId)
            if (waiter) {
              waitersRef.current.delete(jobId)
              if (resolvedUrl) waiter.resolve(resolvedUrl)
              else waiter.reject(new Error("Job completed without a usable URL"))
            }
            setPending((prev) => { const n = new Map(prev); n.delete(jobId); return n })
          } else if (job.status === "failed" || job.status === "cancelled") {
            // Cancelled jobs disappear silently (no error card). Failed ones
            // get the red "failed" overlay via onFailed.
            if (job.status === "failed") onFailedRef.current(jobId, meta.assetType)
            const waiter = waitersRef.current.get(jobId)
            if (waiter) {
              waitersRef.current.delete(jobId)
              waiter.reject(new Error(job.error_message ?? job.status))
            }
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

  // Settle any outstanding waiters on unmount so the orchestration callers
  // don't end up with hung Promises if the user closes the studio mid-chain.
  useEffect(() => {
    const waiters = waitersRef.current
    return () => {
      for (const [, w] of waiters) w.reject(new Error("studio closed"))
      waiters.clear()
    }
  }, [])

  return { pending, track, trackAndWait, cancel, runningTypes }
}
