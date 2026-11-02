import { getCachedTier } from "@/hooks/use-auth"
import { getMyLanes, type MyLanes } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { TIER_PARALLELISM } from "@/lib/pricing-data"

/** How long a read of the server's line sizes stands before the next fan-out refreshes it (the server's own enforcement mirror refreshes this often). */
export const LANE_SIZES_REFRESH_MS = 30_000
/** How long one read of the line sizes may take before it is dropped. */
export const LANE_SIZES_TIMEOUT_MS = 10_000

/** The last answer of `GET /v1/me/lanes` per workflow (`""`: no workflow yet). */
const answers = new Map<string, { readonly lanes: MyLanes; readonly at: number }>()
/** When each workflow's read last started, so a refresh starts at most once per LANE_SIZES_REFRESH_MS. */
const startedAt = new Map<string, number>()

const keyOf = (workflowId: string | null | undefined): string => workflowId || ""

/**
 * Read the caller's line sizes for this workflow in the background, unless a
 * read started within LANE_SIZES_REFRESH_MS. Never throws and is never
 * awaited by a run: the editor prefetches it when a workflow opens
 * (useLaneSizesPrefetch), and a fan-out that finds the answer older than that
 * starts the next one. A failed read keeps the last answer.
 */
export function refreshLaneSizes(workflowId: string | null | undefined, now: number = Date.now()): void {
  const key = keyOf(workflowId)
  const last = startedAt.get(key)
  if (last !== undefined && now - last < LANE_SIZES_REFRESH_MS) return
  startedAt.set(key, now)
  void getMyLanes({ workflowId: key || undefined, signal: AbortSignal.timeout(LANE_SIZES_TIMEOUT_MS) })
    .then((lanes) => {
      // Only a well-formed answer is kept; anything else leaves the last one.
      if (isMyLanes(lanes)) answers.set(key, { lanes, at: Date.now() })
    })
    .catch(() => {})
}

/** Whether `value` is an answer of `GET /v1/me/lanes` this can read: `enforced` a boolean, `lines` an array. */
function isMyLanes(value: unknown): value is MyLanes {
  const v = value as { enforced?: unknown; lines?: unknown } | null
  return typeof v === "object" && v !== null && typeof v.enforced === "boolean" && Array.isArray(v.lines)
}

/** The width without concurrency lanes: the plan's per-tier table on Cloud, 12 elsewhere. */
function tierWidth(): number {
  return hasCredits() ? (TIER_PARALLELISM[getCachedTier()] ?? TIER_PARALLELISM.free) : 12
}

/**
 * How many items of a list the editor runs at once — answered at once, from
 * what is cached now; it never waits for the server.
 *
 * When the last answer of `GET /v1/me/lanes` for this workflow says lanes are
 * enforced, it is the provider lane size of the line the workflow's jobs are
 * billed to (the `current` line, asked for with the workflow id so the
 * workflow's own workspace wins): starting more would only park the rest in
 * that line. The per-tier table holds the provider sizes too, so this replaces
 * it one for one. With no answer yet, a failed read, a malformed answer,
 * `enforced: false`, or a size that is not a positive number, it is exactly
 * today's table — never a failed run.
 */
export function listFanOutWidth(workflowId: string | null | undefined, now: number = Date.now()): number {
  const key = keyOf(workflowId)
  const cached = answers.get(key)
  if (!cached || now - cached.at >= LANE_SIZES_REFRESH_MS) refreshLaneSizes(workflowId, now)
  const fallback = tierWidth()
  if (cached?.lanes.enforced !== true) return fallback
  const line = cached.lanes.lines.find((l) => typeof l === "object" && l !== null && l.current === true)
  const size = (line?.sizes as { provider?: unknown } | undefined)?.provider
  return typeof size === "number" && Number.isFinite(size) && size >= 1 ? Math.floor(size) : fallback
}

/** For tests: forget every answer and every read. */
export function resetLaneSizesForTests(): void {
  answers.clear()
  startedAt.clear()
}
