/**
 * How long a background scrape (Web Scrape or Meta Ads Library scrape answered
 * with a job id, Site Capture, Instagram scrape) may take on the video worker,
 * read by the backend (its worker's lock, the reconcile sweep) and by the
 * editor (how long it polls a scrape). One home, so the editor never gives up
 * on a scrape the server is still finishing.
 */

/** The video worker's BullMQ job lock: a job whose worker died is free for another worker once it expires. */
export const VIDEO_WORKER_LOCK_DURATION_MS = 300_000

/** How often the video worker looks for such jobs (BullMQ's stalled check). */
export const VIDEO_WORKER_STALLED_INTERVAL_MS = 60_000

/** How many times a job may be re-picked after its worker died before BullMQ gives it up. */
export const VIDEO_WORKER_MAX_STALLED_COUNT = 3

/**
 * The longest one attempt of a background scrape takes: its provider run
 * (an Apify actor's wait, or the connected cloud's poll budget), then the media
 * copy and the AI analysis under the run's own deadline, then the settle. The
 * backend holds every one of those bounds to it (a guard test).
 */
export const BACKGROUND_SCRAPE_ATTEMPT_MAX_MS = 20 * 60_000

/**
 * How long a client waits for a background scrape before it reports that it
 * did not finish: a worst case that survives one deploy — a whole attempt, the
 * wait until another worker re-picks the job (the lock running out, then a
 * stalled check), and a whole attempt again (a re-picked scrape re-attaches to
 * its provider run, then copies its media and runs its analysis again).
 */
export const BACKGROUND_SCRAPE_POLL_BUDGET_MS =
  2 * BACKGROUND_SCRAPE_ATTEMPT_MAX_MS + VIDEO_WORKER_LOCK_DURATION_MS + VIDEO_WORKER_STALLED_INTERVAL_MS
