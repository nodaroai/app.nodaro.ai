/**
 * PixVerse V6 Max request bodies — pure, no I/O.
 *
 * ONE Nodaro id (`pixverse-v6-max`) over two KIE endpoints, picked by what is
 * wired:
 *   - a start frame → `pixverse-v6-max/image-to-video`
 *     (docs.kie.ai/market/pixverse/v6-max-image-to-video): the image is the
 *     exact FIRST frame and the output takes its shape, so NO `aspect_ratio` is
 *     sent (the schema says not to);
 *   - no image → `pixverse-v6-max/text-to-video`
 *     (docs.kie.ai/market/pixverse/v6-max-text-to-video): `aspect_ratio` is
 *     required, one of the catalog's eight.
 *
 * Each body is an explicit allow-list — never a spread of `extraParams` or of
 * the caller's options, so a lever another model carries (a negative prompt
 * field, an end frame, reference lists, a stale `resolution`) can never reach
 * the wire:
 *   - `prompt` (1-5000; the platform's clamp has already cut it, and an empty
 *     one is sent as the platform's default motion text; every `@image_N`
 *     mention loses its `@`, as no reference image is sent),
 *   - `image_urls` (image-to-video only: exactly one URL, the start frame),
 *   - `aspect_ratio` (text-to-video only),
 *   - `quality` (the platform's `resolution`, through
 *     `normalizePixverseV6MaxQuality` — the same function the credit
 *     identifier bills through),
 *   - `duration` (an INTEGER, 1-15; the generic createTask path sends a string),
 *   - `generate_audio_switch` (always sent: KIE's default is off, while a
 *     request that names no audio setting renders AND bills audio on — the
 *     capability's `defaultOn`; the request's `sound`, else `generateAudio`,
 *     overrides it through `applyVideoAudioToggle` — `videoAudioIntent`, the
 *     same reading the `:audio` row is priced from),
 *   - `seed` (only a whole number 0-2147483647; a route's `-1` "random" and
 *     anything else is left out, so KIE picks one).
 */
import {
  PIXVERSE_V6_MAX_PROVIDER,
  applyVideoAudioToggle,
  normalizePixverseV6MaxQuality,
  type VideoAudioRequest,
} from "@nodaro/shared/models"
import { getModel } from "@nodaro/shared/model-catalog"
import { snapAspectRatioToken } from "../video/aspect-ratio.js"
import { neutralizeImageMentions } from "./image-mentions.js"
import { PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_MODEL, PIXVERSE_V6_MAX_TEXT_TO_VIDEO_MODEL } from "./models.js"

/** The aspect ratio a text-to-video run sends when it names none (KIE requires one). */
export const PIXVERSE_V6_MAX_DEFAULT_ASPECT = "16:9"

/** The prompt sent when the caller's is empty — KIE requires one character at
 *  least, and this is the platform's own default motion text. */
export const PIXVERSE_V6_MAX_DEFAULT_PROMPT = "smooth cinematic motion"

/** The seeds the schema accepts (`minimum` / `maximum`, both endpoints). */
export const PIXVERSE_V6_MAX_SEED_RANGE = { min: 0, max: 2147483647 } as const

/** The keys each body may carry — the allow-list the tests hold the builder to. */
export const PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_FIELDS = ["prompt", "image_urls", "quality", "duration", "generate_audio_switch", "seed"] as const
export const PIXVERSE_V6_MAX_TEXT_TO_VIDEO_FIELDS = ["prompt", "aspect_ratio", "quality", "duration", "generate_audio_switch", "seed"] as const

/** The eight text-to-video ratios, read from the catalog (the picker's single source). */
function declaredAspects(): readonly string[] {
  return getModel(PIXVERSE_V6_MAX_PROVIDER)?.aspectRatios ?? []
}

/**
 * The text-to-video aspect ratio: a declared ratio passes through; anything
 * else the shared route enum lets in (4:5, 5:4, 9:21, `auto`, `adaptive`, a
 * stale value) lands on the nearest declared ratio, or 16:9 when it names no
 * shape at all.
 */
export function resolvePixverseV6MaxAspect(requested: string | undefined): string {
  const declared = declaredAspects()
  const token = requested?.trim()
  if (token && declared.includes(token)) return token
  return (token ? snapAspectRatioToken(token, declared) : undefined) ?? PIXVERSE_V6_MAX_DEFAULT_ASPECT
}

/** A seed the schema takes, or undefined (left out of the body). */
export function pixverseV6MaxSeed(seed: unknown): number | undefined {
  return typeof seed === "number" && Number.isInteger(seed) && seed >= PIXVERSE_V6_MAX_SEED_RANGE.min && seed <= PIXVERSE_V6_MAX_SEED_RANGE.max
    ? seed
    : undefined
}

export interface PixverseV6MaxRequestArgs {
  /** The composed prompt; an empty one is sent as {@link PIXVERSE_V6_MAX_DEFAULT_PROMPT}. */
  prompt: string
  /** Already snapped to the model's durations (1..15). */
  durationSec: number
  resolution?: string
  /** Read on a text-to-video run only. */
  aspectRatio?: string
  /** The start frame (already normalized); present ⇒ the image-to-video endpoint. */
  startFrameUrl?: string
  /** The request's audio fields (`sound`, else `generateAudio`); no intent ⇒ audio on (the capability default). */
  audio?: VideoAudioRequest
  seed?: number
}

export interface PixverseV6MaxRequest {
  /** The KIE id to create the task under. */
  model: typeof PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_MODEL | typeof PIXVERSE_V6_MAX_TEXT_TO_VIDEO_MODEL
  input: Record<string, unknown>
}

export function buildPixverseV6MaxRequest(args: PixverseV6MaxRequestArgs): PixverseV6MaxRequest {
  const start = args.startFrameUrl?.trim() || undefined
  // The model takes no reference images, so a platform `@image_N` mention (a
  // reference, or a cast member's seat) points at nothing: it loses its `@`.
  const prompt = neutralizeImageMentions(args.prompt)
  const input: Record<string, unknown> = { prompt: prompt.trim() ? prompt : PIXVERSE_V6_MAX_DEFAULT_PROMPT }
  if (start) input.image_urls = [start]
  else input.aspect_ratio = resolvePixverseV6MaxAspect(args.aspectRatio)
  input.quality = normalizePixverseV6MaxQuality(args.resolution)
  // INTEGER on purpose — the generic createTask path sends a string.
  input.duration = args.durationSec
  // Audio on unless the caller turned it off (see the module docstring).
  input.generate_audio_switch = true
  applyVideoAudioToggle(input, PIXVERSE_V6_MAX_PROVIDER, args.audio)
  const seed = pixverseV6MaxSeed(args.seed)
  if (seed !== undefined) input.seed = seed
  return { model: start ? PIXVERSE_V6_MAX_IMAGE_TO_VIDEO_MODEL : PIXVERSE_V6_MAX_TEXT_TO_VIDEO_MODEL, input }
}
