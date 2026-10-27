/**
 * Upscaling a trend's videos to 1080p (pure; no I/O).
 *
 * Admins make a trend's examples, and may make its source clip, at 720p (it
 * costs less) and upscale them afterwards: Topaz asked for 1080p (the core
 * `POST /v1/video-upscale`, `targetResolution: "1080p"`, the short side; a
 * `video-upscale` job of the admin, billed as any upscale), then stored as it
 * is when it already is exactly 1080 on the short side, else resized so it is
 * (aspect kept, both sides even: yuv420p needs them even). A video at exactly
 * 1080 on its short side is offered an enhance instead (the same Topaz ask, at
 * the same size); one above 1080 is offered nothing (`trendUpscaleOfferFor`,
 * shared with the trend builder).
 *
 * The upscale in the making is recorded on the draft (`TrendUpscaleJob`),
 * named by the video it was made from, so it survives a reload, a reorder
 * and a removal: it applies only while that video is still the target's.
 */
import { TREND_UPSCALE_SHORT_SIDE, trendUpscaleOfferFor } from "@nodaro/render-rules"
import { MAX_UPSCALE_JOBS, PREVIEW_SECONDS } from "./schemas.js"
import { withoutPreviewClip } from "./preview-clip.js"
import type { TrendUpscaleJob, TrendVersionData } from "./types.js"

/** The short side of every upscaled (or enhanced) video. */
export const UPSCALE_SHORT_SIDE = TREND_UPSCALE_SHORT_SIDE

/** The Topaz target asked for: 1080p, the short side (portrait stays portrait). */
export const UPSCALE_TOPAZ_RESOLUTION = "1080p"

/**
 * How long "Use it" may run in the background before it is taken for dead (a
 * server restart) and may be tried again. The resize and the store take
 * minutes at most.
 */
export const UPSCALE_APPLY_STALE_MS = 15 * 60 * 1000

/** Whether `job`'s "Use it" is running now (started, and not yet stale). */
export function isApplying(job: Pick<TrendUpscaleJob, "applying">, now = Date.now()): boolean {
  const at = job.applying ? Date.parse(job.applying.startedAt) : Number.NaN
  return Number.isFinite(at) && now - at < UPSCALE_APPLY_STALE_MS
}

/** The core job type of an upscale. */
export const UPSCALE_JOB_TYPE = "video-upscale"

/**
 * The size a `width`×`height` video is resized to: its short side
 * `UPSCALE_SHORT_SIDE`, its long side scaled by the same ratio and rounded to
 * the nearest even number (never below the short side). The orientation is
 * kept: 720×1280 → 1080×1920, 1280×720 → 1920×1080.
 */
export function upscaleTargetSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new RangeError(`Not a video size: ${width}×${height}`)
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  const scaledLong = Math.max(UPSCALE_SHORT_SIDE, Math.round((long * UPSCALE_SHORT_SIDE) / short / 2) * 2)
  return width <= height ? { width: UPSCALE_SHORT_SIDE, height: scaledLong } : { width: scaledLong, height: UPSCALE_SHORT_SIDE }
}

/**
 * Whether a video of this size is offered Topaz: an upscale when its short
 * side is under `UPSCALE_SHORT_SIDE`, an enhance at the same size when it is
 * exactly that, nothing above it (`trendUpscaleOfferFor`). An unknown size (a
 * source clip stored before sizes were recorded) is offered an upscale.
 */
export function offersUpscale(width: number | undefined, height: number | undefined): boolean {
  return trendUpscaleOfferFor(width, height) !== null
}

/** What an upscale is for: the source clip, or the example at `index`. */
export type UpscaleTarget = { target: "source" } | { target: "example"; index: number }

/** The video an upscale of `target` is made from, with its size and length, or null when the draft has no such target. */
export function upscaleSourceOf(
  data: Pick<TrendVersionData, "source" | "examples">,
  target: UpscaleTarget,
): { fromUrl: string; width?: number; height?: number; durationSec: number } | null {
  if (target.target === "source") {
    const s = data.source
    if (!s) return null
    // The display copy has the same short side (it is the same picture, its rotation applied).
    const width = s.width ?? s.display?.width
    const height = s.height ?? s.display?.height
    return { fromUrl: s.videoUrl, durationSec: s.durationSec, ...(width ? { width } : {}), ...(height ? { height } : {}) }
  }
  const ex = data.examples[target.index]
  return ex ? { fromUrl: ex.videoUrl, width: ex.width, height: ex.height, durationSec: ex.durationSec } : null
}

