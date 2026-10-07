/**
 * The preview's clock (R3, decided 2026-10-06): output time on the take ↔
 * master time on the transcript, built on the shared clocks (A3-1:
 * `remapMsThroughEdl` and its inverse `outputMsToMasterMs`).
 *
 * The map is the effective EDL the render builds (`buildEffectiveEdl`, with
 * its crossfade and Sources media) from the EDL on its wire now. It is exact
 * only for a FRESH take (staleness.ts); for any other the inspector holds no
 * map (`null`), and a click on a word plays the original instead (R3 a).
 */
import { buildEffectiveEdl } from "@nodaro/render-rules"
import { normalizeEdl, outputMsToMasterMs, remapMsThroughEdl, type Edl } from "@nodaro/shared"
import type { ReviewRenderContext } from "./restore"
import type { TimedUnit } from "./kept-set"

/** The clock map of the EDL `edl` (a wired string or an object), or null. */
export function clockMapOf(edl: unknown, render: ReviewRenderContext): Edl | null {
  if (edl === undefined || edl === null || edl === "") return null
  try {
    const raw = typeof edl === "string" ? JSON.parse(edl) : edl
    return buildEffectiveEdl(normalizeEdl(raw), { crossfadeMs: render.crossfadeMs, sourceOverrides: render.sources })
  } catch {
    return null
  }
}

/** Where the take plays master instant `masterMs`; null when it was cut. */
export function previewTimeOfMaster(clockMap: Edl | null, masterMs: number): number | null {
  return clockMap ? remapMsThroughEdl(clockMap, masterMs) : null
}

/** The master instant the take plays at `outputMs`; null outside it. */
export function masterOfPreviewTime(clockMap: Edl | null, outputMs: number): number | null {
  return clockMap ? outputMsToMasterMs(clockMap, outputMs) : null
}

/** Where a click on a word seeks the take: the word's first kept instant (a
 *  word whose start was cut plays from where it is kept). Null when none of it
 *  is kept. `offsetMs` puts the transcript's clock on the master clock. */
export function previewSeekOfWord(clockMap: Edl | null, word: TimedUnit, offsetMs = 0): number | null {
  if (!clockMap) return null
  const s = word.startMs + offsetMs
  const e = Math.max(s, word.endMs + offsetMs)
  const atStart = remapMsThroughEdl(clockMap, s)
  if (atStart !== null) return atStart
  let first: number | null = null
  for (const seg of clockMap.segments) {
    if (seg.outMs > s && seg.inMs < e && (first === null || seg.inMs < first)) first = seg.inMs
  }
  return first === null ? null : remapMsThroughEdl(clockMap, first)
}
