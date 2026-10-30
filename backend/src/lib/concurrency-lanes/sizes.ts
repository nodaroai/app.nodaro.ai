// backend/src/lib/concurrency-lanes/sizes.ts — how many jobs a line runs at
// once, the providers' platform ceilings, the waiting limits, and whether
// lanes are enforced.
//
// Community / Business (no credits): one env-configured size per lane
// (LANE_*_PER_USER) for every line, and no provider ceilings.
// Cloud: the per-plan table with per-user overrides, read from the shared
// database behind a hasCredits() dynamic import, is added later; until then a
// line is sized by the code defaults of its tier.
import { config, hasCredits } from "../config.js"
import { defaultLaneSizesForTier } from "./defaults.js"
import type { LaneSizes, PayerKey } from "./types.js"

export { defaultLaneSizesForTier } from "./defaults.js"

/** How long a queued job may wait for a slot, and how long a live (sync HTTP) call may wait. */
export interface LaneSettings { queueTimeoutMs: number; liveWaitLimitMs: number }

/** The line being sized: who works, who pays, and the payer's plan tier. */
export interface LaneSubject {
  userId: string
  payer: PayerKey
  /**
   * The payer's plan tier. On Cloud the Cloud reader resolves a personal or
   * deployment line's tier itself; `null` (a row-derived personal line) only
   * matters to the interim code defaults, which size it as free.
   */
  tier: string | null
}

const MINUTE_MS = 60_000

/** The sizes of a line. Config is read per call, so a test or a restart-free change is seen at once. */
export async function laneSizesFor(subject: LaneSubject): Promise<LaneSizes> {
  if (!hasCredits()) {
    return {
      provider: config.LANE_PROVIDER_PER_USER,
      llm: config.LANE_LLM_PER_USER,
      local: config.LANE_LOCAL_PER_USER,
      run: config.LANE_RUN_PER_USER,
    }
  }
  // Cloud: the per-plan table and per-user overrides come with the Cloud reader
  // (ee/concurrency-lanes); until it exists, the tier's code defaults.
  return defaultLaneSizesForTier(subject.tier ?? "free")
}

/**
 * The providers' platform ceilings (provider id → running jobs at most). A
 * provider absent from the map has none. Community / Business have none; on
 * Cloud they are admin-set, and the Cloud reader supplies them. The gate owns
 * the live copy (`ConcurrencyGate.setProviderCeilings`); this is the source the
 * enforcement mirror copies into it.
 */
export async function providerCeilings(): Promise<Record<string, number>> {
  return {}
}

/** The waiting limits. The env values in every edition until the Cloud reader adds the admin settings. */
export async function laneSettings(): Promise<LaneSettings> {
  return {
    queueTimeoutMs: config.LANE_QUEUE_TIMEOUT_MINUTES * MINUTE_MS,
    liveWaitLimitMs: config.LANE_LIVE_WAIT_MINUTES * MINUTE_MS,
  }
}

const ENFORCED_READ_WARN_EVERY_MS = 60_000
let lastEnforcedReadWarnAt = -Infinity

/**
 * Whether lanes are enforced in this environment: the gate's Redis flag, false
 * while it is unset. The flag is mirrored from the setting (LANES_ENFORCED on
 * Community / Business) by the enforcement mirror, never read from config here.
 * Fails open: a Redis error, or no answer within the gate's call timeout
 * (an unreachable Redis), reads as off (today's behaviour: nothing waits),
 * with a warning at most once a minute. The gate instance is imported lazily:
 * it opens the queue's Redis connection.
 */
export async function lanesEnforced(): Promise<boolean> {
  try {
    const { concurrencyGate } = await import("./instance.js")
    return await concurrencyGate().isEnforced()
  } catch (err) {
    const now = Date.now()
    if (now - lastEnforcedReadWarnAt >= ENFORCED_READ_WARN_EVERY_MS) {
      lastEnforcedReadWarnAt = now
      console.warn(`[concurrency-lanes] could not read the enforcement flag, treating lanes as not enforced: ${(err as Error).message}`)
    }
    return false
  }
}
