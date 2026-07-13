import { imageReferenceLimit, VIDEO_REF_LIMITS_BY_PROVIDER, getModel, isSeedance2Provider } from "@nodaro/shared"
import { isAnalyzablePicker } from "@nodaro/prompts"
import {
  PROVIDERS_WITH_END_FRAME,
  PROVIDERS_WITH_REFERENCES,
} from "@/components/editor/config-panels/model-options"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * Connection counts a caller can thread into `getHandleConnectionLimit` so the
 * limit can account for OTHER wired inputs that compete for the same runtime
 * resource. Today only Seedance 2's Generate Video `imageReferences` handle
 * uses this: its `reference_image_urls` array is a single 9-slot pool shared by
 * the user image refs (this handle) + the start frame + the end frame + any
 * wired identity assets (characters/objects/…) that the resolver merges into
 * the same array. See `resolveSeedance2Inputs` (the backend SoT) and
 * `seedance2ImagePoolSlotsConsumed` below.
 *
 * Omitted entirely by the per-node `fakeNode` callers that only need the static
 * provider-capability cap (and only inspect `limit === 0` to disable a handle);
 * supplied by the handle popover, which has the live edge list.
 */
export interface HandleConnectionCounts {
  /** Slots already consumed in Seedance 2's `reference_image_urls` pool by
   *  inputs OTHER than the handle being measured — start/end frame + wired
   *  identity assets. Subtracted from the image-pool budget. */
  readonly seedance2ImagePoolConsumed?: number
}

/**
 * Generate-Video target handles whose wired producers the resolver merges into
 * the SAME `reference_image_urls` array as the user `imageReferences` refs.
 * Derived from the resolver's real routing (input-resolver.ts):
 *   - `startFrame` / `endFrame` → `startFrameUrl`/`endFrameUrl`, which
 *     `resolveSeedance2Inputs` appends to the tail of `reference_image_urls`.
 *   - `assets` → identity nodes (character/object/location/creature/face) that
 *     fall through to ENTITY_NODE_TYPES source-routing → `referenceImageUrls`.
 * Pickers on `look`/`elements` become prompt fragments (never image slots) and
 * video/audio refs use separate pools, so neither appears here.
 *
 * `imageReferences` itself is intentionally absent — it is the handle being
 * measured, so its own connections are counted by the popover, not subtracted.
 */
const SEEDANCE2_IMAGE_POOL_HANDLES: ReadonlySet<string> = new Set([
  "startFrame",
  "endFrame",
  "assets",
])

/**
 * Count the Seedance 2 `reference_image_urls` slots consumed by inputs wired to
 * a Generate Video node OTHER than its `imageReferences` handle. `startFrame`
 * and `endFrame` are clamped to 1 each (the resolver only ever appends one of
 * each); `assets` edges are counted 1 slot per edge (each identity node emits
 * one reference image into the pool). Used to turn the flat `imageReferences`
 * cap into a shared budget so the user can't wire 9 refs + a frame = 10 and
 * have the runtime silently drop the overflow into a frame's `Image N`.
 */
