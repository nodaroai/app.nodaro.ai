import { useCallback, useEffect, useRef, useState } from "react"
import { cancelJob, getJobStatusLean } from "@/lib/api"

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
  /** True for a client-side placeholder added by `begin()` BEFORE the
   *  generate request has returned a real jobId. The poll loop skips these
   *  (there's nothing to GET yet); `settle()` swaps it for the real id and
   *  `abort()` removes it. Lets the spinner card appear the instant the user
   *  clicks, instead of after the ensureSaved + generate round-trips. */
  optimistic?: boolean
}

interface ResolvedAsset {
  assetType: StudioAssetType
  name: string
  url: string
}

interface FailedJob {
  assetType: StudioAssetType
  name: string
}

export interface CharacterStudioJobs {
  /** jobId (or optimistic temp id) -> pending metadata; consumers render a
   *  spinner card for each */
  pending: Map<string, PendingJob>
  /** jobId -> failed metadata for generations that errored. Unlike `pending`,
   *  entries are NOT auto-removed — the tab renders a persistent, dismissible
   *  failed tile (with Retry) so the failure doesn't vanish silently when the
   *  spinner is removed. Independent of the modal's header "N failed" counter
   *  (which is cumulative for the session); dismissing a tile doesn't touch it. */
  failed: Map<string, FailedJob>
  /** Drop a failed entry — called on Retry (after re-firing the generation) and
   *  when the user clicks ✕ on the failed tile. */
  dismissFailed: (jobId: string) => void
  /** Optimistically add a placeholder spinner card and return its temp id —
   *  call this synchronously on click, BEFORE awaiting ensureSaved/generate,
   *  so the UI reacts instantly. Follow with `settle(tempId, realJobId)` once
   *  the generate request returns, or `abort(tempId)` if it throws. */
  begin: (assetType: StudioAssetType, name: string) => string
  /** Replace an optimistic placeholder with its real jobId so the poll loop
   *  picks it up. No-op if the placeholder was cancelled/aborted meanwhile. */
  settle: (tempId: string, jobId: string) => void
  /** Drop an optimistic placeholder (the generate request failed). */
  abort: (tempId: string) => void
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
  // Failed generations the user hasn't dismissed/retried yet. Mirrors `pending`
  // but persists across poll cycles so the failure stays visible in the grid.
  const [failed, setFailed] = useState<Map<string, FailedJob>>(new Map())
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
  // Monotonic counter for optimistic placeholder ids. A ref (not state) so
  // bumping it never re-renders and ids stay unique for the hook's lifetime.
  const optimisticSeq = useRef(0)

  const track = useCallback((jobId: string, assetType: StudioAssetType, name: string) => {
    setPending((prev) => {
      const next = new Map(prev)
      next.set(jobId, { assetType, name, progress: 0 })
      return next
    })
  }, [])

  const begin = useCallback((assetType: StudioAssetType, name: string): string => {
    const tempId = `optimistic:${optimisticSeq.current++}`
    setPending((prev) => {
      const next = new Map(prev)
      next.set(tempId, { assetType, name, progress: 0, optimistic: true })
      return next
    })
    return tempId
  }, [])

  const settle = useCallback((tempId: string, jobId: string) => {
    setPending((prev) => {
      const cur = prev.get(tempId)
      // Cancelled/aborted before the request returned — don't resurrect it.
      if (!cur) return prev
      const next = new Map(prev)
      next.delete(tempId)
      next.set(jobId, { assetType: cur.assetType, name: cur.name, progress: 0 })
      return next
    })
  }, [])

  const abort = useCallback((tempId: string) => {
    setPending((prev) => {
      if (!prev.has(tempId)) return prev
      const next = new Map(prev)
      next.delete(tempId)
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
    // Snapshot whether this is an optimistic placeholder before we drop it —
    // those have no server-side job to cancel.
    const wasOptimistic = pendingRef.current.get(jobId)?.optimistic
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
    // Optimistic placeholder: the generate request hasn't returned a jobId, so
    // there's nothing for the backend to cancel.
    if (wasOptimistic) return
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
        // Optimistic placeholders carry a temp id with no backend job yet —
        // skip them so we don't fire a doomed GET every tick.
        if (pendingRef.current.get(jobId)?.optimistic) continue
        try {
          const job = await getJobStatusLean(jobId)
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
            // bump the header counter (onFailed) AND surface a persistent,
            // dismissible failed tile in the grid via the `failed` map.
            if (job.status === "failed") {
              onFailedRef.current(jobId, meta.assetType)
              setFailed((prev) => {
                const n = new Map(prev)
                n.set(jobId, { assetType: meta.assetType, name: meta.name })
                return n
              })
            }
            const waiter = waitersRef.current.get(jobId)
            if (waiter) {
              waitersRef.current.delete(jobId)
              waiter.reject(new Error(job.error_message ?? job.status))
            }
            setPending((prev) => { const n = new Map(prev); n.delete(jobId); return n })
          } else if (typeof job.progress === "number" && job.progress !== meta.progress) {
            // Only re-render when progress actually moved — avoids a fresh
            // Map every 2s when the worker isn't reporting new numbers.
            // Capture the narrowed number locally; the `typeof` guard above
            // doesn't propagate into the setPending closure (progress is now
            // optional on the lean status type).
            const nextProgress = job.progress
            setPending((prev) => {
              const cur = prev.get(jobId)
              if (!cur || cur.progress === nextProgress) return prev
              const n = new Map(prev)
              n.set(jobId, { ...cur, progress: nextProgress })
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

  const dismissFailed = useCallback((jobId: string) => {
    setFailed((prev) => {
      if (!prev.has(jobId)) return prev
      const next = new Map(prev)
      next.delete(jobId)
      return next
    })
  }, [])

  // Settle any outstanding waiters on unmount so the orchestration callers
  // don't end up with hung Promises if the user closes the studio mid-chain.
  useEffect(() => {
    const waiters = waitersRef.current
    return () => {
      for (const [, w] of waiters) w.reject(new Error("studio closed"))
      waiters.clear()
    }
  }, [])

  return { pending, failed, dismissFailed, begin, settle, abort, track, trackAndWait, cancel, runningTypes }
}
