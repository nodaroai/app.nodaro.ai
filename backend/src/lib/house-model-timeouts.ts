/**
 * How long a house model's run may take, by id — the runner's poll budget
 * (`runHouseModelTask`'s `timeoutMs`) and its poll cadence. A pure leaf: the
 * reconcile kinds (lib/reconcile/types.ts) derive the house-model staleness
 * threshold from it, so the reconcile cron can never take a job over while its
 * worker is still polling (the double-finalize of 2026-06-10).
 *
 * EMPTY until a house model ships. A new house model adds ONE row to each map,
 * keyed by its catalog id and sized to its longest legitimate run, beside its
 * row in `house-model-lanes.ts` (docs/design/house-models.md). A served model
 * with no row runs on the defaults.
 */

const MIN = 60_000

/** The poll budget of a house model with no row of its own. */
export const DEFAULT_HOUSE_MODEL_TIMEOUT_MS = 10 * MIN

/** The pause between two status reads of a house model with no row of its own. */
export const DEFAULT_HOUSE_MODEL_POLL_INTERVAL_MS = 5_000

/** Per-id poll budget, in ms: the longest a run may poll before the worker gives it up. */
export const HOUSE_MODEL_TIMEOUT_MS: Readonly<Record<string, number>> = Object.freeze({})

/** Per-id pause between two status reads, in ms. */
export const HOUSE_MODEL_POLL_INTERVAL_MS: Readonly<Record<string, number>> = Object.freeze({})

/** The poll budget and cadence a run of `id` uses. */
export function houseModelTiming(id: string): { timeoutMs: number; pollIntervalMs: number } {
  return {
    timeoutMs: Object.hasOwn(HOUSE_MODEL_TIMEOUT_MS, id) ? HOUSE_MODEL_TIMEOUT_MS[id]! : DEFAULT_HOUSE_MODEL_TIMEOUT_MS,
    pollIntervalMs: Object.hasOwn(HOUSE_MODEL_POLL_INTERVAL_MS, id) ? HOUSE_MODEL_POLL_INTERVAL_MS[id]! : DEFAULT_HOUSE_MODEL_POLL_INTERVAL_MS,
  }
}

/** The longest run any house model may take: the default's, or a row's when longer. */
export function longestHouseModelTimeoutMs(rows: Readonly<Record<string, number>> = HOUSE_MODEL_TIMEOUT_MS): number {
  return Math.max(DEFAULT_HOUSE_MODEL_TIMEOUT_MS, ...Object.values(rows))
}

/** Headroom between the longest run and the reconcile cron taking a job over. */
export const HOUSE_MODEL_STALE_MARGIN_MS = 10 * MIN

/**
 * The staleness threshold of the house-model reconcile kind: the longest run
 * plus the margin. Derived, so a new row can never sit below it: a 60-minute
 * row makes it 70 minutes. It must stay inside the reconcile envelope (18
 * attempts of the 5-minute cron less 15 minutes of headroom, 75 minutes), so
 * no row may exceed 65 minutes (`house-models-tables.test.ts`).
 */
export function houseModelStaleThresholdMs(rows: Readonly<Record<string, number>> = HOUSE_MODEL_TIMEOUT_MS): number {
  return longestHouseModelTimeoutMs(rows) + HOUSE_MODEL_STALE_MARGIN_MS
}