export function seedance2ImagePoolSlotsConsumed(
  edges: readonly WorkflowEdge[],
  nodeId: string,
): number {
  let startFrame = 0
  let endFrame = 0
  let assets = 0
  for (const e of edges) {
    if (e.target !== nodeId) continue
    const h = e.targetHandle ?? ""
    if (!SEEDANCE2_IMAGE_POOL_HANDLES.has(h)) continue
    if (h === "startFrame") startFrame = 1
    else if (h === "endFrame") endFrame = 1
    else assets += 1
  }
  return startFrame + endFrame + assets
}

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
  counts?: HandleConnectionCounts,
): HandleConnectionLimit | null {
  if (!node) return null

  // video-retake's `video` target accepts exactly one source clip — the LTX
  // 2.3 Pro endpoint replaces a time-window in a single uploaded video.
  if (node.type === "video-retake" && handleId === "video") {
    return { limit: 1, providerLabel: "Retake", isMultiProviderMin: false }
  }

  // Every analyzable picker's `picker-json` target accepts exactly one
  // image→picker analysis result — the consumer applies a single JSON into
  // its fields. Set-driven via `isAnalyzablePicker` (@nodaro/shared) so a new
  // analyzable picker inherits the cap without editing this list.
  if (isAnalyzablePicker(node.type) && handleId === "picker-json") {
    return { limit: 1, providerLabel: "Picker", isMultiProviderMin: false }
  }

  if (node.type === "generate-image" && handleId === "references") {
    const data = node.data as { provider?: string; providers?: readonly string[] } | undefined
    const providers: readonly string[] =
      data?.providers && data.providers.length > 0
        ? data.providers
        : [data?.provider || "nano-banana-pro"]

    // Filter to providers that actually consume reference images — others
    // ignore them entirely, so their "limit" of zero would be misleading.
    // `imageReferenceLimit` returns 0 for a non-consumer and resolves T2I ids to
    // their auto-routed i2i sibling's cap (grok→1, gpt-image-2→16), matching the
    // generate-image route + the reference-support warning.
    const refConsumers = providers.filter((p) => imageReferenceLimit(p) > 0)
    if (refConsumers.length === 0) return null

    // Multi-provider: pick the MIN limit across selected providers — past
    // that count, AT LEAST one provider will silently drop the ref. The
    // tooltip can clarify that this is the most-restrictive provider.
    let minLimit = Infinity
    for (const p of refConsumers) {
      const lim = imageReferenceLimit(p)
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
    const data = node.data as { provider?: string } | undefined
    const provider = data?.provider ?? "kling"
    // Use the catalog label if available so the tooltip reads naturally
    // ("Beyond Kling 2.6's max" rather than "Beyond kling's max"); fall
    // back to the raw provider id when the catalog has no entry yet.
    const providerLabel = getModel(provider)?.label ?? provider
    const caps = VIDEO_REF_LIMITS_BY_PROVIDER[provider]
    // Every handle is gated ONLY by provider capability — never by an input
    // "mode". Seedance 2 used to force a frames-vs-references choice here, but
    // the backend resolver (resolveSeedance2Inputs) now decides the mode from
    // the connected inputs at run time, so all S2 inputs are always available.
    switch (handleId) {
      case "startFrame":
        return { limit: 1, providerLabel, isMultiProviderMin: false }
      case "endFrame":
        return PROVIDERS_WITH_END_FRAME.includes(provider)
          ? { limit: 1, providerLabel, isMultiProviderMin: false }
          : { limit: 0, providerLabel, isMultiProviderMin: false }
      case "imageReferences": {
        if (!PROVIDERS_WITH_REFERENCES.includes(provider)) {
          return { limit: 0, providerLabel, isMultiProviderMin: false }
        }
        const poolMax = caps?.images ?? 1
        // Seedance 2: `reference_image_urls` is ONE pool shared by user image
        // refs (this handle) + start/end frame + wired identity assets. Subtract
        // the slots those other inputs consume so the user-ref cap reflects the
        // budget the runtime resolver (resolveSeedance2Inputs) will actually
        // honor — wiring more than this many user refs would push the overflow
        // off the tail (where the frames live), corrupting `Image N`. Non-S2
        // ref providers (gemini-omni-video=7, grok-imagine-video-1.5=1, wan-i2v,
        // …) don't merge frames/assets into one shared pool, so the budget only
        // applies to S2 — they keep their flat capability cap. Floor at 0 so the
        // popover shows "N of 0 max" (handle full) rather than a negative max.
        const limit = isSeedance2Provider(provider)
          ? Math.max(0, poolMax - (counts?.seedance2ImagePoolConsumed ?? 0))
          : poolMax
        return { limit, providerLabel, isMultiProviderMin: false }
      }
      case "videoReferences": {
        const cap = caps?.videos
        return cap != null
          ? { limit: cap, providerLabel, isMultiProviderMin: false }
          : { limit: 0, providerLabel, isMultiProviderMin: false }
      }
      case "audio":
        // NOTE: `audio` is a post-gen soundtrack/overlay (not a multimodal
        // reference). LTX 2.3 Fast has no audio overlay handle.
        if (provider === "ltx-2.3-fast") {
          return { limit: 0, providerLabel, isMultiProviderMin: false }
        }
        return { limit: 1, providerLabel, isMultiProviderMin: false }
      case "audioReferences": {
        // Multimodal audio reference input (distinct from the `audio`
        // overlay above) — gated by the provider's audio-ref capability.
        const cap = caps?.audio
        return cap != null
          ? { limit: cap, providerLabel, isMultiProviderMin: false }
          : { limit: 0, providerLabel, isMultiProviderMin: false }
      }
      default:
        return null
    }
  }

  // Generate Video Pro — Seedance-2-family only (all three providers share
  // SEEDANCE_2_REF_LIMITS via VIDEO_REF_LIMITS_BY_PROVIDER, images: 9), so
  // this reuses the same provider-limits source as generate-video above
  // rather than a hand-picked literal — it stays correct if that shared cap
  // is ever retuned. Only two of generate-video's handles exist here.
  if (node.type === "generate-video-pro") {
    const data = node.data as { provider?: string } | undefined
    const provider = data?.provider ?? "seedance-2"
    const providerLabel = getModel(provider)?.label ?? provider
    switch (handleId) {
      case "startFrame":
        return { limit: 1, providerLabel, isMultiProviderMin: false }
      case "imageReferences": {
        const cap = VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.images ?? 9
        return { limit: cap, providerLabel, isMultiProviderMin: false }
      }
      default:
        return null
    }
  }

  // Edit Video Pro — Seedance-2-family only, same provider set as its gvp
  // sibling (GVP_PROVIDERS = VIDEO_GEN_MODELS filtered by isSeedance2Provider,
  // shared verbatim between both config panels). `video` accepts exactly one
  // source clip, like video-retake: Seedance-2 replaces a time-window in a
  // single source video (see edit-video-pro-handles.ts). `imageReferences` is
  // capped the same way as generate-video-pro's case above —
  // VIDEO_REF_LIMITS_BY_PROVIDER rather than a hand-picked literal, so it
  // stays correct if that shared cap is ever retuned. No pool-consumption
  // subtraction here: unlike legacy generate-video's Seedance-2 mode, this
  // node's `video` and `imageReferences` route to SEPARATE payload fields
  // (`videoUrl` / `referenceImageUrls` — see payload-builder.ts's
  // "edit-video-pro" case and input-resolver.ts's SELECTED_NODE_FALLBACKS
  // comment), so there is no shared reference_image_urls pool to subtract
  // from — mirrors generate-video-pro, which has the same separation.
  if (node.type === "edit-video-pro") {
    switch (handleId) {
      case "video":
        return { limit: 1, providerLabel: "Edit Video", isMultiProviderMin: false }
      case "imageReferences": {
        const data = node.data as { provider?: string } | undefined
        const provider = data?.provider ?? "seedance-2"
        const providerLabel = getModel(provider)?.label ?? provider
        const cap = VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.images ?? 9
        return { limit: cap, providerLabel, isMultiProviderMin: false }
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

  // Video Analysis — its `video` target analyzes exactly one source clip.
  if (node.type === "video-analysis" && handleId === "video") {
    return { limit: 1, providerLabel: "Video Analysis", isMultiProviderMin: false }
  }

  return null
}
