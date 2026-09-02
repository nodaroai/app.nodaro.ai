import {
  SEEDANCE_2_REF_LIMITS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  checkRefVideoDurations,
} from "@nodaro/shared"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"

/**
 * Reference-video ffprobe — CORE, deliberately not `ee/`.
 *
 * Callers with different edition profiles share this one probe:
 *   - the video routes' `validateRefVideoDurationPreHandler` (core), which
 *     rejects an out-of-bounds clip BEFORE any job or reservation exists. That
 *     is INPUT VALIDATION, not a credit feature: it must run in community and
 *     business too, where an over-long clip is just as certain to be rejected
 *     by the provider mid-run.
 *   - the DAG's `executeWorkerNode` (core), which runs the same gate before it
 *     reserves or dispatches an orchestrated node.
 *   - `ee/billing/seedance2-ref-video-credits.ts` and
 *     `ee/billing/minimax-h3-credits.ts`, which price the run from the same
 *     durations (cloud only).
 *
 * PROVIDER-AGNOSTIC: nothing here is seedance-specific. The caps come from
 * `VIDEO_REF_LIMITS_BY_PROVIDER` and the bounds from
 * `VIDEO_REF_VIDEO_DURATION_LIMITS`, so a provider is covered the moment it has
 * a row in those maps.
 *
 * Living here is what keeps `credit-guard-impl.ts`'s contract true — "community
 * and business builds free of any credit-system code at runtime": the
 * preHandler imports THIS module statically and never reaches into `ee/`, so no
 * billing module is loaded in an edition that has no billing. ee -> core is the
 * allowed direction, so the pricing helper simply re-exports what it needs.
 */

/**
 * The number of reference-video URLs this PROVIDER actually accepts.
 *
 * R16: `SEEDANCE_2_REF_LIMITS.videos` is 3 (the 2.0 family), but seedance-2-5
 * accepts 10 and the routes' Zod ceiling agrees (`SEEDANCE_2_5_REF_LIMITS`).
 * Slicing with the 2.0 constant silently skipped clips 4-10 on 2.5 — they were
 * never probed, so the run was UNDER-reserved (and would also have escaped the
 * duration check). Same provider-spread `validateSeedance2AudioPreHandler`
 * uses for its audio cap.
 *
 * This is ALSO what keeps a probed/priced set equal to the SENT set for a
 * provider whose cap is below the routes' flat wire ceiling: minimax-h3 caps
 * videos at 3 (`VIDEO_REF_LIMITS_BY_PROVIDER["minimax-h3"]`), which is exactly
 * what `resolveSeedance2Inputs` forwards, while the routes' Zod accepts up to
 * `SEEDANCE_2_5_REF_LIMITS.videos` (10) for every provider.
 */
export function refVideoCapFor(provider: string): number {
  return { ...SEEDANCE_2_REF_LIMITS, ...(VIDEO_REF_LIMITS_BY_PROVIDER[provider] ?? {}) }.videos
}

/**
 * ffprobe the connected reference videos and return the RAW per-URL durations,
 * in request order.
 *
 * Probe once, use twice: the same pass that lets the route reject an
 * out-of-bounds clip before a job exists also prices the run in cloud
 * (`seedance2RefVideoBaseCreditsFromDurations`).
 *
 * A rejected probe (or a NaN/<=0 duration) is reported VERBATIM as `NaN`, not
 * dropped: the pricing side must still charge the worst case for that clip,
 * while the duration CHECK ignores it (`checkRefVideoDurations`, @nodaro/shared).
 * Dropping it here would silently lower the reservation.
 *
 * - At most `refVideoCapFor(provider)` URLs are probed (the route's Zod cap for
 *   that provider), so we never ffprobe an unbounded list.
 * - Non-string / empty entries are ignored (they contribute nothing at all —
 *   neither a duration nor a worst case).
 */
export async function probeRefVideoDurations(args: {
  provider: string
  referenceVideoUrls: readonly unknown[]
}): Promise<number[]> {
  const candidates = args.referenceVideoUrls
    .slice(0, refVideoCapFor(args.provider))
    .filter((u): u is string => typeof u === "string" && u.length > 0)

  const settled = await Promise.allSettled(candidates.map((u) => probeMediaDuration(u)))
  return settled.map((r) => (r.status === "fulfilled" ? r.value : NaN))
}

/** Outcome of {@link probeAndCheckRefVideoDurations}. */
export type RefVideoDurationCheck =
  /** In bounds, or nothing to check. `durationsSec` is present only when a
   *  probe actually ran, and carries RAW outcomes (a failed probe is NaN). */
  | { ok: true; durationsSec?: number[] }
  /** Out of bounds — `message` is a finished, user-facing sentence. */
  | { ok: false; durationsSec: number[]; message: string }

/**
 * Probe the connected reference videos and check them against the provider's
 * declared duration bounds — the SINGLE implementation of the gate, shared by
 * every lane that can start a reference-video run:
 *
 *   - the routes' `validateRefVideoDurationPreHandler` → 400 `video_too_long`
 *     before creditGuard, `insertJob` and any reservation;
 *   - the DAG's `executeWorkerNode` → a coded throw before the reservation and
 *     the queue dispatch.
 *
 * Neither lane re-derives "which providers have a limit" or "how many clips do
 * we probe" — both live here, so a new row in
 * `VIDEO_REF_VIDEO_DURATION_LIMITS` covers single-node runs, workflow runs and
 * published-app runs at once.
 *
 * Never throws: an ffprobe rejection arrives as NaN and is IGNORED by
 * `checkRefVideoDurations`, so a probe blip can never manufacture a rejection.
 * The raw durations are returned either way so the caller can price from them
 * instead of paying for a second ffprobe pass (R15) — the pricing side charges
 * a worst case for the NaN entry, which is why they are not filtered here.
 */
export async function probeAndCheckRefVideoDurations(args: {
  provider: string | undefined
  referenceVideoUrls: unknown
}): Promise<RefVideoDurationCheck> {
  const provider = args.provider ?? ""
  const urls = args.referenceVideoUrls
  if (!Array.isArray(urls) || urls.length === 0) return { ok: true }
  // Data-driven gate: a provider with no VERIFIED bound is never probed here,
  // so this adds no work — and no false rejection — to any other lane.
  if (!VIDEO_REF_VIDEO_DURATION_LIMITS[provider]) return { ok: true }

  const durationsSec = await probeRefVideoDurations({ provider, referenceVideoUrls: urls })
  const check = checkRefVideoDurations(provider, durationsSec)
  return check.ok ? { ok: true, durationsSec } : { ok: false, durationsSec, message: check.message }
}
