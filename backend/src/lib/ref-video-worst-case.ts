import { VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared/models"

/**
 * A reference clip we could not measure (rejected ffprobe, NaN/≤0 duration)
 * counts as the LONGEST clip the provider accepts — the per-clip cap in
 * `VIDEO_REF_VIDEO_DURATION_LIMITS` (30s on Seedance 2.5), or the 2.0 family's
 * 15s total-input ceiling when the provider declares no bound. We must NEVER
 * under-reserve, because `commit_credits` only refunds a surplus and can never
 * collect an upward delta.
 *
 * Core and pure, so a core length estimate counts a clip it cannot see the way
 * the reservation does (lib/generated-video-length.ts);
 * `ee/billing/seedance2-ref-video-credits.ts` re-exports it.
 */
const REF_VIDEO_WORST_CASE_SEC = 15

export function refVideoWorstCaseSecFor(provider: string): number {
  return VIDEO_REF_VIDEO_DURATION_LIMITS[provider]?.maxSec ?? REF_VIDEO_WORST_CASE_SEC
}
