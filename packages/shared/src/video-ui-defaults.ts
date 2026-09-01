/**
 * UI-default fills for the unified video nodes — the ONE source of truth shared
 * by the backend DAG payload builder, the config-panel fail-safe snaps and the
 * node's hover/run strip.
 *
 * Several config panels RENDER a default without persisting it to node data, so
 * an untouched node submits `aspectRatio` / `resolution` undefined and the
 * enqueued job row (and the /v1/jobs echo) then disagrees with what actually
 * renders. Worse, the panels' generic snap writes `resolutions[0]` for a stale
 * value, which is the CHEAPEST tier under the repo's ascending-resolution
 * convention — not necessarily the tier the model renders and bills.
 *
 * These helpers were local to `backend/src/services/workflow-engine/payload-builder.ts`
 * until the Wan 3.0 launch gave the platform its first provider whose declared
 * billing default differs from `resolutions[0]`; three surfaces then had to
 * agree, so they live here.
 *
 * The resolution fill is per-family ON PURPOSE. Wan 3.0 reads its DECLARED
 * billing default (PRICING_DEFAULT_RESOLUTION = 720p) because its catalog list
 * is ascending, so an index-0 fill would write 480p — a tier both `runWan3`
 * (which renders 720P) and the credit identifier (which bills the 720p row)
 * disagree with. The Seedance family keeps its historical first-catalog-tier
 * fill, deliberately: switching it to PRICING_DEFAULT_RESOLUTION would reprice
 * live seedance-2-5 runs, whose declared default (720p) differs from the 480p
 * this has always filled. That 480p-fill vs 720p-billing-default divergence on
 * seedance-2-5 is a KNOWN pre-existing gap, out of scope here — do not "align"
 * the branches without repricing it deliberately.
 */

import {
  PRICING_DEFAULT_RESOLUTION,
  isSeedance2Provider,
  isMinimaxH3Provider,
  isWan3Provider,
  isGeminiOmniProvider,
} from "./model-constants.js"
import { MODEL_CATALOG } from "./model-catalog.js"

/** `adaptive` is the aspect default for Seedance 2, MiniMax H3 and Wan 3.0. */
export function uiAspectRatioFill(provider: string): string | undefined {
  return isSeedance2Provider(provider) || isMinimaxH3Provider(provider) || isWan3Provider(provider)
    ? "adaptive"
    : undefined
}

/** See the file docstring — per-family on purpose; never a generic
 *  PRICING_DEFAULT_RESOLUTION read (that would reprice seedance-2-5). */
export function uiResolutionFill(provider: string): string | undefined {
  if (isWan3Provider(provider)) return PRICING_DEFAULT_RESOLUTION[provider]
  if (isSeedance2Provider(provider)) return MODEL_CATALOG[provider]?.resolutions?.[0]
  return undefined
}

/**
 * Duration the node RENDERS and BILLS when `data.duration` is unset, for the
 * families whose credit identifier declares a duration fallback that is NOT
 * `durations[0]`. Wan 3.0's bare identifier is the 5s tier while its ladder
 * starts at 2s; the Gemini Omni family's is the 8s tier while its ladder starts
 * at 4s. Everyone else falls back to the first listed duration, so this returns
 * undefined and the caller keeps `durations[0]`.
 */
export function uiDurationFill(provider: string): number | undefined {
  if (isWan3Provider(provider)) return 5
  if (isGeminiOmniProvider(provider)) return 8
  return undefined
}
