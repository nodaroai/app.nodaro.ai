/** The podcast pack job's `job_type` and `provider` (lib/use-case/pack-cover.ts). A leaf: the cancel paths read it. */
export const PODCAST_PACK_JOB_TYPE = "podcast-pack"

/**
 * The statuses of a pack that did not go ahead: it failed (and was refunded,
 * lib/reconcile/podcast-pack-sweep.ts and the route's own failure path) or was
 * cancelled. Its tool runs are stopped; a continuation of one is charged as
 * an ordinary run.
 */
export const VOID_PACK_STATUSES: readonly string[] = ["failed", "cancelled"]

/**
 * A pack held for review (decided 2026-11-18): suspected abuse, so EVERYTHING
 * stops — its tool runs are stopped, a continuation of one is refused (never
 * charged in its place), and nothing new starts under it.
 */
export const HELD_PACK_STATUSES: readonly string[] = ["pending_review"]