/**
 * Where an upscale made from `fromUrl` applies now: the source, or the
 * example whose video is still `fromUrl` (its index today), or null when
 * that video was replaced or removed since.
 */
export function currentUpscaleTarget(
  data: Pick<TrendVersionData, "source" | "examples">,
  job: Pick<TrendUpscaleJob, "target" | "fromUrl">,
): UpscaleTarget | null {
  if (job.target === "source") return data.source?.videoUrl === job.fromUrl ? { target: "source" } : null
  const index = data.examples.findIndex((e) => e.videoUrl === job.fromUrl)
  return index >= 0 ? { target: "example", index } : null
}

/**
 * The draft's upscales with `job` recorded: one per target video (a new one
 * replaces an older one for the same video), the ones whose video is gone
 * dropped, and at most `MAX_UPSCALE_JOBS` (the oldest go first).
 */
export function withUpscaleJob(data: Pick<TrendVersionData, "source" | "examples" | "upscaleJobs">, job: TrendUpscaleJob): TrendUpscaleJob[] {
  const kept = (data.upscaleJobs ?? []).filter(
    (j) => !(j.target === job.target && j.fromUrl === job.fromUrl) && currentUpscaleTarget(data, j) !== null,
  )
  return [...kept, job].slice(-MAX_UPSCALE_JOBS)
}

/** `data` without the upscale `jobId` (the key left out when none is left). */
export function withoutUpscaleJob<T extends Pick<TrendVersionData, "upscaleJobs">>(data: T, jobId: string): T {
  const { upscaleJobs, ...rest } = data
  const left = (upscaleJobs ?? []).filter((j) => j.jobId !== jobId)
  return (left.length > 0 ? { ...rest, upscaleJobs: left } : rest) as T
}

/**
 * An upscale in the making as the editor shows it: `index` = the example it
 * applies to now; `current` = it still applies; `applying` = "Use it" is
 * running (`stale`: past `UPSCALE_APPLY_STALE_MS`, may be tried again);
 * `error` = the last "Use it" failed.
 */
export interface PendingUpscaleJob {
  jobId: string
  target: "source" | "example"
  fromUrl: string
  startedAt: string
  current: boolean
  index?: number
  applying?: { startedAt: string; stale: boolean }
  error?: { code: string; message: string }
}

export function pendingUpscaleJobs(data: Pick<TrendVersionData, "source" | "examples" | "upscaleJobs">, now = Date.now()): PendingUpscaleJob[] {
  return (data.upscaleJobs ?? []).map((j) => {
    const target = currentUpscaleTarget(data, j)
    return {
      jobId: j.jobId,
      target: j.target,
      fromUrl: j.fromUrl,
      startedAt: j.startedAt,
      current: target !== null,
      ...(target?.target === "example" ? { index: target.index } : {}),
      ...(j.applying ? { applying: { startedAt: j.applying.startedAt, stale: !isApplying(j, now) } } : {}),
      ...(j.error ? { error: { code: j.error.code, message: j.error.message } } : {}),
    }
  })
}

/** The 4 s preview's start kept inside a clip of `durationSec`, as the editor's `clampPreview` keeps it on a new clip. */
export function clampPreviewStart(start: number | null, durationSec: number): number | null {
  if (start === null) return null
  return Math.max(0, Math.min(start, Math.max(0, durationSec - PREVIEW_SECONDS)))
}

/**
 * `data` with `stored` as its source clip, as a new source clip is set (an
 * upscale or a crop put in): the stored clip, its size, length and hash, and
 * its own display copy, with the preview start kept inside it. A stored face
 * mask goes out of date by design: its settings key names the source clip.
 * The stored preview clip is DROPPED (`withoutPreviewClip`): it was cut from
 * the old clip, and the caller makes it again (`ensurePreviewClip`) — dropped
 * here so a stale one never survives a caller that forgets.
 */
export function withNewSourceClip<T extends Pick<TrendVersionData, "source" | "previewStart" | "previewClip">>(
  data: T,
  stored: { url: string; durationSec: number; width: number; height: number; display?: NonNullable<TrendVersionData["source"]>["display"]; sha256?: string },
): T {
  const source: NonNullable<TrendVersionData["source"]> = {
    videoUrl: stored.url,
    durationSec: stored.durationSec,
    width: stored.width,
    height: stored.height,
    ...(stored.display ? { display: stored.display } : {}),
    ...(stored.sha256 ? { sha256: stored.sha256 } : {}),
  }
  return withoutPreviewClip({ ...data, source, previewStart: clampPreviewStart(data.previewStart, source.durationSec) })
}
