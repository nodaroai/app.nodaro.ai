/**
 * MAGI-2 request bodies — pure, no I/O.
 *
 * ONE Nodaro id (`magi-2`) over three KIE task models, picked by what is wired
 * (decided 2026-11-26; docs.kie.ai MAGI-2 pages, read 2026-11-26):
 *   - any reference image, video or audio clip → `magi-2/reference-to-video`.
 *     Frames are not taken beside references, so a wired first or last frame
 *     joins the reference images (after the caller's own, ordinals unchanged)
 *     and is named in the prompt — `resolveSeedance2Inputs`, the rule Wan 3.0
 *     and Vidu Q4 follow. A lone last frame (no first frame, no references) is
 *     the same: it becomes the one reference image, with a closing-frame line
 *     (`videoProviderFoldsLoneEndFrame`).
 *   - a first frame, no references → `magi-2/image-to-video`: `first_frame_url`
 *     and an optional `last_frame_url`. The schema has NO `aspect_ratio`: the
 *     output follows the first frame.
 *   - nothing wired → `magi-2/text-to-video`.
 *
 * Each body is an explicit allow-list (the `MAGI_2_*_FIELDS` below), never a
 * spread of `extraParams` or of the caller's options, so no lever another model
 * carries (a negative prompt, a string seed, `nsfw_checker`, a camera setting)
 * reaches the wire:
 *   - `prompt` (1-15,000; an empty one is sent as the platform's default
 *     motion text, and a reference run's frame line is fitted inside the cap),
 *   - `duration` (an INTEGER, already snapped to 4-30),
 *   - `resolution` (always `1080p`, the only value),
 *   - `aspect_ratio` (text and reference runs only; a reference run that names
 *     none follows its wired frame's shape, else 16:9),
 *   - `generate_audio` (always sent: true unless the request turns sound off —
 *     the same price either way),
 *   - `seed` (only a whole number 0-2147483647; anything else is left out).
 * None of the three schemas has a content-filter parameter.
 */
