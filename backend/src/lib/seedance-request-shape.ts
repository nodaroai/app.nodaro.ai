/**
 * The pieces of a Seedance request's shape the default provider decides and
 * the alternate route's admission must decide the same way (pure, no I/O):
 * the aspect ratio a run is sent at. One implementation, read by the provider
 * (`providers/kie/video.ts`) and by admission (ee/billing/video-route-admission.ts).
 */
import { getModel, isVideoAutoAspectToken, videoAutoAspectRunsAt } from "@nodaro/shared/model-catalog"
import { FRAME_MODE_ADAPTIVE_ONLY_ASPECT } from "@nodaro/shared/models"
import { snapAspectRatioToken } from "../providers/video/aspect-ratio.js"

/** KIE's documented seedance default when no ratio is supplied — also the value a pure-t2v
 *  "Auto" resolves to, since `adaptive` means "match the input" and t2v has none. */
export const SEEDANCE_2_DEFAULT_ASPECT = "16:9"

/**
 * Resolve a requested aspect ratio against a model's OWN catalog list.
 *
 * One implementation for the "the route enums are a flat union of every ratio
 * any video model supports" problem: an off-enum ratio (4:5, 5:4, 9:21) reaches
 * the provider and is rejected synchronously, and a FieldMapping can inject
 * `aspectRatio` at run time after every UI guard is gone.
 *
 * `"adaptive"` is a real provider enum member for the seedance family and is
 * returned untouched. `"Auto"` is the unified node's provider-agnostic token
 * with no provider meaning: it becomes `"adaptive"` when the model offers it
 * AND there is something to match, and the model's fixed default otherwise —
 * `videoAutoAspectRunsAt`, the shared rule the reference task type resolver
 * reads too.
 */
export function resolveCatalogAspect(
  modelId: string | undefined,
  requested: string | undefined,
  opts: { hasVisualInput: boolean; fallback: string },
): string | undefined {
  const raw = requested?.trim()
  if (!raw) return undefined
  const allowed = (modelId ? getModel(modelId)?.aspectRatios : undefined) ?? []
  if (allowed.length === 0) return raw
  const fixed = allowed.filter((a) => a !== "adaptive")

  if (isVideoAutoAspectToken(raw)) {
    return videoAutoAspectRunsAt(modelId, opts.hasVisualInput) ?? opts.fallback
  }
  if (allowed.includes(raw)) return raw
  return snapAspectRatioToken(raw, fixed) ?? opts.fallback
}

/**
 * The aspect ratio a Seedance 2.x run is SENT at, from the requested one and
 * the inputs as the provider seats them (`resolveSeedance2Inputs`): the
 * catalog rule above, then — on a model whose start-frame mode takes no
 * explicit ratio (`FRAME_MODE_ADAPTIVE_ONLY_ASPECT`) — "adaptive" while a
 * start frame survives as a FRAME. A frame folded into the references (any
 * reference wired: a voiced run's portrait beside its voice track) keeps the
 * requested ratio.
 */
export function seedanceSentAspect(
  model: string,
  requested: string | undefined,
  seated: { firstFrameUrl?: string; lastFrameUrl?: string; referenceImageCount: number; referenceVideoCount: number },
): string | undefined {
  const hasVisualInput = Boolean(seated.firstFrameUrl || seated.lastFrameUrl || seated.referenceImageCount > 0 || seated.referenceVideoCount > 0)
  const resolved = resolveCatalogAspect(model, requested, { hasVisualInput, fallback: SEEDANCE_2_DEFAULT_ASPECT }) ?? requested
  if (FRAME_MODE_ADAPTIVE_ONLY_ASPECT.has(model) && seated.firstFrameUrl && resolved !== undefined && resolved !== "adaptive") return "adaptive"
  return resolved
}
