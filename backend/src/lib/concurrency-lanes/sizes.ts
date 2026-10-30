// backend/src/lib/concurrency-lanes/sizes.ts — how many jobs a line runs at
// once, the providers' platform ceilings, the waiting limits, and whether
// lanes are enforced.
//
// Community / Business (no credits): one env-configured size per lane
// (LANE_*_PER_USER) for every line, no provider ceilings, and the env waiting
// limits.
// Cloud: the per-plan table, the per-account overrides, the provider ceilings
// and the admin waiting limits, read from the shared database by
// ee/concurrency-lanes/plan-sizes.ts — loaded with a dynamic import behind
// hasCredits(), never statically (core does not import ee/). If that import or
// its read throws, the code defaults answer: the tier's default sizes, no
// ceilings, the env waiting limits.
import { config, hasCredits } from "../config.js"
import { FALLBACK_TIER as DEPLOYMENT_FALLBACK_TIER } from "../deployment-payer.js"
import { defaultLaneSizesForTier, LANE_PLAN_TIERS } from "./defaults.js"
import type { LaneSizes, PayerKey } from "./types.js"

export { defaultLaneSizesForTier } from "./defaults.js"

/** How long a queued job may wait for a slot, and how long a live (sync HTTP) call may wait. */
export interface LaneSettings { queueTimeoutMs: number; liveWaitLimitMs: number }

/** The line being sized: who works, who pays, and the payer's plan tier. */
export interface LaneSubject {
  userId: string
  payer: PayerKey
  /**
   * The payer's plan tier. A workspace line is sized by it (the caller's
   * `entitlements.tierForGates`). On Cloud a personal or deployment line's
   * tier is read from the paying account's profile; this one is then only the
   * fallback when that read fails, and `null` (a row-derived personal line)
   * falls back to free — on a deployment line, to the deployment payer's
   * fallback grade (deployment-payer.ts), as does a tier with no sizes.
   */
  tier: string | null
}

const MINUTE_MS = 60_000

type CloudReader = typeof import("../../ee/concurrency-lanes/plan-sizes.js")

/**
 * The Cloud reader, one import per process (the credit-guard pattern: no
 * per-call import promise for a test run to tear down mid-load). A rejected
 * import is forgotten, so the next call tries again.
 */
let cloudReaderPromise: Promise<CloudReader> | null = null
function loadCloudReader(): Promise<CloudReader> {
  if (!cloudReaderPromise) {
    const p = import("../../ee/concurrency-lanes/plan-sizes.js")
    cloudReaderPromise = p
    p.catch(() => {
      if (cloudReaderPromise === p) cloudReaderPromise = null
    })
  }
  return cloudReaderPromise
}

const CLOUD_READ_WARN_EVERY_MS = 60_000
let lastCloudReadWarnAt = -Infinity

/** The Cloud reader's answer, or `fallback` (with a warning at most once a minute) when it throws. */
async function fromCloud<T>(read: (reader: CloudReader) => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await read(await loadCloudReader())
  } catch (err) {
    const now = Date.now()
    if (now - lastCloudReadWarnAt >= CLOUD_READ_WARN_EVERY_MS) {
      lastCloudReadWarnAt = now
      console.warn(`[concurrency-lanes] the Cloud lane config could not be read, using the code defaults: ${(err as Error)?.message ?? String(err)}`)
    }
    return fallback()
  }
}

function envLaneSettings(): LaneSettings {
  return {
    queueTimeoutMs: config.LANE_QUEUE_TIMEOUT_MINUTES * MINUTE_MS,
    liveWaitLimitMs: config.LANE_LIVE_WAIT_MINUTES * MINUTE_MS,
  }
}

/**
 * The tier a line is sized at by the code defaults (the Cloud config could not
 * be read): its hint, else free — but a deployment line whose hint is missing
 * or has no sizes of its own runs at the deployment payer's fallback grade,
 * never free, as deployment-payer.ts sizes its parallelism.
 */
function codeDefaultTierOf(subject: LaneSubject): string {
  if (subject.payer.startsWith("deployment:")) {
    const hint = subject.tier
    return hint !== null && (LANE_PLAN_TIERS as readonly string[]).includes(hint) ? hint : DEPLOYMENT_FALLBACK_TIER
  }
  return subject.tier ?? "free"
}

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
  return fromCloud(
    (reader) => reader.cloudLaneSizesFor(subject),
    () => defaultLaneSizesForTier(codeDefaultTierOf(subject)),
  )
}

/**
 * The providers' platform ceilings (provider id → running jobs at most). A
 * provider absent from the map has none. Community / Business have none; on
 * Cloud they are admin-set (lane_provider_ceilings). The gate owns
 * the live copy (`ConcurrencyGate.setProviderCeilings`); this is the source the
 * enforcement mirror copies into it.
 */
export async function providerCeilings(): Promise<Record<string, number>> {
  if (!hasCredits()) return {}
  return fromCloud((reader) => reader.cloudProviderCeilings(), () => ({}))
}

/**
 * The ceilings to replace the gate's copy with, or `null` when they could not
 * be read (the Cloud reader failed to load, or the table could not be read and
 * no good read is cached) — the caller then leaves the gate's ceilings as they
 * are rather than clearing them all. An empty table, and Community / Business,
 * answer `{}`.
 */
export async function providerCeilingsForGate(): Promise<Record<string, number> | null> {
  if (!hasCredits()) return {}
  return fromCloud<Record<string, number> | null>((reader) => reader.cloudProviderCeilingsAsRead(), () => null)
}

/** The waiting limits: the env values on Community / Business; on Cloud the admin settings, the env values where unset. */
export async function laneSettings(): Promise<LaneSettings> {
  if (!hasCredits()) return envLaneSettings()
  return fromCloud((reader) => reader.cloudLaneSettings(), envLaneSettings)
}

const ENFORCED_READ_WARN_EVERY_MS = 60_000
let lastEnforcedReadWarnAt = -Infinity

/** The enforcement value this process last copied into the gate; null until it first did. */
let lastAppliedEnforced: boolean | null = null

/** For the enforcement mirror (enforcement.ts): the value it just copied into the gate. */
export function noteEnforcedApplied(on: boolean): void {
  lastAppliedEnforced = on
}

/**
 * Whether lanes are enforced, as this process last copied the setting into the
 * gate (the enforcement mirror, every 30 s, or the admin switch): no Redis
 * call, so up to one mirror interval behind. False until the first copy. For a
 * hot or public read that must not wait on Redis; a decision that admits or
 * parks work reads `lanesEnforced()`.
 */
export function lastMirroredEnforced(): boolean {
  return lastAppliedEnforced === true
}

/** For tests: forget the copied value. */
export function resetLastMirroredEnforcedForTests(): void {
  lastAppliedEnforced = null
}

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
