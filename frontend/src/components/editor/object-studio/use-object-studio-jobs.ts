import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getJobStatusBatch } from "@/lib/api"
import { getCachedUserId } from "@/hooks/use-auth"
import {
  useJobsRealtimeSync,
  type JobRealtimeRow,
} from "../location-studio/use-jobs-realtime-sync"

/**
 * Object Studio job-status hook.
 *
 * Studio-side analog of useLocationStudioJobs. Mirror of the location
 * precedent with object substitution. Supabase Realtime is the PRIMARY
 * signal — `useJobsRealtimeSync` subscribes to UPDATE events on the
 * `jobs` table filtered by user_id and fires the same `onResolved` /
 * `onFailed` callbacks the polling tick fires. The existing batch-polling
 * stays as a FALLBACK (for clients where realtime drops, RLS edge cases
 * occur, or the websocket is offline) throttled to 10s now that realtime
 * carries the latency budget. Uses the batch `getJobStatusBatch` (GET
 * /v1/jobs/status) endpoint instead of N parallel `getJobStatus` calls —
 * the studio commonly tracks 1/2/4 candidates at once so the batch shape
 * pays for itself even at low N. Adds a small ±200ms jitter to spread
 * load when multiple studios are open in different tabs.
 *
 * Lifecycle:
 *  - Mount with optional `initial` jobs (from the row's `pendingJobs` rehydrate).
 *  - `trackJob({ jobId, assetType, name })` appends; dedupes by jobId.
 *  - Realtime fires on every UPDATE; tick fires every 10s as fallback.
 *  - On `status === "completed"` with a usable URL, fires `onResolved` and
 *    drops the job from tracked.
 *  - On `status === "failed"`, fires `onFailed(jobId)` and drops.
 *  - Empty tracked → no interval scheduled (cheaper than a tick that no-ops).
 *
 * Callbacks are wired through `onResolved(cb)` / `onFailed(cb)` setters so
 * the parent can swap them without forcing the polling effect to restart.
 *
 * The shared `useJobsRealtimeSync` helper lives in `location-studio/` and
 * is re-imported here verbatim — there's no object-specific deviation in
 * the realtime job-status path (the `jobs` table is the same regardless
 * of which entity owns the asset).
 */
const POLL_MS = 10000

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

export interface ObjectStudioJobs {
  readonly tracked: ReadonlyArray<TrackedJob>
  trackJob: (job: TrackedJob) => void
  onResolved: (cb: (j: CompletedJob) => void) => void
  onFailed: (cb: (jobId: string) => void) => void
}

export function useObjectStudioJobs(initial: ReadonlyArray<TrackedJob> = []): ObjectStudioJobs {
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

  /**
   * Shared resolution logic used by BOTH the realtime handler and the
   * polling tick. Given a job id + status + output_data, fires the
   * appropriate callback and drops the job from `tracked`. Returns true
   * if the job was terminal (resolved or failed), false otherwise — the
   * polling tick uses this to short-circuit further status processing
   * for the same job in the same tick.
   */
  const handleJobStatus = useCallback(
    (id: string, status: string, outputData: unknown): boolean => {
      const meta = trackedRef.current.find((t) => t.jobId === id)
      if (!meta) return false
      if (status === "completed") {
        const out = outputData as { imageUrl?: string; videoUrl?: string } | undefined
        const url = out?.imageUrl ?? out?.videoUrl
        if (url) {
          onResolvedRef.current({ jobId: meta.jobId, assetType: meta.assetType, name: meta.name, url })
          setTracked((prev) => prev.filter((t) => t.jobId !== id))
          return true
        }
        return false
      }
      if (status === "failed") {
        onFailedRef.current(id)
        setTracked((prev) => prev.filter((t) => t.jobId !== id))
        return true
      }
      return false
    },
    [],
  )

  // ---------------------------------------------------------------------
  // Realtime — primary signal.
  // ---------------------------------------------------------------------
  // The per-user channel is opened once for the studio's lifetime. The
  // tracked-set ref filters events down to the jobs we care about; new
  // tracks become visible to the next event without re-opening the channel.
  const userId = getCachedUserId()
  const trackedIdsSet = useMemo(() => new Set(tracked.map((t) => t.jobId)), [tracked])
  const handleRealtimeUpdate = useCallback(
    (job: JobRealtimeRow) => {
      handleJobStatus(job.id, job.status, job.output_data)
    },
    [handleJobStatus],
  )
  useJobsRealtimeSync(userId ?? null, trackedIdsSet, handleRealtimeUpdate)

  // ---------------------------------------------------------------------
  // Polling — fallback.
  // ---------------------------------------------------------------------
  // Throttled to POLL_MS = 10s now that realtime carries the latency
  // budget. The tick stays as the authoritative recovery path for clients
  // where realtime drops, RLS edge cases occur, or the websocket is offline.
  //
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
          handleJobStatus(j.id, j.status, j.output_data)
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
