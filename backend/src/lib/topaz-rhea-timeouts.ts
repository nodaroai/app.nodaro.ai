/**
 * How long a Rhea upscale run (the `topaz-rhea` provider, and Nodaro Video
 * Upscale's transparent mode) may wait on the engine, and when the reconcile
 * may take its row over. A pure leaf: the reconcile kinds
 * (lib/reconcile/types.ts) derive the `fal-rhea` staleness threshold from it,
 * and the fal provider bounds its wait by it, so the reconcile cron can never
 * take a row over while its worker is still waiting on the same request.
 *
 * The delivery after the wait (download, encode, upload) is not covered by a
 * time: both the worker and the reconcile take the finalize claim before it and
 * keep it fresh while it runs (lib/finalize-claim-hold.ts), so the worker and
 * the cron never both do the delivery work, and a dead worker's claim lapses
 * within the claim's TTL. (The claim is re-entrant per claimant name, so two
 * workers, or two overlapping cron ticks, could each deliver; the job still
 * completes once and is charged once.)
 */

const MIN = 60_000

/**
 * The longest the worker waits on one Rhea request, wall clock: 60 minutes,
 * past the longest run the route accepts (`TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS`).
 * A run still going after it is left to the reconcile, which reads the same
 * request. Measured from the request's stamp (`provider_call_started_at`):
 * a worker's re-pick that resumes the wait (the inline reconcile's
 * `pollToEnd`) waits out what is left of it, not a fresh hour.
 */
export const TOPAZ_RHEA_MAX_WAIT_MS = 60 * MIN

/**
 * The least a worker's re-pick waits on a request still running, even when
 * the original wait is (nearly) spent: a deploy at minute 59 still gets a
 * useful look. The re-pick moves the row's stamp so the cron's threshold falls
 * past this wait; each re-pick can add at most this much, and a queue job's
 * re-picks are finite.
 */
export const TOPAZ_RHEA_REPICK_MIN_WAIT_MS = 10 * MIN

/** How often a re-pick reads the request while it waits (the worker's own cadence). */
export const TOPAZ_RHEA_POLL_INTERVAL_MS = 3_000

/**
 * When a re-pick stops waiting: the original wait's end, or
 * {@link TOPAZ_RHEA_REPICK_MIN_WAIT_MS} from now, whichever is later. An
 * unknown stamp gets the least wait.
 */
export function topazRheaRepickDeadline(stampMs: number | undefined, nowMs: number): number {
  const floor = nowMs + TOPAZ_RHEA_REPICK_MIN_WAIT_MS
  return stampMs === undefined ? floor : Math.max(stampMs + TOPAZ_RHEA_MAX_WAIT_MS, floor)
}

/** Headroom between the worker's last possible poll and the reconcile cron taking the row over. */
export const TOPAZ_RHEA_STALE_MARGIN_MS = 15 * MIN

/**
 * The staleness threshold of the `fal-rhea` reconcile kind: the worker's
 * longest wait plus the margin (75 minutes). It must stay inside the reconcile
 * envelope (18 attempts of the 5-minute cron less 15 minutes of headroom,
 * 75 minutes) — `reconcile/__tests__/types.test.ts` holds both.
 */
export function topazRheaStaleThresholdMs(): number {
  return TOPAZ_RHEA_MAX_WAIT_MS + TOPAZ_RHEA_STALE_MARGIN_MS
}
