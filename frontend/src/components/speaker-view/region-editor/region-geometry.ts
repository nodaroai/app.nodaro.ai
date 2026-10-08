/**
 * The region editor's geometry (U4, SV8 a, SV9 a), pure.
 *
 * A region is a free rectangle on the camera frame, as fractions (D20). The
 * renderer cover-crops it to the slot's aspect around its centre, so the
 * editor draws that crop as a dashed inner box and states the upscale:
 * "608 × 1080 → 1080 × 1920 · 1.8× upscale", amber above 1.5×.
 *
 * MIRRORED, not shared: the canvas sizes (SV7 a), the slot rectangles of each
 * layout and the cover crop are the cloud plugin's (`canvas.ts`,
 * `geometry.ts`, `cover-crop.ts`), which the app cannot import. The plugin is
 * the source of truth: `__tests__/fixtures/plugin-geometry-cases.json` is its
 * generated case grid, `region-geometry-plugin-parity.test.ts` holds this copy
 * to every case, and the plugin's CI fails when that fixture is not what it
 * draws (decided 2026-10-08). A change there must land here.
 *
 * Every seek goes master → source through D19 (`masterMs = sourceMs +
 * offsetMs`): Cam B with `offsetMs` 4000 plays master 12:04 at its own 12:00.
 */
import { SPEAKER_VIEW_MIN_REGION } from "@nodaro/render-rules"

export type SpeakerViewAspect = "16:9" | "9:16" | "1:1" | "4:5"
export interface Size { readonly width: number; readonly height: number }
export interface SlotRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** Fractions of the camera frame (an `EdlRegion`). */
export interface Region { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** Above this the chip turns amber (SV8 a). */
export const UPSCALE_WARN = 1.5
/** "Jump to <speaker>" lands on their first turn longer than this (SV9 a). */
export const JUMP_MIN_TURN_MS = 3000

export const FULL_FRAME: Region = { x: 0, y: 0, w: 1, h: 1 }

const FINAL: Readonly<Record<SpeakerViewAspect, Size>> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
}
const PREVIEW: Readonly<Record<SpeakerViewAspect, Size>> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 720, height: 720 },
  "4:5": { width: 720, height: 900 },
}

/** The canvas a render of this aspect and quality is drawn at (SV7 a). */
export function speakerViewCanvas(aspect: SpeakerViewAspect, quality: "proxy" | "final" = "final"): Size {
  return { ...(quality === "proxy" ? PREVIEW : FINAL)[aspect] }
}

const even = (v: number) => 2 * Math.floor(v / 2)
const PIP_INSET_SCALE = 0.3
const PIP_MARGIN = 0.04
const RATIO: Readonly<Record<SpeakerViewAspect, number>> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 }

function aspectOfCanvas(canvas: Size): SpeakerViewAspect {
  const r = canvas.width / canvas.height
  let best: SpeakerViewAspect = "16:9"
  for (const a of Object.keys(RATIO) as SpeakerViewAspect[]) {
    if (Math.abs(Math.log(r / RATIO[a])) < Math.abs(Math.log(r / RATIO[best]))) best = a
  }
  return best
}

/** Columns × rows of a grid of n (2–6), per aspect. */
const GRID: Readonly<Record<SpeakerViewAspect, ReadonlyArray<readonly [number, number]>>> = {
  "16:9": [[2, 1], [3, 1], [2, 2], [3, 2], [3, 2]],
  "1:1": [[2, 1], [2, 2], [2, 2], [3, 2], [3, 2]],
  "4:5": [[1, 2], [2, 2], [2, 2], [2, 3], [2, 3]],
  "9:16": [[1, 2], [1, 3], [2, 2], [2, 3], [2, 3]],
}

function edges(length: number, parts: number): number[] {
  return Array.from({ length: parts + 1 }, (_, i) => (i === parts ? length : even((i * length) / parts)))
}

function gridRects(canvas: Size, n: number): SlotRect[] {
  const row = GRID[aspectOfCanvas(canvas)][n - 2]
  if (!row) return []
  const [cols, rows] = row
  const xs = edges(canvas.width, cols)
  const ys = edges(canvas.height, rows)
  const rects: SlotRect[] = []
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols)
    const y = ys[r]!
    const h = ys[r + 1]! - y
    if (inRow === cols) {
      for (let c = 0; c < cols; c++) rects.push({ x: xs[c]!, y, w: xs[c + 1]! - xs[c]!, h })
      continue
    }
    const widths = Array.from({ length: inRow }, (_, c) => xs[c + 1]! - xs[c]!)
    let x = even((canvas.width - widths.reduce((a, b) => a + b, 0)) / 2)
    for (const w of widths) {
      rects.push({ x, y, w, h })
      x += w
    }
  }
  return rects
}

/**
 * The rect of each of a segment's `n` slots on `canvas`, in slot order (for
 * pip, slot 0 is the main picture and slot 1 the inset). A layout id or count
 * the renderer does not draw yields no slots.
 */
