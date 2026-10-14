import { supabase } from "../../lib/supabase.js"
import { FREE_VIDEO_LIMITS_DEFAULTS, type FreeVideoLimits } from "../billing/free-video-limits.js"

/**
 * The free-credit video limits' runtime knobs (`billing/free-video-limits.ts`)
 * — two `app_settings` rows, read with a 60 s cache like
 * `signup-grant-config.ts`, so an admin changes them without a deploy:
 *
 *  - `free_video_limits` — false turns the whole rule off (default on).
 *  - `free_video_max_seconds` — the longest clip free credits may generate
 *    (default 4, an integer 1–60).
 *
 * Absent rows are the defaults. A transient read error keeps the last good
 * answer and retries soon; a cold cache falls back to the defaults.
 */
export const FREE_VIDEO_LIMITS_KEY = "free_video_limits"
export const FREE_VIDEO_MAX_SECONDS_KEY = "free_video_max_seconds"

const CACHE_TTL_MS = 60_000
const ERROR_RETRY_MS = 5_000
let cached: FreeVideoLimits | null = null
let cachedAt = 0
let inflight: Promise<FreeVideoLimits> | null = null

/** Only an integer from 1 to 60 counts; anything else is the default. */
export function parseFreeVideoMaxSeconds(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 60
    ? value
    : FREE_VIDEO_LIMITS_DEFAULTS.maxSeconds
}

export async function getFreeVideoLimits(): Promise<FreeVideoLimits> {
  const now = Date.now()
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached
  if (inflight) return inflight
  inflight = refresh()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

async function readRows(): Promise<FreeVideoLimits | null> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [FREE_VIDEO_LIMITS_KEY, FREE_VIDEO_MAX_SECONDS_KEY])
    if (error) return null
    const limits: FreeVideoLimits = { ...FREE_VIDEO_LIMITS_DEFAULTS }
    for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
      if (row.key === FREE_VIDEO_LIMITS_KEY) limits.enabled = row.value !== false
      if (row.key === FREE_VIDEO_MAX_SECONDS_KEY) limits.maxSeconds = parseFreeVideoMaxSeconds(row.value)
    }
    return limits
  } catch {
    return null
  }
}

async function refresh(): Promise<FreeVideoLimits> {
  const read = await readRows()
  if (read) {
    cached = read
    cachedAt = Date.now()
    return cached
  }
  const fallback = cached ?? { ...FREE_VIDEO_LIMITS_DEFAULTS }
  cached = fallback
  cachedAt = Date.now() - CACHE_TTL_MS + ERROR_RETRY_MS
  return fallback
}

/** Tests: forget the cached rows. */
export function invalidateFreeVideoLimitsCache(): void {
  cached = null
  cachedAt = 0
}
