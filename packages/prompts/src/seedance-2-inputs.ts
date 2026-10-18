import { SEEDANCE_2_REF_LIMITS } from "@nodaro/shared/models"
import { placeFramesAfterReferences } from "./frame-reference-slots.js"

export type Seedance2Mode = "first-frame" | "first-last-frame" | "reference"

export interface Seedance2InputsArgs {
  /** The generation prompt — used ONLY to detect an existing first-frame
   *  binding and suppress the duplicate trailing sentence. */
  prompt?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  refImageUrls?: readonly string[]
  refVideoUrls?: readonly string[]
  refAudioUrls?: readonly string[]
  /** Per-provider input caps (2026-08-15). The Seedance 2.x GENERATIONS share
   *  this resolver's whole mode logic but not their caps — 2.5 takes the same
   *  three kinds at 30/10/10 where 2.0 stops at 9/3/3. Defaults to the 2.0
   *  caps so every existing caller is byte-identical; the adapter passes the
   *  provider's own entry from VIDEO_REF_LIMITS_BY_PROVIDER. */
  limits?: { images: number; videos: number; audio: number }
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
export { promptBindsFirstFrame } from "./frame-reference-slots.js"

export function resolveSeedance2Inputs(args: Seedance2InputsArgs): Seedance2InputsResult {
  const limits = args.limits ?? SEEDANCE_2_REF_LIMITS
  const firstFrameUrl = clean(args.firstFrameUrl)
  const lastFrameUrl = clean(args.lastFrameUrl)
  const refImages = cleanList(args.refImageUrls)
  const refVideos = cleanList(args.refVideoUrls).slice(0, limits.videos)
  const refAudios = cleanList(args.refAudioUrls).slice(0, limits.audio)

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
  // if the image cap is exceeded. Frames are appended AFTER the kept user images
  // so existing user @Image ordinals are preserved — the platform convention
  // (placeFramesAfterReferences), shared with every frames-in-the-list model.
  const placed = placeFramesAfterReferences({
    prompt: args.prompt,
    firstFrameUrl,
    lastFrameUrl,
    refImageUrls: refImages,
    imageCap: limits.images,
  })
  const referenceImageUrls = placed.imageUrls
  const promptSuffix = placed.promptSuffix
  const droppedRefImages = placed.droppedRefImages

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
