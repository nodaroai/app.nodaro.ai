import { useEffect, useRef } from "react"
import { getLocationById } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { LocationNodeData } from "@/types/nodes"

/**
 * Background refresh of the canvas LocationNode's asset arrays + status fields
 * while the Studio is closed. Today the studio's `useLocationStudioJobs` hook
 * polls the jobs table at fine granularity; when the studio is closed and a
 * worker writes to `atmosphere_motions` (or any other bucket), the canvas
 * node's count badge stays stale because nothing refreshes `node.data` until
 * the next studio open. This hook fills that gap.
 *
 * Polls every {@link POLL_INTERVAL_MS} when:
 *  - `locationDbId` is set (the location row exists in the DB)
 *  - AND `anyAssetRunning` is true (some bucket-status is "running")
 *  - AND the studio is NOT open for this node (avoid double-polling)
 *
 * Each poll calls `GET /v1/locations/:id` which returns the canonical bucket
 * arrays + `pendingJobs[]`. The hook:
 *  1. Patches `node.data` with the refreshed bucket arrays (so badge counts
 *     reflect worker appends).
 *  2. Clears `*Status` fields for assetTypes that have NO matching pendingJob
 *     (i.e., the gen completed; we should drop the "running" indicator).
 *
 * Hard stop after {@link MAX_POLL_DURATION_MS} to avoid runaway polling if a
 * worker dies without clearing its job row.
 */

const POLL_INTERVAL_MS = 6_000
const MAX_POLL_DURATION_MS = 30 * 60 * 1_000 // 30 min hard stop

/**
 * Map of bucket → status-field name + pendingJob.assetType strings that mean
 * "this bucket has an in-flight gen". The route sets `pendingJob.assetType`
 * from `input_data.assetType` on the original generate-location-* job; the
 * generate-location-asset route uses the bucket name verbatim (`"timeOfDay"`,
 * `"weather"`, …), and the generate-location-motion route uses
 * `"atmosphere_motions"` (see `routes/generate-location-motion.ts`).
 */
const BUCKET_STATUS_MAP: ReadonlyArray<{
  statusField: keyof LocationNodeData
  assetTypeMatches: ReadonlyArray<string>
}> = [
  { statusField: "timeOfDayStatus",   assetTypeMatches: ["timeOfDay"] },
  { statusField: "weatherStatus",     assetTypeMatches: ["weather"] },
  { statusField: "seasonsStatus",     assetTypeMatches: ["seasons"] },
  { statusField: "anglesStatus",      assetTypeMatches: ["angles"] },
  { statusField: "lightingStatus",    assetTypeMatches: ["lighting"] },
  { statusField: "atmosphereStatus",  assetTypeMatches: ["atmosphere_motions", "motion"] },
]

export function useLocationDataSubscription(args: {
  nodeId: string
  locationDbId: string | undefined
  anyAssetRunning: boolean
  currentNodeData: LocationNodeData
}): void {
  const { nodeId, locationDbId, anyAssetRunning, currentNodeData } = args
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const locationStudioOpen = useWorkflowStore(
    (s) => s.locationStudioNodeId === nodeId,
  )
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    if (!locationDbId || !anyAssetRunning || locationStudioOpen) {
      startTimeRef.current = null
      return
    }
    startTimeRef.current = Date.now()

    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      if (Date.now() - (startTimeRef.current ?? 0) > MAX_POLL_DURATION_MS) {
        return // hard stop; user must reopen the studio to recover
      }
      try {
        const loc = await getLocationById(locationDbId)
        if (cancelled || !loc) return

        const patch: Partial<LocationNodeData> = {
          timeOfDay:         loc.timeOfDay,
          weather:           loc.weather,
          seasons:           loc.seasons,
          angles:            loc.angles,
          lighting:          loc.lighting,
          atmosphereMotions: loc.atmosphereMotions,
        }

        // Clear running status for buckets whose pendingJobs have drained.
        const pending = loc.pendingJobs ?? []
        for (const { statusField, assetTypeMatches } of BUCKET_STATUS_MAP) {
          const currentStatus = currentNodeData[statusField]
          if (currentStatus !== "running") continue
          const stillPending = pending.some((j) =>
            assetTypeMatches.includes(j.assetType),
          )
          if (!stillPending) {
            (patch as Record<string, unknown>)[statusField] = "idle"
          }
        }

        updateNodeData(nodeId, patch)
      } catch {
        // Best-effort polling; transient errors are silent.
      }
    }

    tick()
    const interval = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [
    nodeId,
    locationDbId,
    anyAssetRunning,
    locationStudioOpen,
    updateNodeData,
    currentNodeData,
  ])
}
