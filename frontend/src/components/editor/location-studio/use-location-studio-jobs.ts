import { useCallback, useEffect, useRef, useState } from "react"
import { getJobStatusBatch } from "@/lib/api"

/**
 * Location Studio job-polling hook.
 *
 * Studio-side analog of useCharacterStudioJobs, but uses the batch
 * `getJobStatusBatch` (GET /v1/jobs/status) endpoint instead of N parallel
 * `getJobStatus` calls — the studio commonly tracks 1/2/4 candidates at once
 * so the batch shape pays for itself even at low N. Polls every ~2s with a
 * small ±200ms jitter to spread load when multiple studios are open in
 * different tabs.
 *
 * Lifecycle:
 *  - Mount with optional `initial` jobs (from the row's `pendingJobs` rehydrate).
 *  - `trackJob({ jobId, assetType, name })` appends; dedupes by jobId.
 *  - The polling effect re-runs only when the tracked list changes shape
 *    (length / jobIds) — not on every progress update.
 *  - On `status === "completed"` with a usable URL, fires `onResolved` and
 *    drops the job from tracked.
 *  - On `status === "failed"`, fires `onFailed(jobId)` and drops.
 *  - Empty tracked → no interval scheduled (cheaper than a tick that no-ops).
 *
 * Callbacks are wired through `onResolved(cb)` / `onFailed(cb)` setters so
 * the parent can swap them without forcing the polling effect to restart.
 */
const POLL_MS = 2000

export type TrackedJob = {
  readonly jobId: string
  readonly assetType: string
  readonly name: string
}

export type CompletedJob = {
  readonly jobId: string
  readonly assetType: string
  readonly name: string
  readonly url: string
}

export interface LocationStudioJobs {
  readonly tracked: ReadonlyArray<TrackedJob>
  trackJob: (job: TrackedJob) => void
  onResolved: (cb: (j: CompletedJob) => void) => void
  onFailed: (cb: (jobId: string) => void) => void
}

export function useLocationStudioJobs(initial: ReadonlyArray<TrackedJob> = []): LocationStudioJobs {
  const [tracked, setTracked] = useState<TrackedJob[]>(() => [...initial])
  const onResolvedRef = useRef<(j: CompletedJob) => void>(() => {})
  const onFailedRef = useRef<(jobId: string) => void>(() => {})
  const trackedRef = useRef<TrackedJob[]>(tracked)
  trackedRef.current = tracked

  const trackJob = useCallback((job: TrackedJob) => {
    setTracked((prev) => (prev.some((t) => t.jobId === job.jobId) ? prev : [...prev, job]))
  }, [])

  const onResolved = useCallback((cb: (j: CompletedJob) => void) => {
    onResolvedRef.current = cb
  }, [])

  const onFailed = useCallback((cb: (jobId: string) => void) => {
    onFailedRef.current = cb
  }, [])

  // Stable dependency: only restart the polling interval when the set of
  // jobIds changes — not when other state in the component re-renders.
  const jobIdsKey = tracked.map((t) => t.jobId).join(",")

  useEffect(() => {
    if (tracked.length === 0) return
    // ±200ms jitter so multiple open studios don't all poll on the same tick.
    const jitter = Math.random() * 400 - 200
    const interval = setInterval(async () => {
      try {
        const ids = trackedRef.current.map((t) => t.jobId)
        if (ids.length === 0) return
        const { jobs } = await getJobStatusBatch(ids)
        for (const j of jobs) {
          const meta = trackedRef.current.find((t) => t.jobId === j.id)
          if (!meta) continue
          if (j.status === "completed") {
            const out = j.output_data as { imageUrl?: string; videoUrl?: string } | undefined
            const url = out?.imageUrl ?? out?.videoUrl
            if (url) {
              onResolvedRef.current({ jobId: meta.jobId, assetType: meta.assetType, name: meta.name, url })
              setTracked((prev) => prev.filter((t) => t.jobId !== j.id))
            }
          } else if (j.status === "failed") {
            onFailedRef.current(j.id)
            setTracked((prev) => prev.filter((t) => t.jobId !== j.id))
          }
          // pending/running → keep tracking; no state change required.
        }
      } catch {
        // Transient — retry on next tick.
      }
    }, POLL_MS + jitter)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jobIdsKey is the stable hash
  }, [jobIdsKey])

  return { tracked, trackJob, onResolved, onFailed }
}
