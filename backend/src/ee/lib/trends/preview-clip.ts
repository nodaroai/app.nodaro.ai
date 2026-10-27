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
 * Bump when the cut's arguments change (preview-clip-media.ts): every stored
 * clip is then out of date and remade on the next save or publish.
 */
export const PREVIEW_CLIP_RECIPE = "1"

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
export function previewClipState(data: Pick<TrendVersionData, "source" | "previewStart" | "previewClip" | "faceMask" | "faceMasking">): PreviewClipState {
  if (data.previewStart === null || !data.source) return { kind: "not_offered" }
  const clip = data.previewClip
  if (!clip) return { kind: "missing" }
  if (clip.sourceVideoUrl !== data.source.videoUrl) return { kind: "out_of_date", why: "source" }
  if (clip.startSec !== data.previewStart) return { kind: "out_of_date", why: "start" }
  if (clip.recipe !== PREVIEW_CLIP_RECIPE) return { kind: "out_of_date", why: "recipe" }
  const mask = storedFaceMaskFor(data)
  if (mask && clip.faceMask?.sourceMaskUrl !== mask.url) return { kind: "out_of_date", why: "face_mask" }
  if (!mask && clip.faceMask) return { kind: "out_of_date", why: "face_mask" }
  return { kind: "current", clip }
}

/** The stored clip when it is current, else undefined. */
export function currentPreviewClip(data: Pick<TrendVersionData, "source" | "previewStart" | "previewClip" | "faceMask" | "faceMasking">): TrendPreviewClip | undefined {
  const state = previewClipState(data)
  return state.kind === "current" ? state.clip : undefined
}

/** `data` without its stored preview clip (pure). */
export function withoutPreviewClip<T extends Pick<TrendVersionData, "previewClip">>(data: T): T {
  if (data.previewClip === undefined) return data
  const { previewClip: _dropped, ...rest } = data
  return rest as T
}
