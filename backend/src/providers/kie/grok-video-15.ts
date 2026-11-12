/**
 * Grok Imagine Video 1.5 request body — pure, no I/O.
 *
 * KIE `grok-imagine-video-1-5-preview` (docs.kie.ai/market/grok-imagine/1-5-preview).
 * The schema's `input` is `additionalProperties: false`, so the body is an
 * explicit allow-list: `prompt`, `image_urls`, `aspect_ratio`, `resolution`,
 * `duration` (an INTEGER), `first_frame_url`, `last_frame_url`, `loop_url`,
 * `keyframes`, `nsfw_checker`. Never a seed, a negative prompt, a reference
 * list or `enable_audio` (not part of this model's levers; KIE's default, on,
 * renders).
 *
 * FRAMES (decided 2026-11-11):
 *   - the start frame is the exact first frame (`first_frame_url`), the end
 *     frame the exact last frame (`last_frame_url`);
 *   - the SAME image wired as both is a seamless loop: `loop_url` alone, and
 *     neither `first_frame_url` nor `last_frame_url` (KIE refuses a loop image
 *     beside a different first or last frame);
 *   - the node's Image References are the in-between frames (`keyframes`, at
 *     most 4) and nothing else — never `image_urls`. The node has no per-frame
 *     time, so they are spread evenly over the clip at whole seconds
 *     ({@link grokVideo15KeyframeTimestamps}); frames past the clip's slots
 *     ({@link grokVideo15MiddleFrameSlots}) are left out with a note.
 *
 * THE START FRAME'S TRANSPORT. KIE's schema lists `image_urls` as required yet
 * says the first frame "can be sent on its own". Only a paid run settles which
 * reading KIE enforces, so the transport is ONE named constant,
 * {@link GROK_VIDEO_15_START_FRAME_TRANSPORT}, with two tested bodies:
 *   - `"first-frame-only"` (the default): the start image rides
 *     `first_frame_url` (or `loop_url`) alone, with no `image_urls`;
 *   - `"first-frame-and-image-urls"`: the same image also rides `image_urls`
 *     (one entry — the schema's maximum, and the only one allowed at 1080p).
 *
 * MENTIONS. KIE reads `@imageN` as the Nth `image_urls` entry. The platform
 * writes its own `@image_N` numbering for the caller's references (here: the
 * in-between frames), and Grok Imagine 1's own form is `@image(n)`. None of
 * those has a target in this body except `@image1` under the second transport
 * (the start image), so every other image mention loses its `@` and reaches
 * the model as plain words.
 */
import {
  GROK_VIDEO_15_PROVIDER,
  grokVideo15MiddleFrameSlots,
  normalizeGrokVideo15Resolution,
} from "@nodaro/shared/models"
import { getModel } from "@nodaro/shared/model-catalog"
import { neutralizeImageMentions } from "./image-mentions.js"

/** How the start image travels — see the module docstring. */
export type GrokVideo15StartFrameTransport = "first-frame-only" | "first-frame-and-image-urls"

/**
 * The transport every run uses. `"first-frame-only"` until a staging run shows
 * KIE refuses a body without `image_urls`; then flip to
 * `"first-frame-and-image-urls"`.
 */
export const GROK_VIDEO_15_START_FRAME_TRANSPORT: GrokVideo15StartFrameTransport = "first-frame-only"

/**
 * The aspect ratios forwarded to KIE: the catalog's (the picker's single source)
 * plus `auto`, KIE's default. Anything else (21:9 from the shared route enum, a
 * stale value) is sent as `auto` rather than refused by KIE.
 */
const GROK_VIDEO_15_ASPECTS: ReadonlySet<string> = new Set([
  ...(getModel(GROK_VIDEO_15_PROVIDER)?.aspectRatios ?? []),
  "auto",
])

