/**
 * Topaz video upscale — the lever a caller sets and the target it resolves to.
 *
 * Topaz takes an absolute TARGET, never a factor: a resolution (720p, 1080p or
 * 4K — the short side of the frame; a portrait clip keeps its orientation) and
 * an output frame rate (15–60 fps; frames it has to invent are interpolated).
 * The editor used to send a 1×/2×/4× factor, which saved workflows, older API
 * callers and private plugins still do, so a factor is still accepted and is
 * mapped onto the target here: factor × the source's short side, snapped to
 * the nearest target.
 *
 * One resolver for every lane (route, workflow run, plugin toolkit), so the
 * target a run is priced at is the one sent.
 */

export const TOPAZ_VIDEO_RESOLUTIONS = ["720p", "1080p", "4k"] as const
export type TopazVideoResolution = (typeof TOPAZ_VIDEO_RESOLUTIONS)[number]

export const TOPAZ_VIDEO_DEFAULT_RESOLUTION: TopazVideoResolution = "1080p"

/** The short side, in pixels, of each target resolution. */
export const TOPAZ_VIDEO_SHORT_SIDE: Readonly<Record<TopazVideoResolution, number>> = {
  "720p": 720,
  "1080p": 1080,
  "4k": 2160,
}

export const TOPAZ_VIDEO_FPS_MIN = 15
export const TOPAZ_VIDEO_FPS_MAX = 60
/** The frame rates the editor offers beside "same as source". */
export const TOPAZ_VIDEO_FPS_CHOICES = [24, 25, 30, 50, 60] as const
/** The rate used when neither the caller nor the source names one. */
export const TOPAZ_VIDEO_FALLBACK_FPS = 30

export function isTopazVideoResolution(v: unknown): v is TopazVideoResolution {
  return typeof v === "string" && (TOPAZ_VIDEO_RESOLUTIONS as readonly string[]).includes(v)
}

/**
 * The target whose short side is nearest `shortSide` px (4K above it, 720p
 * below; a tie takes the larger). A legacy factor lands here: a 720p clip at
 * 2× (1440 px) renders at 1080p, a 1080p clip at 2× at 4K.
 */
export function topazVideoResolutionNearest(shortSide: number): TopazVideoResolution {
  let best: TopazVideoResolution = TOPAZ_VIDEO_RESOLUTIONS[0]
  for (const r of TOPAZ_VIDEO_RESOLUTIONS) {
    if (Math.abs(TOPAZ_VIDEO_SHORT_SIDE[r] - shortSide) <= Math.abs(TOPAZ_VIDEO_SHORT_SIDE[best] - shortSide)) best = r
  }
  return best
}

export function clampTopazVideoFps(fps: number): number {
  return Math.min(TOPAZ_VIDEO_FPS_MAX, Math.max(TOPAZ_VIDEO_FPS_MIN, Math.round(fps)))
}

export interface TopazVideoSource {
  width: number
  height: number
  /** The source's own frame rate; absent when it has none (variable or unreadable). */
  fps?: number
}

export interface TopazVideoTargetInput {
  targetResolution?: string | null
  /** Output frame rate; absent (or "source") = the source's own rate. */
  targetFps?: number | string | null
  /** Legacy relative lever ("1" | "2" | "4"): read only when no `targetResolution` is set. */
  upscaleFactor?: string | null
  source?: TopazVideoSource
}

export interface TopazVideoTarget {
  resolution: TopazVideoResolution
  fps: number
  /** What was read in place of what was asked, for the job log. Empty when the request was taken as sent. */
  adjustments: string[]
}

const LEGACY_FACTORS: Readonly<Record<string, number>> = { "1": 1, "2": 2, "4": 4 }

/**
 * The target a Topaz video upscale renders at. `targetResolution` wins; else a
 * legacy factor over the source's short side; else 1080p. `targetFps` is
 * clamped to 15–60; absent, the source's rate (clamped), else 30.
 */
export function resolveTopazVideoTarget(input: TopazVideoTargetInput): TopazVideoTarget {
  const adjustments: string[] = []
  const shortSide = input.source ? Math.min(input.source.width, input.source.height) : undefined

  let resolution: TopazVideoResolution
  if (isTopazVideoResolution(input.targetResolution)) {
    resolution = input.targetResolution
  } else {
    if (input.targetResolution != null && input.targetResolution !== "") {
      adjustments.push(`targetResolution "${input.targetResolution}" is not one of ${TOPAZ_VIDEO_RESOLUTIONS.join(", ")}`)
    }
    const factor = typeof input.upscaleFactor === "string" ? LEGACY_FACTORS[input.upscaleFactor.trim()] : undefined
    if (factor !== undefined && shortSide !== undefined) {
      resolution = topazVideoResolutionNearest(shortSide * factor)
      adjustments.push(`upscaleFactor ${factor}× of a ${shortSide}px short side → ${resolution}`)
    } else {
      resolution = TOPAZ_VIDEO_DEFAULT_RESOLUTION
      if (factor !== undefined) adjustments.push(`upscaleFactor ${factor}× with no readable source size → ${resolution}`)
    }
  }

  const asked = typeof input.targetFps === "number"
    ? input.targetFps
    : typeof input.targetFps === "string" && input.targetFps.trim() !== "" && input.targetFps !== "source"
      ? Number(input.targetFps)
      : undefined
  let fps: number
  if (asked !== undefined && Number.isFinite(asked)) {
    fps = clampTopazVideoFps(asked)
    if (fps !== asked) adjustments.push(`targetFps ${asked} → ${fps}`)
  } else if (input.source?.fps !== undefined && Number.isFinite(input.source.fps) && input.source.fps > 0) {
    fps = clampTopazVideoFps(input.source.fps)
  } else {
    fps = TOPAZ_VIDEO_FALLBACK_FPS
  }

  return { resolution, fps, adjustments }
}

/**
 * The output frame size a target renders a source at: the short side at the
 * target, the long side scaled by the source's aspect, both even. Without a
 * source, a 16:9 frame.
 */
export function topazVideoOutputSize(
  resolution: TopazVideoResolution,
  source?: Pick<TopazVideoSource, "width" | "height">,
): { width: number; height: number } {
  const short = TOPAZ_VIDEO_SHORT_SIDE[resolution]
  const ratio = source && source.width > 0 && source.height > 0
    ? Math.max(source.width, source.height) / Math.min(source.width, source.height)
    : 16 / 9
  const long = Math.round((short * ratio) / 2) * 2
  const portrait = source ? source.height > source.width : false
  return portrait ? { width: short, height: long } : { width: long, height: short }
}
