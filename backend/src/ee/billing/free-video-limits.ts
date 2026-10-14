// The free-credit video limits, as the backend refuses with them. The rule
// itself is `@nodaro/render-rules` (`free-video-limits.ts`) — the editor locks
// options with the SAME function, so the two can never disagree. This file
// adds the backend's two pieces: reading a request body / node payload, and
// the English refusal message.
import {
  freeVideoEntry,
  freeVideoLock,
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