export interface GrokVideo15RequestArgs {
  /** The composed prompt (the caller applies the platform default when empty). */
  prompt: string
  /** Already snapped to the model's durations (1..15). */
  durationSec: number
  resolution?: string
  aspectRatio?: string
  /** RAW URLs (before image normalization), so a loop is recognised. */
  startFrameUrl?: string
  endFrameUrl?: string
  /** The node's Image References, in order — the in-between frames. */
  inBetweenFrameUrls?: readonly string[]
  /** Defaults to {@link GROK_VIDEO_15_START_FRAME_TRANSPORT}. */
  transport?: GrokVideo15StartFrameTransport
}

export interface GrokVideo15Request {
  input: Record<string, unknown>
  /** What the builder had to drop or change, for the run log. */
  notes: string[]
}

/**
 * Whole-second timestamps for `count` in-between frames over a `durationSec`
 * clip: evenly spread, strictly between 0 and the duration, strictly
 * increasing. `round(i × D / (count + 1))`; with `count ≤ D − 1` the spacing
 * is at least one second, so no two land on the same second (and every pair is
 * at least the 1/3 s apart KIE asks for).
 */
export function grokVideo15KeyframeTimestamps(count: number, durationSec: number): number[] {
  const n = Math.max(0, Math.min(count, durationSec - 1))
  return Array.from({ length: n }, (_, i) => Math.round(((i + 1) * durationSec) / (n + 1)))
}

/**
 * Drop the `@` from every image mention the body does not carry: only `@image1`
 * stays live, and only when the start image rides `image_urls`.
 */
export function neutralizeGrokVideo15Mentions(prompt: string, startImageInImageUrls: boolean): string {
  return neutralizeImageMentions(prompt, (word) => startImageInImageUrls && word === "image1")
}

const clean = (u: string | undefined): string | undefined => u?.trim() || undefined

export function buildGrokVideo15Request(args: GrokVideo15RequestArgs): GrokVideo15Request {
  const notes: string[] = []
  const transport = args.transport ?? GROK_VIDEO_15_START_FRAME_TRANSPORT
  const start = clean(args.startFrameUrl)
  const end = clean(args.endFrameUrl)
  // One picture as both ends: a seamless loop.
  const loop = start !== undefined && start === end

  const allMiddle = (args.inBetweenFrameUrls ?? []).map(clean).filter((u): u is string => u !== undefined)
  const slots = grokVideo15MiddleFrameSlots(args.durationSec)
  const middle = allMiddle.slice(0, slots)
  if (middle.length < allMiddle.length) {
    notes.push(
      `dropped ${allMiddle.length - middle.length} in-between frame(s): a ${args.durationSec}s clip takes ${slots} ` +
      `(one per whole second inside the clip, at most 4)`,
    )
  }

  const startImageInImageUrls = transport === "first-frame-and-image-urls" && start !== undefined
  const aspect = args.aspectRatio === "Auto" || args.aspectRatio === "adaptive" ? "auto" : args.aspectRatio?.trim()

  const input: Record<string, unknown> = {
    prompt: neutralizeGrokVideo15Mentions(args.prompt, startImageInImageUrls),
    aspect_ratio: aspect && GROK_VIDEO_15_ASPECTS.has(aspect) ? aspect : "auto",
    resolution: normalizeGrokVideo15Resolution(args.resolution),
    // INTEGER on purpose — the generic createTask path sends a string.
    duration: args.durationSec,
    // Sent explicitly (the provider's own default is also off); declared as the
    // model's safety lever (NSFW_CHECKER_SENT_FALSE_LEVER).
    nsfw_checker: false,
  }
  if (startImageInImageUrls) input.image_urls = [start]
  if (loop) {
    input.loop_url = start
    notes.push("the start and end frame are the same image: sent as loop_url (a seamless loop)")
  } else {
    if (start) input.first_frame_url = start
    if (end) input.last_frame_url = end
  }
  if (middle.length > 0) {
    const times = grokVideo15KeyframeTimestamps(middle.length, args.durationSec)
    input.keyframes = middle.map((url, i) => ({ url, timestamp_s: times[i]! }))
  }
  return { input, notes }
}
