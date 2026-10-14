// What a run on FREE credits may generate as video (decided 2026-10-14, after
// a signup farm spent a whole grant on two 1080p Kling clips):
//
//   1. No video upscaling (any `video-upscale` model), no Kling (any model of
//      the catalog's Kling series: generation, motion
//      transfer, lip-sync) and no Seedance 2.5 (the model and its HD finalizer).
//   2. Every other video GENERATION model (an i2v / t2v mode) runs only at its
//      lowest resolution and at most `maxSeconds` long; a model whose shortest
//      clip is longer is not available, and "auto" duration is refused (it
//      reserves the longest clip).
//
// Judged from the catalog, never from a list of ids: a new Kling SKU, or a new
// generation model, is covered the day it is added. Applied only under
// free-tier semantics (`gates.freeSemantics` — the same accounts the veo3 block
// applies to), by `CreditsService.checkCreditsWithProfile`, which both the
// route guard and the orchestrator's preflight call. Pure: the runtime knobs
// come in as `limits` (`ee/lib/free-video-config.ts`).
import { MODEL_CATALOG, isAutoVideoDuration, type ModelCatalogEntry } from "@nodaro/shared/model-catalog"
import { PRICING_DEFAULT_RESOLUTION } from "@nodaro/shared/models"

/** The video parameters of one request, as the route or the payload carries them. */
export interface FreeVideoRequest {
  provider: string
  duration?: number | string | null
  resolution?: string | null
  /** Hailuo's size lever; "high" is the upper tier. */
  videoSize?: string | null
}

export interface FreeVideoLimits {
  enabled: boolean
  maxSeconds: number
}

export const FREE_VIDEO_LIMITS_DEFAULTS: FreeVideoLimits = { enabled: true, maxSeconds: 4 }

/** Catalog series whose every model is paid-only. */
export const FREE_BLOCKED_VIDEO_SERIES: readonly string[] = ["Kling"]
/** Model ids (and their `<id>-…` variants) that are paid-only. */
export const FREE_BLOCKED_VIDEO_MODELS: readonly string[] = ["seedance-2-5"]

export interface FreeVideoRefusal {
  readonly reason: "free_video"
  readonly error: string
}

const GENERATION_MODES = new Set(["i2v", "t2v"])

function videoEntry(provider: string): ModelCatalogEntry | null {
  const entry = (MODEL_CATALOG as Record<string, ModelCatalogEntry | undefined>)[provider]
  return entry && entry.kind === "video" ? entry : null
}

function isBlockedModel(entry: ModelCatalogEntry): boolean {
  if (entry.series && FREE_BLOCKED_VIDEO_SERIES.includes(entry.series)) return true
  return FREE_BLOCKED_VIDEO_MODELS.some((id) => entry.id === id || entry.id.startsWith(`${id}-`))
}

/**
 * A resolution label's height in pixels, for ordering only: "480p" → 480,
 * "768P" → 768, "2K" → 1440, "4k" → 2160. NaN for a label it cannot read.
 */
export function resolutionHeight(label: string): number {
  const s = label.trim().toLowerCase()
  const p = /^(\d{3,4})p$/.exec(s)
  if (p) return Number(p[1])
  const k = /^(\d)k$/.exec(s)
  if (k) return k[1] === "2" ? 1440 : k[1] === "4" ? 2160 : Number(k[1]) * 540
  return Number.NaN
}

/** The model's lowest listed resolution, or null when it lists none it can order. */
export function lowestResolution(entry: ModelCatalogEntry): string | null {
  let best: string | null = null
  for (const r of entry.resolutions ?? []) {
    const h = resolutionHeight(r)
    if (Number.isNaN(h)) continue
    if (best === null || h < resolutionHeight(best)) best = r
  }
  return best
}

function toSeconds(duration: FreeVideoRequest["duration"]): number | null {
  if (duration === null || duration === undefined || duration === "") return null
  const n = typeof duration === "number" ? duration : Number(String(duration).replace(/s$/i, ""))
  return Number.isFinite(n) ? n : null
}

const PAID = "Upgrade or buy credits to use it."

/**
 * Why this request cannot run on free credits, or null when it can (or when
 * it is not a video model at all).
 */
export function freeVideoRefusal(req: FreeVideoRequest, limits: FreeVideoLimits): FreeVideoRefusal | null {
  if (!limits.enabled) return null
  const entry = videoEntry(req.provider)
  if (!entry) return null

  if (isBlockedModel(entry)) {
    return { reason: "free_video", error: `${entry.label} is not available on free credits. ${PAID}` }
  }
  if (entry.modes.includes("video-upscale")) {
    return { reason: "free_video", error: `Upscaling video is not available on free credits. ${PAID}` }
  }
  if (!entry.modes.some((m) => GENERATION_MODES.has(m))) return null

  const max = limits.maxSeconds
  const durations = entry.durations ?? []
  if (durations.length > 0) {
    const shortest = Math.min(...durations)
    if (shortest > max) {
      return { reason: "free_video", error: `On free credits videos are at most ${max} seconds, and ${entry.label}'s shortest is ${shortest}. ${PAID}` }
    }
    const raw = req.duration
    if (raw !== null && raw !== undefined && isAutoVideoDuration(raw as number)) {
      return { reason: "free_video", error: `On free credits pick a length of up to ${max} seconds (not Auto). ${PAID}` }
    }
    const asked = toSeconds(raw) ?? entry.defaultDuration ?? shortest
    if (asked > max) {
      return { reason: "free_video", error: `On free credits videos are at most ${max} seconds. ${PAID}` }
    }
  }

  const lowest = lowestResolution(entry)
  if (lowest) {
    // An omitted resolution is what the platform bills by default: the
    // declared default when there is one, else the cheapest tier.
    const effective = req.resolution ?? PRICING_DEFAULT_RESOLUTION[entry.id] ?? lowest
    const h = resolutionHeight(effective)
    if (Number.isNaN(h) ? effective !== lowest : h > resolutionHeight(lowest)) {
      return { reason: "free_video", error: `On free credits ${entry.label} runs at ${lowest} only. ${PAID}` }
    }
  }
  if (req.videoSize === "high") {
    return { reason: "free_video", error: `On free credits ${entry.label} runs at the standard size only. ${PAID}` }
  }
  return null
}

/** The video parameters of a request body or node payload, or undefined when it names no video model. */
export function freeVideoRequestOf(raw: Record<string, unknown> | null | undefined): FreeVideoRequest | undefined {
  const provider = typeof raw?.provider === "string" ? raw.provider : null
  if (!provider || !videoEntry(provider)) return undefined
  return {
    provider,
    duration: raw?.duration as FreeVideoRequest["duration"],
    resolution: typeof raw?.resolution === "string" ? raw.resolution : null,
    videoSize: typeof raw?.videoSize === "string" ? raw.videoSize : null,
  }
}
