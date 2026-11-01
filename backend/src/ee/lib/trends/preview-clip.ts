/**
 * The preview's input clip (`TrendVersionData.previewClip`): the pure rules.
 * What it IS and how it is pinned to the source are documented on
 * `TrendPreviewClip` (types.ts); making it (ffmpeg + storage) lives in
 * preview-clip-media.ts, and when it is made in the admin routes.
 *
 * Why a stored clip rather than a cut per run: a run of a published version
 * must edit the same bytes every time, and the admin must be able to see
 * those bytes. The window itself is fixed by `previewStart` and
 * `PREVIEW_SECONDS` (schemas.ts), so the clip is a deterministic derivative
 * of the source — regenerated, never edited.
 */
import type { TrendPreviewClip, TrendVersionData } from "./types.js"
import { PREVIEW_SECONDS } from "./schemas.js"
import { storedFaceMaskFor } from "./face-mask.js"

/**
 * The recipe every new cut is made with (preview-clip-media.ts). Bump it when
 * the cut's arguments change; a stored clip stays current only while its
 * recipe is in `CURRENT_PREVIEW_CLIP_RECIPES`.
 *   "1" — cut by TIME (`-ss` before `-i`, `-t`, both to the millisecond).
 *   "2" — cut by FRAME INDEX (`previewClipFrames`): the same frames of the
 *         source and of its face mask whatever their timestamps say.
 */
export const PREVIEW_CLIP_RECIPE = "2"

/**
 * The recipes whose stored clips are still current. "1" stays: a clip cut by
 * time was stored only after its mask cut passed the equal-frame-count check,
 * so it is a valid input as it is; only a NEW cut uses "2". Keeping it means a
 * published version keeps editing the bytes it was published with.
 */
export const CURRENT_PREVIEW_CLIP_RECIPES: readonly string[] = ["1", PREVIEW_CLIP_RECIPE]

/**
 * Real footage kept after the 4 s window, when the source has it. An engine
 * grows the window onto its own frame grid (a few frames past 4 s) and pads
 * the picture when the clip ends first; a second of real footage lets it
 * grow without padding. Never more: the clip is the preview's input, not a
 * longer trend.
 */
export const PREVIEW_CLIP_TAIL_SECONDS = 1

/** The clip's intended length (s): the window plus the tail, within the source. */
export function previewClipDurationSec(sourceDurationSec: number, startSec: number): number {
  const left = Math.max(0, sourceDurationSec - startSec)
  return Math.min(left, PREVIEW_SECONDS + PREVIEW_CLIP_TAIL_SECONDS)
}

/** Which frames of the source the preview clip is: `frameCount` frames from frame `startFrame` (0-based). */
export interface PreviewClipFrames {
  startFrame: number
  frameCount: number
}

/**
 * The preview clip's frames, by INDEX, for a source of `sourceFrames` frames
 * at `fps`: the frame nearest `startSec` (`round(startSec × fps)`), then
 * `round(durationSec × fps)` frames, never past the source's last frame.
 * Null when that leaves no frame (or a number is unusable).
 *
 * Why by index: the source and its face mask align frame for frame (asserted
 * at approval), but not always timestamp for timestamp — the mask is another
 * encoder's file, in another time base (a millisecond one rounds 7/24 s to
 * 0.292 s). A cut by time then lands on different frames of the two at a
 * window edge (a start at 7/24 s, sent as "0.292", drops frame 7 of the
 * source and keeps frame 7 of the mask: 119 frames against 120). Cut by index,
 * both files give the same frames.
 */
export function previewClipFrames(startSec: number, durationSec: number, fps: number, sourceFrames: number): PreviewClipFrames | null {
  if (![startSec, durationSec, fps, sourceFrames].every(Number.isFinite) || startSec < 0 || durationSec <= 0 || fps <= 0 || sourceFrames < 1) return null
  const startFrame = Math.round(startSec * fps)
  const frameCount = Math.min(Math.round(durationSec * fps), Math.floor(sourceFrames) - startFrame)
  return frameCount >= 1 ? { startFrame, frameCount } : null
}

export type PreviewClipState =
  /** The draft offers no preview (`previewStart` null) — a stored clip, if any, is dropped on save. */
  | { kind: "not_offered" }
  /** A preview is offered and no clip is stored yet. */
  | { kind: "missing" }
  /** Stored, but not what the draft would cut now. */
  | { kind: "out_of_date"; why: "source" | "start" | "recipe" | "face_mask" }
  | { kind: "current"; clip: TrendPreviewClip }

/**
 * Whether the stored preview clip matches the draft: cut from this source,
 * at this `previewStart`, with the current recipe, and — when the trend has
 * a current stored face mask — carrying that mask's cut too (so a preview
 * run can send it; a clip made before the mask was approved, or from an
 * earlier mask, is out of date even though its picture is right).
 */
export function previewClipState(data: Pick<TrendVersionData, "source" | "previewStart" | "previewClip" | "faceMask" | "faceMasking" | "slots">): PreviewClipState {
  if (data.previewStart === null || !data.source) return { kind: "not_offered" }
  const clip = data.previewClip
  if (!clip) return { kind: "missing" }
  if (clip.sourceVideoUrl !== data.source.videoUrl) return { kind: "out_of_date", why: "source" }
  if (clip.startSec !== data.previewStart) return { kind: "out_of_date", why: "start" }
  if (!CURRENT_PREVIEW_CLIP_RECIPES.includes(clip.recipe)) return { kind: "out_of_date", why: "recipe" }
  const mask = storedFaceMaskFor(data)
  if (mask && clip.faceMask?.sourceMaskUrl !== mask.url) return { kind: "out_of_date", why: "face_mask" }
  if (!mask && clip.faceMask) return { kind: "out_of_date", why: "face_mask" }
  return { kind: "current", clip }
}

/** The stored clip when it is current, else undefined. */
export function currentPreviewClip(data: Pick<TrendVersionData, "source" | "previewStart" | "previewClip" | "faceMask" | "faceMasking" | "slots">): TrendPreviewClip | undefined {
  const state = previewClipState(data)
  return state.kind === "current" ? state.clip : undefined
}

/** `data` without its stored preview clip (pure). */
export function withoutPreviewClip<T extends Pick<TrendVersionData, "previewClip">>(data: T): T {
  if (data.previewClip === undefined) return data
  const { previewClip: _dropped, ...rest } = data
  return rest as T
}
