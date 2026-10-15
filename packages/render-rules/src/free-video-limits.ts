/**
 * What an account that never paid may generate as video (owner decisions
 * 2026-10-14, after a signup farm spent a whole free grant on two 1080p Kling
 * clips). One rule, run by the backend (the credit preflight refuses with it,
 * before anything is reserved) and by the editor (it locks the options it
 * would refuse, with the reason), so the two can never disagree:
 *
 *   1. No Kling (any model of the catalog's Kling series), no Seedance 2.5
 *      (and its HD finalizer), no video upscaling (any `video-upscale` model),
 *      no video extension (any `extend` model).
 *   2. Every other video GENERATION model (an i2v / t2v mode) runs only at its
 *      lowest resolution and at most `maxSeconds` long; a model whose shortest
 *      clip is longer is unavailable, and "Auto" length is refused (it reserves
 *      the longest clip).
 *
 * Judged from the catalog, never from a list of ids: a new Kling SKU or a new
 * generation model is covered the day it is added. The answer is STRUCTURED
 * (`FreeVideoLock`), so each side words it in its own language.
 */
import { MODEL_CATALOG, isAutoVideoDuration, type ModelCatalogEntry } from "@nodaro/shared/model-catalog"
import { PRICING_DEFAULT_RESOLUTION, VIDEO_MODE_ALIASES } from "@nodaro/shared/models"

/** The video parameters of one request, as a route body or a node payload carries them. */
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

/** Why an option is locked. `label` is the catalog's model name. */
export type FreeVideoLock =
  | { readonly kind: "model"; readonly label: string }
  | { readonly kind: "upscale"; readonly label: string }
  | { readonly kind: "extend"; readonly label: string }
  | { readonly kind: "shortest"; readonly label: string; readonly max: number; readonly shortest: number }
  | { readonly kind: "auto"; readonly label: string; readonly max: number }
  | { readonly kind: "duration"; readonly label: string; readonly max: number }
  | { readonly kind: "resolution"; readonly label: string; readonly lowest: string }
  | { readonly kind: "size"; readonly label: string }

const GENERATION_MODES = new Set(["i2v", "t2v"])

function catalogVideo(id: string): ModelCatalogEntry | null {
  const entry = (MODEL_CATALOG as Record<string, ModelCatalogEntry | undefined>)[id]
  return entry && entry.kind === "video" ? entry : null
}

/**
 * The catalog's video entry for a provider id, or null for anything else. A
 * mode twin that is no catalog video id of its own (`grok` is Grok Imagine's
 * text-to-video id, and the catalog's `grok` is the IMAGE model) is judged as
 * its alias group (`VIDEO_MODE_ALIASES`) — the same model, the same limits.
 */
export function freeVideoEntry(provider: string): ModelCatalogEntry | null {
  const direct = catalogVideo(provider)
  if (direct) return direct
  const group = VIDEO_MODE_ALIASES.find((g) => provider === g.base || provider === g.i2v || provider === g.t2v)
  return group ? (catalogVideo(group.i2v) ?? catalogVideo(group.base) ?? catalogVideo(group.t2v)) : null
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

function isGeneration(entry: ModelCatalogEntry): boolean {
  return entry.modes.some((m) => GENERATION_MODES.has(m))
}

/** Whether the MODEL itself is locked, whatever its settings. */
export function freeVideoModelLock(provider: string, limits: FreeVideoLimits): FreeVideoLock | null {
  if (!limits.enabled) return null
  const entry = freeVideoEntry(provider)
  if (!entry) return null
  if (entry.modes.includes("video-upscale")) return { kind: "upscale", label: entry.label }
  if (entry.modes.includes("extend")) return { kind: "extend", label: entry.label }
  if (isBlockedModel(entry)) return { kind: "model", label: entry.label }
  if (!isGeneration(entry)) return null
  const durations = entry.durations ?? []
  if (durations.length > 0) {
    const shortest = Math.min(...durations)
    if (shortest > limits.maxSeconds) return { kind: "shortest", label: entry.label, max: limits.maxSeconds, shortest }
  }
  return null
}

/** Whether one DURATION option of an open model is locked (`undefined` = the model's default). */
export function freeVideoDurationLock(provider: string, duration: FreeVideoRequest["duration"], limits: FreeVideoLimits): FreeVideoLock | null {
  if (!limits.enabled) return null
  const entry = freeVideoEntry(provider)
  if (!entry || !isGeneration(entry) || !(entry.durations ?? []).length) return null
  const max = limits.maxSeconds
  if (duration !== null && duration !== undefined && isAutoVideoDuration(duration)) return { kind: "auto", label: entry.label, max }
  const asked = toSeconds(duration) ?? entry.defaultDuration ?? Math.min(...(entry.durations ?? []))
  return asked > max ? { kind: "duration", label: entry.label, max } : null
}

/**
 * Whether one RESOLUTION option of an open model is locked. An OMITTED
 * resolution is judged as the declared billed-and-rendered default
 * (`PRICING_DEFAULT_RESOLUTION`, e.g. Wan 3.0's 720p) when there is one, and
 * otherwise as unknown — locked on a model with more than one resolution,
 * because the provider renders its own default (KIE's is often 720p) whatever
 * the cheapest tier is. The routes and the payload builder fill the value
 * they bill, so a request that went through them always names one.
 */
export function freeVideoResolutionLock(provider: string, resolution: string | null | undefined, limits: FreeVideoLimits): FreeVideoLock | null {
  if (!limits.enabled) return null
  const entry = freeVideoEntry(provider)
  if (!entry || !isGeneration(entry)) return null
  const lowest = lowestResolution(entry)
  if (!lowest) return null
  const ladder = entry.resolutions ?? []
  const effective = resolution ?? PRICING_DEFAULT_RESOLUTION[entry.id] ?? (ladder.length === 1 ? lowest : null)
  if (effective === null) return { kind: "resolution", label: entry.label, lowest }
  const h = resolutionHeight(effective)
  const above = Number.isNaN(h) ? effective.toLowerCase() !== lowest.toLowerCase() : h > resolutionHeight(lowest)
  return above ? { kind: "resolution", label: entry.label, lowest } : null
}

/** Why this whole request cannot run on free credits, or null when it can (or is not video at all). */
export function freeVideoLock(req: FreeVideoRequest, limits: FreeVideoLimits): FreeVideoLock | null {
  const model = freeVideoModelLock(req.provider, limits)
  if (model) return model
  const duration = freeVideoDurationLock(req.provider, req.duration, limits)
  if (duration) return duration
  const resolution = freeVideoResolutionLock(req.provider, req.resolution, limits)
  if (resolution) return resolution
  const entry = limits.enabled ? freeVideoEntry(req.provider) : null
  if (entry && isGeneration(entry) && req.videoSize === "high") return { kind: "size", label: entry.label }
  return null
}
