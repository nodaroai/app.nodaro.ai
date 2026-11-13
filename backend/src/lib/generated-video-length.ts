/**
 * How long a GENERATED video is before it has run, for the listing: never
 * shorter than the length the generation renders, nor than the length the
 * run of the step after it is charged at (review round, decided 2026-10-07).
 *
 * The step after it (Trim, Loop, Combine Videos) is reserved on the length
 * `extractVideoDurationFromNode` reads from the generation's data
 * (input-resolver.ts): the raw configured duration, or the estimators'
 * fallback (`VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS`) when none is set.
 * The listing takes the longer of that and the rendered length, so it is never
 * below the charge, whichever of the two a run prices.
 *
 * The rendered length is `@nodaro/render-rules`' `generatedVideoRenderedSec`:
 * the rule the generation's own run is priced by, the one the measured walk of
 * the run estimates reads too — a Seedance reference task type the node
 * declares included (an `edit` runs at AUTO, an `extend` turns AUTO into a set
 * length, only when a reference clip qualifies, which the listing cannot see:
 * read both ways, the longer kept). The floor above is the listing's alone: a
 * step that measures its input never reads a stored take for a node that
 * re-runs.
 */
import { extractVideoDurationFromNode } from "@nodaro/shared/video"
import { VIDEO_UTIL_PRICING } from "@nodaro/shared/credits"
import { generatedVideoRenderedSec } from "@nodaro/render-rules"

export { CONFIGURED_DURATION_VIDEO_TYPES, LEGACY_VIDEO_NODE_DEFAULT_PROVIDER } from "@nodaro/render-rules"

/**
 * The length, in seconds, of the video this node generates; `undefined` for a
 * node whose length is not its configured duration (Lip Sync, Extend Video,
 * Video to Video and every other step).
 */
export function generatedVideoLengthSec(node: { type?: string; data?: unknown }): number | undefined {
  const rendered = generatedVideoRenderedSec(node)
  if (rendered === undefined) return undefined
  const chargedSec = extractVideoDurationFromNode((node.data ?? {}) as Record<string, unknown>) ?? VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS
  return Math.max(chargedSec, rendered)
}