export function layoutSlotRects(layout: string, canvas: Size, n: number): SlotRect[] {
  const W = canvas.width
  const H = canvas.height
  switch (layout) {
    case "single":
      return n === 1 ? [{ x: 0, y: 0, w: W, h: H }] : []
    case "side-by-side": {
      if (n !== 2) return []
      const mid = even(W / 2)
      return [{ x: 0, y: 0, w: mid, h: H }, { x: mid, y: 0, w: W - mid, h: H }]
    }
    case "stacked": {
      if (n !== 2) return []
      const mid = even(H / 2)
      return [{ x: 0, y: 0, w: W, h: mid }, { x: 0, y: mid, w: W, h: H - mid }]
    }
    case "grid":
      return n >= 2 && n <= 6 ? gridRects(canvas, n) : []
    case "pip": {
      if (n !== 2) return []
      const w = even(W * PIP_INSET_SCALE)
      const h = even(H * PIP_INSET_SCALE)
      const m = even(Math.min(W, H) * PIP_MARGIN)
      return [{ x: 0, y: 0, w: W, h: H }, { x: W - m - w, y: H > W ? m : H - m - h, w, h }]
    }
    default:
      return []
  }
}

/** The cover crop of `region` on a `source`-sized frame for a `slot`-shaped
 *  tile, in source pixels: the largest slot-aspect box inside the region,
 *  centred on its centre and kept inside the frame. */
export function coverCropRect(region: Region, source: Size, slot: Size): SlotRect {
  const rw = region.w * source.width
  const rh = region.h * source.height
  const w = Math.min(rw, (rh * slot.width) / slot.height)
  const h = Math.min(rh, (rw * slot.height) / slot.width)
  const cx = (region.x + region.w / 2) * source.width
  const cy = (region.y + region.h / 2) * source.height
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  return { x: clamp(cx - w / 2, source.width - w), y: clamp(cy - h / 2, source.height - h), w, h }
}

/** How much the renderer enlarges the crop to fill the slot (1 = none). */
export function upscaleOf(crop: SlotRect, slot: Size): number {
  return crop.w > 0 ? slot.width / crop.w : Infinity
}

/** A region in display pixels over a `display`-sized frame, and back. */
export function regionToDisplay(region: Region, display: Size): { x: number; y: number; width: number; height: number } {
  return { x: region.x * display.width, y: region.y * display.height, width: region.w * display.width, height: region.h * display.height }
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/**
 * A region as it is saved: four decimals (the defaults' precision), each side
 * at least the rule's minimum, and inside the frame — so the run never drops
 * it (`speakerViewWireSettings` keeps only such rows).
 */
export function tidyRegion(r: Region): Region {
  const w = Math.min(1, Math.max(SPEAKER_VIEW_MIN_REGION, round4(r.w)))
  const h = Math.min(1, Math.max(SPEAKER_VIEW_MIN_REGION, round4(r.h)))
  const x = Math.max(0, Math.min(1 - w, round4(r.x)))
  const y = Math.max(0, Math.min(1 - h, round4(r.y)))
  return { x: round4(x), y: round4(y), w, h }
}

/** `region` moved by (dx, dy) SOURCE pixels, kept inside the frame (the arrow keys' nudge). */
export function nudgeRegion(region: Region, dxPx: number, dyPx: number, source: Size): Region {
  if (!(source.width > 0) || !(source.height > 0)) return region
  const x = Math.max(0, Math.min(1 - region.w, region.x + dxPx / source.width))
  const y = Math.max(0, Math.min(1 - region.h, region.y + dyPx / source.height))
  return { ...region, x, y }
}

/** D19: the camera's own time for a master instant. */
export function masterToSourceMs(masterMs: number, offsetMs: number | undefined): number {
  return masterMs - (typeof offsetMs === "number" && Number.isFinite(offsetMs) ? offsetMs : 0)
}

export interface Turn { readonly speaker: string; readonly startMs: number; readonly endMs: number }

/**
 * Where "Jump to <speaker>" seeks a camera, in SOURCE ms: the start of the
 * speaker's first turn longer than 3 s that lies wholly inside the camera's
 * coverage — [0, durationMs] of its own clock, the turn mapped from master
 * time through the camera's `offsetMs`. Undefined when no such turn exists
 * (the button is disabled), or while the camera's length is unknown.
 */
export function jumpSeekMs(turns: readonly Turn[], speaker: string, camera: { readonly offsetMs?: number; readonly durationMs?: number }): number | undefined {
  const duration = camera.durationMs
  if (typeof duration !== "number" || !(duration > 0)) return undefined
  for (const t of turns) {
    if (t.speaker !== speaker || t.endMs - t.startMs <= JUMP_MIN_TURN_MS) continue
    const start = masterToSourceMs(t.startMs, camera.offsetMs)
    const end = masterToSourceMs(t.endMs, camera.offsetMs)
    if (start >= 0 && end <= duration) return start
  }
  return undefined
}
