/**
 * LTX 2.5 request bodies — pure, no I/O.
 *
 * ONE Nodaro id per tier (`ltx-2.5-fast`, `ltx-2.5-pro`) over two KIE
 * endpoints, picked by what is wired:
 *   - a start frame → `ltx/2-5-{fast,pro}-image-to-video`
 *     (docs.kie.ai/market/ltx/2-5-fast-image-to-video, 2-5-pro-image-to-video):
 *     the image is the first frame and the output keeps its shape, so NO
 *     `aspect_ratio` is sent (the schema has none);
 *   - no image → `ltx/2-5-{fast,pro}-text-to-video`
 *     (docs.kie.ai/market/ltx/2-5-fast-text-to-video, 2-5-pro-text-to-video):
 *     `aspect_ratio` is one of the catalog's five.
 *
 * Each body is an explicit allow-list — never a spread of `extraParams` or of
 * the caller's options, so a lever another model carries (an end frame, a
 * negative prompt field, an audio switch, reference lists, a camera setting)
 * can never reach the wire:
 *   - `prompt` (1-5000; the platform's clamp has already cut it, and an empty
 *     one is sent as the platform's default motion text; every `@image_N`
 *     mention loses its `@`, as no reference image is sent),
 *   - `image_url` (image-to-video only: the start frame),
 *   - `aspect_ratio` (text-to-video only),
 *   - `resolution` (through `normalizeLtx25Resolution` — the same function the
 *     credit identifier bills through),
 *   - `fps` (through `videoFrameRateFor`: 24, 25, 48 or 50, else 24),
 *   - `duration` (an INTEGER the tier renders at that resolution and frame
 *     rate — `videoDurationCappedAt`, the cap the price reads; the generic
 *     createTask path sends a string),
 *   - `seed` (only a whole number 0-2147483647; a route's `-1` "random" and
 *     anything else is left out, so KIE picks one).
 * Sound is always generated: no schema has an audio field, so none is sent.
 */
import { isLtx25Provider, normalizeLtx25Resolution, videoDurationCappedAt, type Ltx25Provider } from "@nodaro/shared/models"
import { getModel, videoFrameRateFor } from "@nodaro/shared/model-catalog"
import { snapAspectRatioToken } from "../video/aspect-ratio.js"
import { neutralizeImageMentions } from "./image-mentions.js"
import {
  LTX_2_5_FAST_IMAGE_TO_VIDEO_MODEL,
  LTX_2_5_FAST_TEXT_TO_VIDEO_MODEL,
  LTX_2_5_PRO_IMAGE_TO_VIDEO_MODEL,
  LTX_2_5_PRO_TEXT_TO_VIDEO_MODEL,
} from "./models.js"

/** The aspect ratio a text-to-video run sends when it names none (the schemas' default). */
export const LTX_2_5_DEFAULT_ASPECT = "16:9"

/** The prompt sent when the caller's is empty — KIE requires one character at
 *  least, and this is the platform's own default motion text. */
export const LTX_2_5_DEFAULT_PROMPT = "smooth cinematic motion"

/** The seeds the schemas accept (`minimum` / `maximum`, every endpoint). */
export const LTX_2_5_SEED_RANGE = { min: 0, max: 2147483647 } as const

/** The keys each body may carry — the allow-list the tests hold the builder to. */
export const LTX_2_5_IMAGE_TO_VIDEO_FIELDS = ["prompt", "image_url", "resolution", "fps", "duration", "seed"] as const
export const LTX_2_5_TEXT_TO_VIDEO_FIELDS = ["prompt", "resolution", "fps", "duration", "aspect_ratio", "seed"] as const

type Ltx25Endpoint =
  | typeof LTX_2_5_FAST_IMAGE_TO_VIDEO_MODEL
  | typeof LTX_2_5_FAST_TEXT_TO_VIDEO_MODEL
  | typeof LTX_2_5_PRO_IMAGE_TO_VIDEO_MODEL
  | typeof LTX_2_5_PRO_TEXT_TO_VIDEO_MODEL

