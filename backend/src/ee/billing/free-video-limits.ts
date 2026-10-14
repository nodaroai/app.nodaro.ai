// The free-credit video limits, as the backend refuses with them. The rule
// itself is `@nodaro/render-rules` (`free-video-limits.ts`) — the editor locks
// options with the SAME function, so the two can never disagree. This file
// adds the backend's two pieces: reading a request body / node payload, and
// the English refusal message.
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import {
  freeVideoEntry,
  freeVideoLock,
  freeVideoModelLock,
  type FreeVideoLimits,
  type FreeVideoLock,
  type FreeVideoRequest,
} from "@nodaro/render-rules"

export {
  FREE_BLOCKED_VIDEO_MODELS,
  FREE_BLOCKED_VIDEO_SERIES,
  FREE_VIDEO_LIMITS_DEFAULTS,
  lowestResolution,
  resolutionHeight,
  type FreeVideoLimits,
  type FreeVideoLock,
  type FreeVideoRequest,
} from "@nodaro/render-rules"

export interface FreeVideoRefusal {
  readonly reason: "free_video"
  readonly error: string
}

const PAID = "Upgrade or buy credits to use it."

/** The English refusal for a lock. */
export function freeVideoLockMessage(lock: FreeVideoLock): string {
  switch (lock.kind) {
    case "model":
      return `${lock.label} is not available on free credits. ${PAID}`
    case "upscale":
      return `Upscaling video is not available on free credits. ${PAID}`
    case "extend":
      return `Extending video is not available on free credits. ${PAID}`
    case "shortest":
      return `On free credits videos are at most ${lock.max} seconds, and ${lock.label}'s shortest is ${lock.shortest}. ${PAID}`
    case "auto":
      return `On free credits pick a length of up to ${lock.max} seconds (not Auto). ${PAID}`
    case "duration":
      return `On free credits videos are at most ${lock.max} seconds. ${PAID}`
    case "resolution":
      return `On free credits ${lock.label} runs at ${lock.lowest} only. ${PAID}`
    case "size":
      return `On free credits ${lock.label} runs at the standard size only. ${PAID}`
  }
}

/** Why this request cannot run on free credits, or null when it can (or is not video at all). */
export function freeVideoRefusal(req: FreeVideoRequest, limits: FreeVideoLimits): FreeVideoRefusal | null {
  const lock = freeVideoLock(req, limits)
  return lock ? { reason: "free_video", error: freeVideoLockMessage(lock) } : null
}

/**
 * The MODEL-level refusal only (blocked series, upscale, extend, a shortest
 * clip over the limit), for a caller that knows the model but not the
 * request's length or resolution — a reserved model id, a pinned model.
 */
export function freeVideoModelRefusal(provider: string, limits: FreeVideoLimits): FreeVideoRefusal | null {
  const lock = freeVideoModelLock(provider, limits)
  return lock ? { reason: "free_video", error: freeVideoLockMessage(lock) } : null
}

/**
 * Whether a RESERVED model id (a composite's base) is itself a catalog video
 * model. Direct ids only, never an alias twin: `grok` is also the IMAGE model's
 * id, and `minimax` names a music provider too, so a bare id outside a video
 * lane must not be read as video.
 */
export function isVideoModelId(provider: string): boolean {
  const entry = (MODEL_CATALOG as Record<string, { kind?: string } | undefined>)[provider]
  return entry?.kind === "video"
}

/** Job types that generate video from the `provider` their payload names. */
const VIDEO_JOB_NAMES: ReadonlySet<string> = new Set([
  "image-to-video", "text-to-video", "generate-video", "extend-video", "video-upscale",
  "lip-sync", "motion-transfer", "video-to-video", "generate-video-pro", "edit-video-pro",
])

/**
 * A job's video request to judge, or undefined when the job is no video run:
 * a video job type, or a job reserving under a video model / wrapper id. A
 * music job whose provider is `minimax` is not a Hailuo video.
 */
export function freeVideoRequestForJob(jobName: string, reservedId: string, raw: Record<string, unknown> | null | undefined): FreeVideoRequest | undefined {
  const base = reservedId.split(":")[0] ?? ""
  return VIDEO_JOB_NAMES.has(jobName) || readsVideoBody(base) ? freeVideoRequestOf(raw) : undefined
}

/**
 * Lanes that reserve under their own id but run a video model named in the
 * body's `provider` (Generate / Edit Video Pro run the underlying model).
 */
const VIDEO_WRAPPER_IDS: ReadonlySet<string> = new Set(["generate-video-pro", "edit-video-pro"])

/**
 * Whether a route reserving under this id generates video, so its body's
 * `provider` / `duration` / `resolution` are a video request to judge. A text
 * route that merely names a target video model (Prompt Helper) is not one.
 */
export function readsVideoBody(reservedBase: string): boolean {
  return isVideoModelId(reservedBase) || VIDEO_WRAPPER_IDS.has(reservedBase)
}

/** The video parameters of a request body or node payload, or undefined when it names no video model. */
export function freeVideoRequestOf(raw: Record<string, unknown> | null | undefined): FreeVideoRequest | undefined {
  const provider = typeof raw?.provider === "string" ? raw.provider : null
  if (!provider || !freeVideoEntry(provider)) return undefined
  return {
    provider,
    duration: raw?.duration as FreeVideoRequest["duration"],
    resolution: typeof raw?.resolution === "string" ? raw.resolution : null,
    videoSize: typeof raw?.videoSize === "string" ? raw.videoSize : null,
  }
}
