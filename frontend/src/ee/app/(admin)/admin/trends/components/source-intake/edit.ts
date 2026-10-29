// The new source clip's range and crop, as plain data: what the intake opens
// on, whether the admin changed anything, and the cut the platform makes of it
// (`POST /v1/media/process`). Pure; the screens are SourceIntake / ClipEditStep.

import type { MediaProcessParams } from "@/lib/api"
import type { MediaEditorParts, RatioId, Rect, Size } from "virtual:media-editor"

/** The source's length the server takes when it stores it (`TREND_SOURCE_SECONDS`). */
export const SOURCE_SECONDS = { min: 4, max: 30 } as const

/**
 * The longest cut asked for: the platform's re-encode comes out a few ms
 * longer than asked, and a 30.02 s file would be refused by the store.
 */
export const CUT_MAX_SEC = SOURCE_SECONDS.max - 0.1

/** The shapes a source can be cropped to; Original keeps the whole frame. */
export const SOURCE_RATIOS = ["original", "9:16", "16:9", "1:1", "4:3", "3:4"] as const satisfies readonly RatioId[]
export type SourceRatio = (typeof SOURCE_RATIOS)[number]

export const isSourceRatio = (id: RatioId): id is SourceRatio => (SOURCE_RATIOS as readonly string[]).includes(id)

/** A range of the clip in seconds, and its crop in natural pixels (null: the whole frame). */
export interface SourceEdit {
  readonly startSec: number
  readonly endSec: number
  readonly ratio: SourceRatio
  readonly crop: Rect | null
}

/** A whole number of tenths: the strip's step, and what is sent. */
export const tenth = (n: number): number => Math.round(n * 10) / 10

/** What a clip opens on: the whole clip, or its first 30 s; no crop. */
export function initialEdit(sec: number): SourceEdit {
  return { startSec: 0, endSec: tenth(Math.min(sec, SOURCE_SECONDS.max)), ratio: "original", crop: null }
}

/** True when the edit keeps the whole clip uncropped. */
export function isNoEdit(edit: SourceEdit, sec: number): boolean {
  return edit.crop === null && edit.startSec <= 0.05 && edit.endSec >= sec - 0.05
}

/** True when the range is a length the store takes (4–30 s). */
export function rangeFits(edit: SourceEdit): boolean {
  const len = edit.endSec - edit.startSec
  return len >= SOURCE_SECONDS.min - 0.05 && len <= SOURCE_SECONDS.max + 0.05
}

/**
 * A crop the encoder takes: whole, even pixels inside the frame. Null for no
 * crop, or one that is the whole frame.
 */
export function evenCrop(crop: Rect | null, natural: Size): Rect | null {
  if (crop === null) return null
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
  const width = Math.min(even(crop.width), even(natural.width))
  const height = Math.min(even(crop.height), even(natural.height))
  const x = Math.min(Math.max(0, Math.round(crop.x)), natural.width - width)
  const y = Math.min(Math.max(0, Math.round(crop.y)), natural.height - height)
  if (x === 0 && y === 0 && width >= even(natural.width) && height >= even(natural.height)) return null
  return { x, y, width, height }
}

/** The crop a shape starts on: the largest centred box of it, or none for Original. */
export function cropFor(ratio: SourceRatio, natural: Size, fullRect: MediaEditorParts["fullRect"]): Rect | null {
  return ratio === "original" ? null : evenCrop(fullRect(natural, ratio), natural)
}

/**
 * The cut to ask the platform for, or null when the clip is stored as it is
 * (the whole clip, uncropped, and no longer than the store takes). The range
 * is sent whenever it is not the whole clip or the clip runs past the cap, so
 * the cut never comes out over 30 s.
 */
export function cutRequest(sourceUrl: string, edit: SourceEdit, sec: number): MediaProcessParams | null {
  const whole = edit.startSec <= 0.05 && edit.endSec >= sec - 0.05
  if (edit.crop === null && whole && sec <= SOURCE_SECONDS.max) return null
  const trimmed = !whole || sec > CUT_MAX_SEC
  const startSec = tenth(edit.startSec)
  const endSec = tenth(Math.min(edit.endSec, startSec + CUT_MAX_SEC))
  return {
    sourceUrl,
    type: "video",
    ...(trimmed ? { trim: { startTime: startSec, endTime: endSec } } : {}),
    ...(edit.crop ? { crop: { ...edit.crop } } : {}),
  }
}