import { applyVideoAudioToggle, MAGI_2_RESOLUTION, SEEDANCE_2_REF_LIMITS, VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared/models"
import { getModel } from "@nodaro/shared/model-catalog"
import { resolveSeedance2Inputs } from "@nodaro/prompts/assembly"
import { closestAspectRatio, snapAspectRatioToken } from "../video/aspect-ratio.js"
import { neutralizeImageMentions } from "./image-mentions.js"
import {
  KIE_CREDIT_USD,
  MAGI_2_IMAGE_TO_VIDEO_MODEL,
  MAGI_2_REFERENCE_TO_VIDEO_MODEL,
  MAGI_2_TEXT_TO_VIDEO_MODEL,
} from "./models.js"

/** The Nodaro id. */
export const MAGI_2_PROVIDER = "magi-2"

/** The aspect ratio a text or reference run sends when it names none (the schemas' default). */
export const MAGI_2_DEFAULT_ASPECT = "16:9"

/** The prompt sent when the caller's is empty — the schemas require one character at least. */
export const MAGI_2_DEFAULT_PROMPT = "smooth cinematic motion"

/** The longest prompt every task model takes (`maxLength`). */
export const MAGI_2_PROMPT_MAX = 15000

/** The seeds the schemas accept (`minimum` / `maximum`, every task model). */
export const MAGI_2_SEED_RANGE = { min: 0, max: 2147483647 } as const

/** KIE's rate for every MAGI-2 task model: 17.6 KIE credits per second of video (read 2026-11-26). */
export const MAGI_2_KIE_CREDITS_PER_SEC = 17.6

/** The keys each body may carry — the allow-list the tests hold the builder to. */
export const MAGI_2_TEXT_TO_VIDEO_FIELDS = ["prompt", "duration", "aspect_ratio", "resolution", "generate_audio", "seed"] as const
export const MAGI_2_IMAGE_TO_VIDEO_FIELDS = ["first_frame_url", "last_frame_url", "prompt", "duration", "resolution", "generate_audio", "seed"] as const
export const MAGI_2_REFERENCE_TO_VIDEO_FIELDS = [
  "prompt", "reference_image_urls", "reference_video_urls", "reference_audio_urls",
  "duration", "aspect_ratio", "resolution", "generate_audio", "seed",
] as const

export type Magi2TaskModel =
  | typeof MAGI_2_TEXT_TO_VIDEO_MODEL
  | typeof MAGI_2_IMAGE_TO_VIDEO_MODEL
  | typeof MAGI_2_REFERENCE_TO_VIDEO_MODEL

/** The USD KIE bills for a MAGI-2 run of `seconds` (one rate on all three task models, sound on or off). */
export function magi2CostUsd(seconds: number): number {
  return MAGI_2_KIE_CREDITS_PER_SEC * seconds * KIE_CREDIT_USD
}

/**
 * The aspect ratio a text or reference run sends: a declared ratio passes
 * through; anything else the shared route enum lets in (`adaptive`, `auto`, an
 * off-list ratio such as 5:4) lands on the nearest declared ratio, or 16:9 when
 * it names no shape.
 */
export function resolveMagi2Aspect(requested: string | undefined): string {
  const declared = getModel(MAGI_2_PROVIDER)?.aspectRatios ?? []
  const token = requested?.trim()
  if (token && declared.includes(token)) return token
  return (token ? snapAspectRatioToken(token, declared) : undefined) ?? MAGI_2_DEFAULT_ASPECT
}

/** True when `requested` names a shape: a declared ratio, or one that snaps onto one ("5:4"). */
export function magi2NamesShape(requested: string | undefined): boolean {
  return snapAspectRatioToken(requested?.trim(), getModel(MAGI_2_PROVIDER)?.aspectRatios ?? []) !== undefined
}

/**
 * The declared ratio nearest a frame of `width` × `height` pixels, or undefined
 * when the size is not known. A reference run whose request names no shape
 * follows its wired frame with it (decided 2026-11-27).
 */
export function magi2FrameAspect(width: number | undefined, height: number | undefined): string | undefined {
  if (!width || !height) return undefined
  return closestAspectRatio(width, height, getModel(MAGI_2_PROVIDER)?.aspectRatios ?? [])
}

/** A seed the schemas take, or undefined (left out of the body). */
export function magi2Seed(seed: unknown): number | undefined {
  return typeof seed === "number" && Number.isInteger(seed) && seed >= MAGI_2_SEED_RANGE.min && seed <= MAGI_2_SEED_RANGE.max
    ? seed
    : undefined
}

/** The reference caps the builder holds a run to (10 images / 5 videos / 5 audio). */
function magi2Limits(): { images: number; videos: number; audio: number } {
  return { ...SEEDANCE_2_REF_LIMITS, ...(VIDEO_REF_LIMITS_BY_PROVIDER[MAGI_2_PROVIDER] ?? {}) }
}

/** `base` and the frame line, inside the prompt cap: the caller's text is cut, the line kept whole. */
function withFrameLine(base: string, suffix: string): string {
  if (!suffix) return base.slice(0, MAGI_2_PROMPT_MAX)
  const room = MAGI_2_PROMPT_MAX - suffix.length - 2
  const kept = room > 0 ? base.slice(0, room) : ""
  return kept ? `${kept}\n\n${suffix}` : suffix.slice(0, MAGI_2_PROMPT_MAX)
}

export interface Magi2RequestArgs {
  /** The composed prompt; an empty one is sent as {@link MAGI_2_DEFAULT_PROMPT}. */
  prompt: string
  /** Already snapped to 4-30. */
  durationSec: number
  /** Read on text and reference runs only. */
  aspectRatio?: string
  /**
   * The declared ratio nearest the wired frame's shape ({@link magi2FrameAspect}).
   * Read only on a reference run whose `aspectRatio` names no shape: the clip
   * then follows the frame instead of the 16:9 default.
   */
  frameAspectRatio?: string
  /** The first frame (already normalized). */
  startFrameUrl?: string
  /** The last frame (already normalized). */
  endFrameUrl?: string
  referenceImageUrls?: readonly string[]
  referenceVideoUrls?: readonly string[]
  referenceAudioUrls?: readonly string[]
  seed?: number
  /** The request's audio fields (`sound` canonical, then `generateAudio`). */
  sound?: boolean
  generateAudio?: boolean
}

export interface Magi2Request {
  /** The KIE task model to create the task under. */
  model: Magi2TaskModel
  input: Record<string, unknown>
  /** Reference images left out past the 10-image cap (frames counted). */
  droppedRefImages: number
}

export function buildMagi2Request(args: Magi2RequestArgs): Magi2Request {
  const limits = magi2Limits()
  const userPrompt = args.prompt.trim() ? args.prompt : MAGI_2_DEFAULT_PROMPT
  const resolved = resolveSeedance2Inputs({
    prompt: userPrompt,
    firstFrameUrl: args.startFrameUrl,
    lastFrameUrl: args.endFrameUrl,
    refImageUrls: args.referenceImageUrls,
    refVideoUrls: args.referenceVideoUrls,
    refAudioUrls: args.referenceAudioUrls,
    limits,
  })

  const common: Record<string, unknown> = {
    // INTEGER on purpose — the generic createTask path sends a string.
    duration: args.durationSec,
    resolution: MAGI_2_RESOLUTION,
    // KIE's own default is `true`; sent explicitly so the audit log sees the
    // value that rendered. `applyVideoAudioToggle` turns it off on request.
    generate_audio: true,
  }
  applyVideoAudioToggle(common, MAGI_2_PROVIDER, { sound: args.sound, generateAudio: args.generateAudio })
  const seed = magi2Seed(args.seed)

  if (resolved.mode === "reference") {
    const input: Record<string, unknown> = { prompt: withFrameLine(userPrompt, resolved.promptSuffix) }
    if (resolved.referenceImageUrls.length > 0) input.reference_image_urls = resolved.referenceImageUrls
    if (resolved.referenceVideoUrls.length > 0) input.reference_video_urls = resolved.referenceVideoUrls
    if (resolved.referenceAudioUrls.length > 0) input.reference_audio_urls = resolved.referenceAudioUrls
    const followsFrame = args.frameAspectRatio !== undefined && !magi2NamesShape(args.aspectRatio)
    Object.assign(input, common, { aspect_ratio: followsFrame ? resolveMagi2Aspect(args.frameAspectRatio) : resolveMagi2Aspect(args.aspectRatio) })
    if (seed !== undefined) input.seed = seed
    return { model: MAGI_2_REFERENCE_TO_VIDEO_MODEL, input, droppedRefImages: resolved.droppedRefImages }
  }

  // No reference is sent on the frame and text task models, so a platform
  // `@image_N` mention (a cast member's seat) points at nothing: it loses its `@`.
  const prompt = neutralizeImageMentions(userPrompt).slice(0, MAGI_2_PROMPT_MAX)
  if (resolved.firstFrameUrl) {
    const input: Record<string, unknown> = { first_frame_url: resolved.firstFrameUrl }
    if (resolved.lastFrameUrl) input.last_frame_url = resolved.lastFrameUrl
    Object.assign(input, { prompt }, common)
    if (seed !== undefined) input.seed = seed
    return { model: MAGI_2_IMAGE_TO_VIDEO_MODEL, input, droppedRefImages: 0 }
  }

  const input: Record<string, unknown> = { prompt, ...common, aspect_ratio: resolveMagi2Aspect(args.aspectRatio) }
  if (seed !== undefined) input.seed = seed
  return { model: MAGI_2_TEXT_TO_VIDEO_MODEL, input, droppedRefImages: 0 }
}
