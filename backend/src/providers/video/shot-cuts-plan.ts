/**
 * Shot Cuts — the caps, the shot list and the budget, PURE (no ffmpeg, no
 * storage, no config): the job-budget registry, read by the workflow engine,
 * reaches `shotCutsJobBudgetMs` without loading the ffmpeg runtime
 * (`lib/__tests__/job-budget-leaf.test.ts`). `shot-cuts.ts` runs ffmpeg.
 *
 * The cuts are the platform's measured rule (`detectShotCuts`,
 * `services/scene-cut-frames.ts` — the one Video Mask's per-shot masking and the
 * internal scene-cuts step use): every decoded frame scored, the isolated
 * spikes kept. This file turns them into shots.
 */
import { SPLIT_MEDIA_MAX_SOURCE_SEC } from "@nodaro/render-rules"
import { BIG_MEDIA_MAX_BYTES, DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_MAX_MS, FFPROBE_TIMEOUT_MS } from "./ffmpeg-timeouts.js"

/** The longest clip measured on the public path, seconds (30 minutes). */
export const SHOT_CUTS_MAX_DURATION_SEC = 30 * 60

/**
 * The largest clip downloaded, bytes: Split into Chunks' big-media cap
 * (`BIG_MEDIA_MAX_BYTES`, sized for its 3-hour sources) at the same bytes per
 * second of footage, for 30 minutes — about 10.7 GiB.
 */
export const SHOT_CUTS_MAX_BYTES = Math.floor((BIG_MEDIA_MAX_BYTES * SHOT_CUTS_MAX_DURATION_SEC) / SPLIT_MEDIA_MAX_SOURCE_SEC)

/**
 * The most shots whose first and last frames a run saves (two images a shot,
 * so up to 2,000 PNGs). Its own cap, apart from Split into Chunks' 200-part
 * cap. A clip with more shots and `frames` on fails (refunded) with the count;
 * its times alone have no cap.
 */
export const SHOT_CUTS_MAX_FRAME_SHOTS = 1_000

/** How many frame uploads a run makes at once. */
export const SHOT_CUTS_UPLOAD_CONCURRENCY = 6

/**
 * The time one frame's upload is allowed, ms: a full-size PNG (a 4K frame is
 * tens of MB) at a slow storage rate, with its request. The frame uploads are
 * budgeted (unlike most jobs' one upload) because a run can make 2,000 of them.
 */
export const SHOT_CUTS_FRAME_UPLOAD_MS = 10_000

/** A decode's kill budget: the default plus 4 s per second of footage (Video Mask's own scan budget). */
export function shotCutsDecodeTimeoutMs(durationSec: number): number {
  return DEFAULT_FFMPEG_TIMEOUT_MS + Math.ceil(Math.max(0, durationSec)) * 4_000
}

/** Seconds to the millisecond. */
export const toMs = (s: number): number => Math.round(s * 1000) / 1000

/** One shot of a clip. */
export interface Shot {
  /** From 0, in order. */
  readonly index: number
  /** Seconds from the clip's first frame. */
  readonly startSec: number
  /** Where the next shot starts, or the clip's end. */
  readonly endSec: number
  readonly durationSec: number
  readonly firstFrameUrl?: string
  readonly lastFrameUrl?: string
}

/** A shot before its frames are saved: its times and the decoded frames it starts and ends on. */
export interface PlannedShot extends Omit<Shot, "firstFrameUrl" | "lastFrameUrl"> {
  /** The shot's first decoded frame (a select filter's `n`). */
  readonly firstFrame: number
  /** Its last decoded frame: the one before the next cut, or the clip's last. */
  readonly lastFrame: number
}

/** What a run returns (the node's `json` output). */
export interface ShotCutsResult {
  readonly shotCount: number
  /** Where each new shot starts, seconds from the first frame: ascending, never 0, `[]` for one shot. */
  readonly cutsSec: number[]
  readonly durationSec: number
  readonly shots: Shot[]
}

/**
 * The shots of a clip `durationSec` long whose cuts (seconds from its first
 * frame, each with the frame it starts on) are `cuts` and whose decoded frames
 * number `frameCount`. A cut at 0 or at/after the end starts no shot (the
 * scene-cuts route's filter). Each shot runs from its cut to the next (the
 * first from 0, the last to the end). Pure.
 */
export function planShots(
  cuts: readonly { readonly sec: number; readonly frame: number }[],
  frameCount: number,
  durationSec: number,
): { readonly durationSec: number; readonly cutsSec: number[]; readonly shots: PlannedShot[] } {
  const end = toMs(durationSec)
  const kept = cuts.filter((c) => c.sec > 0 && c.sec < end && c.frame > 0 && (frameCount <= 0 || c.frame < frameCount))
  const starts = [{ sec: 0, frame: 0 }, ...kept]
  const lastFrame = Math.max(0, frameCount - 1)
  const shots = starts.map((s, i): PlannedShot => {
    const next = starts[i + 1]
    const endSec = next ? next.sec : end
    return {
      index: i,
      startSec: s.sec,
      endSec,
      durationSec: toMs(endSec - s.sec),
      firstFrame: s.frame,
      lastFrame: next ? Math.max(s.frame, next.frame - 1) : Math.max(s.frame, lastFrame),
    }
  })
  return { durationSec: end, cutsSec: kept.map((c) => c.sec), shots }
}

/** The refusal for a clip past the 30-minute cap. */
export function shotCutsTooLongMessage(durationSec: number): string {
  return `This video is ${Math.ceil(durationSec)} seconds long; Shot Cuts measures clips up to ${SHOT_CUTS_MAX_DURATION_SEC / 60} minutes — trim it first.`
}

/** The refusal for frames on a clip with more shots than the frame cap. */
export function shotCutsTooManyFramesMessage(shotCount: number): string {
  return `This video has ${shotCount} shots; first and last frames are saved for up to ${SHOT_CUTS_MAX_FRAME_SHOTS} shots. Turn off frames to get the times alone, or trim the video.`
}

/**
 * The liveness budget of one Shot Cuts job — the kill budgets of its bounded
 * steps for the longest clip it takes (`SHOT_CUTS_MAX_DURATION_SEC`, since the
 * payload does not say how long the clip is): the big-media download, the probe,
 * the scoring decode and, with `frames`, the decode that writes the frames and
 * the upload of the most frames a run saves (2 × `SHOT_CUTS_MAX_FRAME_SHOTS`,
 * `SHOT_CUTS_UPLOAD_CONCURRENCY` at a time, `SHOT_CUTS_FRAME_UPLOAD_MS` each).
 * `undefined` when the payload names no video.
 */
export function shotCutsJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const d = data as { videoUrl?: unknown; frames?: unknown }
  if (typeof d.videoUrl !== "string" || d.videoUrl.length === 0) return undefined
  const decode = shotCutsDecodeTimeoutMs(SHOT_CUTS_MAX_DURATION_SEC)
  return DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + decode + (d.frames === true ? decode + shotCutsFrameUploadsMs(SHOT_CUTS_MAX_FRAME_SHOTS) : 0)
}

/** The upload allowance for the first and last frames of `shotCount` shots. */
export function shotCutsFrameUploadsMs(shotCount: number): number {
  return Math.ceil((2 * Math.max(0, shotCount)) / SHOT_CUTS_UPLOAD_CONCURRENCY) * SHOT_CUTS_FRAME_UPLOAD_MS
}