const ENDPOINTS: Record<Ltx25Provider, { readonly i2v: Ltx25Endpoint; readonly t2v: Ltx25Endpoint }> = {
  "ltx-2.5-fast": { i2v: LTX_2_5_FAST_IMAGE_TO_VIDEO_MODEL, t2v: LTX_2_5_FAST_TEXT_TO_VIDEO_MODEL },
  "ltx-2.5-pro": { i2v: LTX_2_5_PRO_IMAGE_TO_VIDEO_MODEL, t2v: LTX_2_5_PRO_TEXT_TO_VIDEO_MODEL },
}

/** The KIE endpoint a run of `provider` takes: image-to-video with a start frame, text-to-video without. */
export function ltx25Endpoint(provider: Ltx25Provider, hasStartFrame: boolean): Ltx25Endpoint {
  return hasStartFrame ? ENDPOINTS[provider].i2v : ENDPOINTS[provider].t2v
}

/** The five text-to-video ratios, read from the catalog (the picker's single source). */
function declaredAspects(provider: Ltx25Provider): readonly string[] {
  return getModel(provider)?.aspectRatios ?? []
}

/**
 * The text-to-video aspect ratio: a declared ratio passes through; anything
 * else the shared route enum lets in (4:3, 21:9, `auto`, `adaptive`, a stale
 * value) lands on the nearest declared ratio, or 16:9 when it names no shape.
 */
export function resolveLtx25Aspect(provider: Ltx25Provider, requested: string | undefined): string {
  const declared = declaredAspects(provider)
  const token = requested?.trim()
  if (token && declared.includes(token)) return token
  return (token ? snapAspectRatioToken(token, declared) : undefined) ?? LTX_2_5_DEFAULT_ASPECT
}

/** A seed the schemas take, or undefined (left out of the body). */
export function ltx25Seed(seed: unknown): number | undefined {
  return typeof seed === "number" && Number.isInteger(seed) && seed >= LTX_2_5_SEED_RANGE.min && seed <= LTX_2_5_SEED_RANGE.max
    ? seed
    : undefined
}

export interface Ltx25RequestArgs {
  provider: Ltx25Provider
  /** The composed prompt; an empty one is sent as {@link LTX_2_5_DEFAULT_PROMPT}. */
  prompt: string
  /** Already snapped to the tier's durations; the resolution and frame-rate cap is applied here. */
  durationSec: number
  resolution?: string
  /** The request's frame rate, unvalidated (`videoFrameRateFor`). */
  fps?: unknown
  /** Read on a text-to-video run only. */
  aspectRatio?: string
  /** The start frame (already normalized); present ⇒ the image-to-video endpoint. */
  startFrameUrl?: string
  seed?: number
}

export interface Ltx25Request {
  /** The KIE id to create the task under. */
  model: Ltx25Endpoint
  input: Record<string, unknown>
}

export function buildLtx25Request(args: Ltx25RequestArgs): Ltx25Request {
  if (!isLtx25Provider(args.provider)) throw new Error(`Not an LTX 2.5 model: ${String(args.provider)}`)
  const start = args.startFrameUrl?.trim() || undefined
  // The model takes no reference images, so a platform `@image_N` mention (a
  // reference, or a cast member's seat) points at nothing: it loses its `@`.
  const prompt = neutralizeImageMentions(args.prompt)
  const input: Record<string, unknown> = { prompt: prompt.trim() ? prompt : LTX_2_5_DEFAULT_PROMPT }
  if (start) input.image_url = start
  const resolution = normalizeLtx25Resolution(args.provider, args.resolution)
  const fps = videoFrameRateFor(args.provider, args.fps)!
  input.resolution = resolution
  input.fps = fps
  // INTEGER on purpose, and one the tier renders at this resolution and frame
  // rate (Fast: at most 10 s at 1440p or 48 / 50 fps).
  input.duration = videoDurationCappedAt(args.provider, args.durationSec, { resolution, fps })
  if (!start) input.aspect_ratio = resolveLtx25Aspect(args.provider, args.aspectRatio)
  const seed = ltx25Seed(args.seed)
  if (seed !== undefined) input.seed = seed
  return { model: ltx25Endpoint(args.provider, !!start), input }
}
