/**
 * How long a GENERATED video is before it has run, for the listing: never
 * shorter than the length the generation renders, nor than the length the
 * run of the step after it is charged at (review round, decided 2026-10-07).
 *
 * The step after it (Trim, Loop, Combine Videos) is reserved on the length
 * `extractVideoDurationFromNode` reads from the generation's data
 * (input-resolver.ts): the raw configured duration, or the estimators'
 * fallback (`VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS`) when none is set.
 * The listing takes the longer of that and the rendered length below, so it
 * is never below the charge, whichever of the two a run prices.
 *
 * The rendered length is read by the rule the generation's own run is priced
 * by, step for step (payload-builder.ts, the `image-to-video`,
 * `text-to-video` and `generate-video` cases):
 *   1. the provider: the node's, else the run's default
 *      (`applyDefaultVideoSelection` for Generate Video,
 *      {@link LEGACY_VIDEO_NODE_DEFAULT_PROVIDER} for the legacy two);
 *   2. the catalog normalisation the run applies (`resolveVideoRequestNorm`:
 *      LTX's seeded duration tiers, at the node's resolution or the UI fill);
 *   3. `pricedOutputDurationSec`: the requested seconds, else the length the
 *      run prices an unset duration at, the longest clip for AUTO.
 *
 * The listing reads the result to price a Trim, Loop, Combine Videos or Video SFX fed
 * by the generation (`wireInputLength` in ee/billing/credits.ts). A node that
 * names several providers runs each, so its length is the longest of theirs;
 * Generate Video's provider also depends on the run's mode (a split-id model
 * resolves to its i2v or t2v twin), which a listing cannot see, so both twins
 * are read and the longer kept: never shorter than a run's.
 */
import {
  applyDefaultVideoSelection,
  extractVideoDurationFromNode,
  pricedOutputDurationSec,
  resolveVideoProviderForMode,
  uiResolutionFill,
  VIDEO_UTIL_PRICING,
} from "@nodaro/shared"
import { nodeProviders } from "@nodaro/render-rules"
import { resolveVideoRequestNorm } from "./video-request-norm.js"

/** The provider a legacy Image to Video / Text to Video node runs when it names none. */
export const LEGACY_VIDEO_NODE_DEFAULT_PROVIDER = "kling"

/** The generation nodes whose output length is their configured duration. */
export const CONFIGURED_DURATION_VIDEO_TYPES: ReadonlySet<string> = new Set(["generate-video", "image-to-video", "text-to-video"])

/** The seconds one provider renders for this node's settings, as its run prices them. */
function providerLengthSec(provider: string, data: Record<string, unknown>): number {
  const duration = data.duration as number | string | undefined
  const norm = resolveVideoRequestNorm({
    provider,
    resolution: (data.resolution as string | undefined) ?? uiResolutionFill(provider),
    duration,
  })
  return pricedOutputDurationSec(provider, norm.duration ?? duration)
}

/**
 * The length, in seconds, of the video this node generates; `undefined` for a
 * node whose length is not its configured duration (Lip Sync, Extend Video,
 * Video to Video and every other step).
 */
export function generatedVideoLengthSec(node: { type?: string; data?: unknown }): number | undefined {
  const type = node.type ?? ""
  if (!CONFIGURED_DURATION_VIDEO_TYPES.has(type)) return undefined
  const data = (node.data ?? {}) as Record<string, unknown>
  const named =
    nodeProviders(type, data) ??
    [
      type === "generate-video"
        ? applyDefaultVideoSelection({ provider: data.provider as string | undefined }).provider
        : ((data.provider as string | undefined) ?? LEGACY_VIDEO_NODE_DEFAULT_PROVIDER),
    ]
  const providers =
    type === "generate-video"
      ? named.flatMap((p) => [resolveVideoProviderForMode(p, "image-to-video"), resolveVideoProviderForMode(p, "text-to-video")])
      : named
  const chargedSec = extractVideoDurationFromNode(data) ?? VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS
  return Math.max(chargedSec, ...providers.map((p) => providerLengthSec(p, data)))
}
