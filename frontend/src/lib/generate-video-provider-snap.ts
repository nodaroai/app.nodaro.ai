import {
  VIDEO_DURATION_OPTIONS,
  VIDEO_FPS_OPTIONS,
  getAspectRatiosForVideoModel,
  getVideoResolutionOptions,
} from "@/components/editor/config-panels/model-options"
import { isFrameDelivery, isFrameFit, supportsReferenceDelivery } from "@/components/editor/config-panels/frame-fit-fields"
import { hasStaleSeedanceDraft } from "@/components/editor/config-panels/seedance-draft-toggle"
import { openVideoDuration, openVideoResolution, type FreeVideoLimits } from "@/lib/free-video-locks"
import {
  isAutoVideoDuration,
} from "@nodaro/shared/model-catalog"
import {
  isGeminiOmniProvider,
  isWan3Provider,
  supportsAutoVideoDuration,
} from "@nodaro/shared/models"
import {
  uiDurationFill,
  uiResolutionFill,
} from "@nodaro/shared/video"

/**
 * The Generate Video fail-safe (CLAUDE.md Provider Enum Sync step 12b): the
 * patch that moves every stored value the model `provider` cannot take onto one
 * it can. ONE function for both surfaces that change the model — the config
 * panel's provider effect and the node's run strip. The strip used to write the
 * provider alone (the panel's effect runs only while the panel is mounted), so a
 * Seedance "480p" rode onto MiniMax H3, whose resolutions are 2K / 768P.
 *
 * Where it picks a value it picks an OPEN one under the account's free-credit
 * video limits (`limits`, null = none): never a resolution or duration the
 * run would refuse.
 *
 * Returns only the fields that change; `{}` when the node already fits.
 */
export function generateVideoProviderSnap(
  data: Readonly<Record<string, unknown>>,
  provider: string,
  limits: FreeVideoLimits | null = null,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  const resolution = typeof data.resolution === "string" ? data.resolution : undefined
  const opts = getVideoResolutionOptions(provider)
  if (opts) {
    if (resolution && !opts.some((o) => o.value === resolution)) {
      updates.resolution = openVideoResolution(limits, provider, opts.map((o) => o.value))
    }
  } else if (data.resolution !== undefined) {
    updates.resolution = undefined
  }
  // Start/end frame handling — a stale value the select cannot render is
  // cleared, and delivery is cleared outright on a model with no reference-
  // image support (the lever does not exist there; the backend collapses it
  // to frame mode anyway).
  if (data.frameFit !== undefined && !isFrameFit(data.frameFit)) {
    updates.frameFit = undefined
  }
  if (data.frameDelivery !== undefined && (!isFrameDelivery(data.frameDelivery) || !supportsReferenceDelivery(provider))) {
    updates.frameDelivery = undefined
  }
  const duration = typeof data.duration === "number" ? data.duration : undefined
  if (isAutoVideoDuration(duration) && !supportsAutoVideoDuration(provider)) {
    // Auto (-1) is a capability of the model: one that cannot honour it runs and
    // bills its own default, so the Auto is cleared rather than snapped to the
    // shortest tier.
    updates.duration = undefined
  } else {
    const durations = VIDEO_DURATION_OPTIONS[provider]?.map((o) => o.value) ?? null
    if (durations && duration && !durations.includes(duration)) {
      updates.duration = openVideoDuration(limits, provider, durations)
    }
  }
  // fps lever — only providers in VIDEO_FPS_OPTIONS (LTX 2.3 Pro/Fast today)
  // expose fps. Snap or clear so a stale LTX value never leaks onto a provider
  // without an fps lever.
  const fpsOpts = VIDEO_FPS_OPTIONS[provider]
  const fps = data.fps as number | undefined
  if (fpsOpts) {
    if (fps !== undefined && !fpsOpts.some((o) => o.value === fps)) {
      updates.fps = fpsOpts[0]?.value
    }
  } else if (fps !== undefined) {
    updates.fps = undefined
  }
  // Aspect ratio — snap a stale EXPLICIT value to the new provider's first
  // valid option whenever it isn't in that provider's set. Data-driven off the
  // dropdown's own option source (no hardcoded provider list). An unset value
  // stays unset.
  const aspectOpts = getAspectRatiosForVideoModel(provider)
  if (typeof data.aspectRatio === "string" && data.aspectRatio && !aspectOpts.some((o) => o.value === data.aspectRatio)) {
    updates.aspectRatio = aspectOpts[0]?.value
  }
  if (isGeminiOmniProvider(provider)) {
    // Persist the 8s default when duration is unset so the dropdown, the credit
    // identifier, and the KIE payload all agree (the credit id + provider both
    // default to 8 when undefined, while the dropdown would otherwise show the
    // first option, 4s). Family-scoped so gemini-omni-flash inherits it.
    if (data.duration == null) updates.duration = openVideoDuration(limits, provider, [8, ...(VIDEO_DURATION_OPTIONS[provider]?.map((o) => o.value) ?? [])])
  }
  if (isWan3Provider(provider)) {
    // Wan 3.0 is priced on a duration × resolution ladder and its BARE credit
    // identifier is the 5s @ 720p tier. Persist those two values explicitly so
    // the dropdown, the credit badge and the KIE payload quote the same render —
    // never `opts[0]`, which is 480p under the catalog's ascending convention.
    // One rule for an unset AND an unsupported resolution: the shared credit
    // identifier collapses both to the declared 720p default.
    if (!opts?.some((o) => o.value === resolution)) {
      updates.resolution = openVideoResolution(limits, provider, [uiResolutionFill(provider) ?? "720p", ...(opts?.map((o) => o.value) ?? [])])
    }
    if (data.duration == null || ("duration" in updates && updates.duration === undefined)) {
      updates.duration = openVideoDuration(limits, provider, [uiDurationFill(provider) ?? 5, ...(VIDEO_DURATION_OPTIONS[provider]?.map((o) => o.value) ?? [])])
    }
    // `adaptive` is Wan 3.0's own default aspect ratio and what the backend DAG
    // path fills for an untouched node.
    if (data.aspectRatio == null) updates.aspectRatio = "adaptive"
  }
  if (hasStaleSeedanceDraft(provider, data.draft)) updates.draft = undefined
  return updates
}
