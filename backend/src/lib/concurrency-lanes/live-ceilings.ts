// backend/src/lib/concurrency-lanes/live-ceilings.ts — how long a waiting live
// (sync HTTP) connection survives end to end, per transport, and so the most
// the live-wait limit may be set to. PROVISIONAL: these are not measured yet.
// The measurement replaces them (and sets LIVE_CEILINGS_MEASURED), and until
// it does the Admin enforcement switch lists "the live-wait ceiling has been
// measured" as unmet. No imports: the Cloud reader and the admin routes read
// the bounds from here.

/** Whether the values below come from a measurement. */
export const LIVE_CEILINGS_MEASURED = false

/** Seconds a waiting connection survives, per transport (provisional). */
export const LIVE_WAIT_CEILINGS_S: Readonly<{ json: number; sse: number; mcp: number }> = Object.freeze({
  json: 60,
  sse: 600,
  mcp: 45,
})

/**
 * The admin maximum of the live-wait limit, in minutes. Provisional at 60 (the
 * env range of LANE_LIVE_WAIT_MINUTES) until the measurement sets it from the
 * SSE ceiling.
 */
export const LIVE_WAIT_MAX_MINUTES = 60
