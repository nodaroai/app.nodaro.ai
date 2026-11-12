/**
 * Generate Video Pro's resolution rule, run by the backend (the pro pricing,
 * which echoes the tier the engine renders, and the `/v1/nodes` menu) and by
 * the editor (the config panel, the run strip and a published app's field),
 * so a menu can never offer a tier a run renders as another.
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { isMinimaxH3Provider, normalizeMinimaxH3Resolution } from "@nodaro/shared/models"

/** The tiers the rule speaks, low → high. */
const GVP_RESOLUTION_LADDER = ["480p", "720p", "1080p", "4k"] as const

/**
 * The resolution a Generate Video Pro run RENDERS (and is priced at) for the one
 * it is asked for: the pro pricing echoes this value and the engine renders it.
 *
 * A requested tier is read onto the ladder (480p / 720p / 1080p / 4k — anything
 * else counts as 480p) and clamped to the model's catalog resolutions (an
 * unsupported tier, e.g. a stale 1080p on seedance-2-mini, snaps to a real one
 * so every composite lookup is seeded).
 *
 * SNAPS TO THE NEAREST TIER, not the highest (2026-08-06). It used to take the
 * model's top tier, so asking for the CHEAPEST resolution a model lacks quoted
 * the priciest one it has: 480p on veo3 (720p/1080p/4k) priced and reserved
 * **4k**. Ties go to the cheaper tier: charging above what was asked for is
 * the worse of the two mistakes. Nearest is only safe because the clamped value
 * is echoed back and the render uses it.
 *
 * MiniMax Hailuo 3 has its own two-value space ("2K" default / "768P") and its
 * own collapse rule (`normalizeMinimaxH3Resolution`).
 */
export function gvpRenderResolution(provider: string, resolution: string): string {
  if (isMinimaxH3Provider(provider)) return normalizeMinimaxH3Resolution(resolution)
  const supported: readonly string[] = MODEL_CATALOG[provider]?.resolutions ?? ["480p", "720p", "1080p"]
  const want = resolution === "4k" ? "4k" : resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p"
  if (supported.includes(want)) return want
  const wantAt = GVP_RESOLUTION_LADDER.indexOf(want)
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  // Walked low → high, so an equidistant pair settles on the cheaper tier.
  for (const tier of GVP_RESOLUTION_LADDER) {
    if (!supported.includes(tier)) continue
    const distance = Math.abs(GVP_RESOLUTION_LADDER.indexOf(tier) - wantAt)
    if (distance < bestDistance) {
      best = tier
      bestDistance = distance
    }
  }
  // A catalog listing nothing this ladder knows keeps the old top-tier rule as
  // the backstop: still seeded, still never under-reserving.
  return best ?? supported[supported.length - 1] ?? "480p"
}

/**
 * Whether Generate Video Pro renders this resolution AS NAMED on this model —
 * the only resolutions its menus offer. A tier the model's catalog lists but
 * the pro run renders as another (Vidu Q4's 540p and 2K, Gemini Omni Flash
 * 1.2's 360p, PixVerse V6 Max's 360p and 540p — all 720p) is not offered; a
 * node that already carries one keeps it and runs exactly as before.
 */
export function gvpRendersResolutionAsNamed(provider: string, resolution: string): boolean {
  return gvpRenderResolution(provider, resolution) === resolution
}

/**
 * The resolutions a Generate Video Pro menu offers for a model, in its catalog's
 * spelling and order: its catalog tiers a pro run renders as named. The editor's
 * menus label these; a model without catalog resolutions offers none.
 */
export function gvpOfferedResolutions(provider: string): string[] {
  return ((MODEL_CATALOG[provider]?.resolutions ?? []) as readonly string[]).filter((r) => gvpRendersResolutionAsNamed(provider, r))
}
