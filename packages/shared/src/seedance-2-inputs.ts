import { SEEDANCE_2_REF_LIMITS } from "./model-constants.js"
import { REF_BINDING } from "./video-reference-resolver.js"

export type Seedance2Mode = "first-frame" | "first-last-frame" | "reference"

export interface Seedance2InputsArgs {
  firstFrameUrl?: string
  lastFrameUrl?: string
  refImageUrls?: readonly string[]
  refVideoUrls?: readonly string[]
  refAudioUrls?: readonly string[]
}

export interface Seedance2InputsResult {
  mode: Seedance2Mode
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls: string[]
  referenceVideoUrls: string[]
  referenceAudioUrls: string[]
  promptSuffix: string
  droppedRefImages: number
}

const clean = (u?: string): string | undefined => {
  const t = u?.trim()
  return t && t.length > 0 ? t : undefined
}
const cleanList = (xs?: readonly string[]): string[] =>
  (xs ?? []).map(clean).filter((x): x is string => x !== undefined)

/**
 * Single source of truth for how Seedance 2's three mutually-exclusive KIE input
 * modes are selected from connected inputs. Strict first/last-frame mode is used
 * only when nothing but frames is connected; any reference (image, video, OR
 * audio) switches to multimodal Reference mode, where the frames are appended to
 * reference_image_urls (after the user's own images, so their @Image ordinals do
 * not shift) and named in a doctrine-compliant prompt suffix.
 */
export function resolveSeedance2Inputs(args: Seedance2InputsArgs): Seedance2InputsResult {
  const firstFrameUrl = clean(args.firstFrameUrl)
  const lastFrameUrl = clean(args.lastFrameUrl)
  const refImages = cleanList(args.refImageUrls)
  const refVideos = cleanList(args.refVideoUrls).slice(0, SEEDANCE_2_REF_LIMITS.videos)
  const refAudios = cleanList(args.refAudioUrls).slice(0, SEEDANCE_2_REF_LIMITS.audio)

  const hasAnyReference = refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0

  // Strict first/last-frame mode is only expressible when a first frame is
  // present (KIE has no last-frame-only strict mode) and nothing but frames is
  // connected. A lone last frame (no first frame, no references) therefore falls
  // through to Reference mode below, where it becomes the sole reference image
  // with a closing-frame hint. The truly-empty case (no frames at all) stays in
  // the degenerate first-frame branch with no URLs.
  const canUseStrictMode = !hasAnyReference && (Boolean(firstFrameUrl) || !lastFrameUrl)

  if (canUseStrictMode) {
    if (firstFrameUrl && lastFrameUrl) {
      return { mode: "first-last-frame", firstFrameUrl, lastFrameUrl, referenceImageUrls: [], referenceVideoUrls: [], referenceAudioUrls: [], promptSuffix: "", droppedRefImages: 0 }
    }
    return { mode: "first-frame", firstFrameUrl, lastFrameUrl: undefined, referenceImageUrls: [], referenceVideoUrls: [], referenceAudioUrls: [], promptSuffix: "", droppedRefImages: 0 }
  }

  // Reference mode: keep both frames (explicit intent), drop trailing user images
  // if the 9-image cap is exceeded. Frames are appended AFTER the kept user
  // images so existing user @Image ordinals are preserved.
  const frameCount = (firstFrameUrl ? 1 : 0) + (lastFrameUrl ? 1 : 0)
  const userImageSlots = Math.max(0, SEEDANCE_2_REF_LIMITS.images - frameCount)
  const keptUserImages = refImages.slice(0, userImageSlots)
  const droppedRefImages = refImages.length - keptUserImages.length

  const referenceImageUrls: string[] = [...keptUserImages]
  let firstOrdinal = 0
  let lastOrdinal = 0
  if (firstFrameUrl) { referenceImageUrls.push(firstFrameUrl); firstOrdinal = referenceImageUrls.length }
  if (lastFrameUrl) { referenceImageUrls.push(lastFrameUrl); lastOrdinal = referenceImageUrls.length }

  let promptSuffix = ""
  if (firstOrdinal > 0 && lastOrdinal > 0) {
    // Combined sentence — REF_BINDING.frame() emits a single-frame sentence, so use
    // REF_BINDING.ordinal() for each ordinal inline to keep the combined wording AND
    // route both ordinals through the single swap-point.
    promptSuffix = `Use ${REF_BINDING.ordinal(firstOrdinal)} as the opening (first) frame and ${REF_BINDING.ordinal(lastOrdinal)} as the closing (last) frame of the video.`
  } else if (firstOrdinal > 0) {
    promptSuffix = REF_BINDING.frame(firstOrdinal, "opening")
  } else if (lastOrdinal > 0) {
    promptSuffix = REF_BINDING.frame(lastOrdinal, "closing")
  }

  return {
    mode: "reference",
    firstFrameUrl: undefined,
    lastFrameUrl: undefined,
    referenceImageUrls,
    referenceVideoUrls: refVideos,
    referenceAudioUrls: refAudios,
    promptSuffix,
    droppedRefImages,
  }
}
