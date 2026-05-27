import {
  REF_IMAGE_MAX_LIMITS,
  DEFAULT_REF_IMAGE_MAX,
  MODELS_WITH_REFERENCE_IMAGE_SUPPORT,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  getModel,
  isSeedance2Provider,
} from "@nodaro/shared"
import {
  PROVIDERS_WITH_END_FRAME,
  PROVIDERS_WITH_REFERENCES,
} from "@/components/editor/config-panels/model-options"
import type { WorkflowNode } from "@/types/nodes"

export interface HandleConnectionLimit {
  /** Number of connections the runtime will actually consume on this
   *  handle for the consumer's current model. Connections beyond this
   *  count are wired but silently ignored at execution. */
  readonly limit: number
  /** Short human-readable identifier — provider id for single-provider
   *  nodes, "selected models" for multi-provider. Used in tooltip copy. */
  readonly providerLabel: string
  /** True when the consumer node is in multi-provider mode and the limit
   *  was computed from the MIN across selected providers; the tooltip
   *  should clarify "may not be used by all selected models". */
  readonly isMultiProviderMin: boolean
}

/**
 * Returns the effective MAX connection count for a given (node, handle)
 * pair, derived from the consumer's currently-selected model. The popover
 * uses this to show "M of N max" in the count label and to gray out any
 * wired rows past the limit (they're still saved with the workflow but
 * the runtime drops them).
 *
 * Returns `null` when there is no per-model limit for this handle — most
 * handles fall here.
 *
 * Currently covers Generate Image's `references` handle (the only handle
 * with a documented per-provider max). Extend to other handles (Assets,
 * etc.) when their limits become available in @nodaro/shared.
 */
export function getHandleConnectionLimit(
  node: WorkflowNode | undefined,
  handleId: string,
): HandleConnectionLimit | null {
  if (!node) return null

  if (node.type === "generate-image" && handleId === "references") {
    const data = node.data as { provider?: string; providers?: readonly string[] } | undefined
    const providers: readonly string[] =
      data?.providers && data.providers.length > 0
        ? data.providers
        : [data?.provider || "nano-banana-pro"]

    // Filter to providers that actually consume reference images — others
    // ignore them entirely, so their "limit" of zero would be misleading.
    const refConsumers = providers.filter((p) => MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(p))
    if (refConsumers.length === 0) return null

    // Multi-provider: pick the MIN limit across selected providers — past
    // that count, AT LEAST one provider will silently drop the ref. The
    // tooltip can clarify that this is the most-restrictive provider.
    let minLimit = Infinity
    for (const p of refConsumers) {
      const lim = REF_IMAGE_MAX_LIMITS[p] ?? DEFAULT_REF_IMAGE_MAX
      if (lim < minLimit) minLimit = lim
    }
    if (!Number.isFinite(minLimit)) return null

    return {
      limit: minLimit,
      providerLabel: refConsumers.length > 1 ? "selected models" : refConsumers[0],
      isMultiProviderMin: refConsumers.length > 1,
    }
  }

  // `generate-video` isn't yet in the SceneNodeType union (added in a
  // later task — Task 3.4 only widened EXECUTABLE_TYPES for the backend
  // parity check). Compare against the runtime string until the union
  // catches up.
  if ((node.type as string) === "generate-video") {
    const data = node.data as { provider?: string; seedance2InputMode?: "frames" | "references" } | undefined
    const provider = data?.provider ?? "kling"
    // Use the catalog label if available so the tooltip reads naturally
    // ("Beyond Kling 2.6's max" rather than "Beyond kling's max"); fall
    // back to the raw provider id when the catalog has no entry yet.
    const providerLabel = getModel(provider)?.label ?? provider
    const caps = VIDEO_REF_LIMITS_BY_PROVIDER[provider]
    // Seedance 2 mode toggle is mutually exclusive between Frames (start/end)
    // and References (image references). Force the inactive set's caps to 0
    // so the disabled-handle visual lights up the right pips for the chosen
    // mode. Default = "frames" (matches the seedance2InputMode fallback
    // throughout the codebase).
    const isS2 = isSeedance2Provider(provider)
    const s2Mode = isS2 ? (data?.seedance2InputMode ?? "frames") : null
    const s2FramesDisabled = s2Mode === "references"
    const s2ReferencesDisabled = s2Mode === "frames"
    switch (handleId) {
      case "startFrame":
        return s2FramesDisabled
          ? { limit: 0, providerLabel, isMultiProviderMin: false }
          : { limit: 1, providerLabel, isMultiProviderMin: false }
      case "endFrame":
        if (s2FramesDisabled) return { limit: 0, providerLabel, isMultiProviderMin: false }
        return PROVIDERS_WITH_END_FRAME.includes(provider)
          ? { limit: 1, providerLabel, isMultiProviderMin: false }
          : { limit: 0, providerLabel, isMultiProviderMin: false }
      case "imageReferences":
        if (s2ReferencesDisabled) return { limit: 0, providerLabel, isMultiProviderMin: false }
        return PROVIDERS_WITH_REFERENCES.includes(provider)
          ? { limit: caps?.images ?? 1, providerLabel, isMultiProviderMin: false }
          : { limit: 0, providerLabel, isMultiProviderMin: false }
      case "videoReferences": {
        const cap = caps?.videos
        return cap != null
          ? { limit: cap, providerLabel, isMultiProviderMin: false }
          : { limit: 0, providerLabel, isMultiProviderMin: false }
      }
      case "audio":
        return { limit: 1, providerLabel, isMultiProviderMin: false }
      case "audioReferences": {
        const cap = caps?.audio
        return cap != null
          ? { limit: cap, providerLabel, isMultiProviderMin: false }
          : { limit: 0, providerLabel, isMultiProviderMin: false }
      }
      default:
        return null
    }
  }

  // Video SFX — single video producer feeds the SFX generator. The prompt
  // and negative handles accept multiple producers (text/picker fragments
  // are concatenated upstream), so they are NOT capped here. MMAudio is the
  // only provider today; if more providers are added, switch to a per-
  // provider table the same way generate-video does above.
  if (node.type === "video-sfx" && handleId === "video") {
    return { limit: 1, providerLabel: "MMAudio", isMultiProviderMin: false }
  }

  return null
}
