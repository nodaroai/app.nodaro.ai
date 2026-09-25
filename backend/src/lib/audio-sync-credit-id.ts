/**
 * Audio Sync prices PER SOURCE ALIGNED to the reference (decided 2026-09-25):
 * `audio-sync:<n>src` = 10 × (n − 1) credits for n = 2..6 sources — the
 * reference itself is not aligned against anything, so 2 sources cost 10 and 6
 * cost 50. Local ffmpeg + in-process correlation, no provider cost; keyless on
 * every edition (community/business never reach a price).
 *
 * ONE identifier builder for every lane that names the row: the single-node
 * route's credit guard AND its reservation (`routes/audio-sync.ts`, from the
 * body's `sources.length`), the workflow run's reservation (payload-builder,
 * from the wired source count) and the pre-run estimator (`ee/billing/
 * credits.ts`, from the edge count). The rows themselves are generated here
 * from the one formula, spread into `STATIC_CREDIT_COSTS`, and mirrored by
 * the `model_pricing` rows of migration 443.
 *
 * The count is CLAMPED into 2..6 so a resolver never names an unpriced row:
 * the credit guard reads the RAW body before Zod runs, so a 7-source body must
 * still resolve a real id (Zod then 400s it before anything is reserved).
 *
 * Pure: imports only the dependency-free budget leaf.
 */
import { AUDIO_SYNC_MAX_SOURCES, AUDIO_SYNC_MIN_SOURCES } from "../providers/audio/audio-sync-budget.js"

/** Credits per source aligned to the reference. PROVISIONAL — re-derived from
 *  the staging cost probe before production (design §6.2). */
export const AUDIO_SYNC_CREDITS_PER_ALIGNED_SOURCE = 10

/** The source count a price is read at: clamped into the node's 2..6, and a
 *  non-finite count (no graph context) reads as the ceiling — an estimate may
 *  over-quote, never under-quote. */
export function audioSyncPricedSourceCount(sourceCount: number): number {
  if (!Number.isFinite(sourceCount)) return AUDIO_SYNC_MAX_SOURCES
  return Math.min(AUDIO_SYNC_MAX_SOURCES, Math.max(AUDIO_SYNC_MIN_SOURCES, Math.floor(sourceCount)))
}

/** `audio-sync:<n>src` for a run over `sourceCount` sources (clamped into 2..6). */
export function audioSyncCreditId(sourceCount: number): string {
  return `audio-sync:${audioSyncPricedSourceCount(sourceCount)}src`
}

/** Credits for `sourceCount` sources: 10 × (n − 1), n clamped into 2..6. */
export function audioSyncCredits(sourceCount: number): number {
  return AUDIO_SYNC_CREDITS_PER_ALIGNED_SOURCE * (audioSyncPricedSourceCount(sourceCount) - 1)
}

/** Every priced row — `STATIC_CREDIT_COSTS` spreads this; migration 443 seeds
 *  the same five `model_pricing` rows. */
export const AUDIO_SYNC_CREDIT_COSTS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    Array.from(
      { length: AUDIO_SYNC_MAX_SOURCES - AUDIO_SYNC_MIN_SOURCES + 1 },
      (_, i) => AUDIO_SYNC_MIN_SOURCES + i,
    ).map((n) => [audioSyncCreditId(n), audioSyncCredits(n)]),
  ),
)
