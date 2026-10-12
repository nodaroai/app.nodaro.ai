/**
 * Speaker View's default framing boxes (D20, "Default regions"), and whether a
 * saved box is one (P3-4 rung 2: a default never labels a track). Pure, and
 * its own module so the wire (which re-exports `defaultSpeakerRegions`) and the
 * face-track rules read one definition.
 */
import { EDL_TARGET_ASPECTS, type EdlRegion } from "@nodaro/shared"

/**
 * D20 defaults for the k-th of n speakers sharing ONE camera (SV: "Default
 * regions"): full height, the slot aspect's width, centred at (2k+1)/2n of the
 * frame width — "left and right thirds" for two speakers at 9:16. A camera
 * with a single speaker needs no box (full frame), so it yields none.
 * `slotAspect` and `sourceAspect` are width / height.
 */
export function defaultSpeakerRegions(
  speakers: readonly string[],
  slotAspect: number,
  sourceAspect: number,
): Array<{ speaker: string; region: { x: number; y: number; w: number; h: number } }> {
  const n = speakers.length
  if (n < 2 || !(slotAspect > 0) || !(sourceAspect > 0)) return []
  const w = Math.min(1, slotAspect / sourceAspect)
  const round = (v: number) => Math.round(v * 1e4) / 1e4
  return speakers.map((speaker, k) => {
    const centre = (2 * k + 1) / (2 * n)
    const x = Math.min(1 - w, Math.max(0, centre - w / 2))
    return { speaker, region: { x: round(x), y: 0, w: round(w), h: 1 } }
  })
}

/** Every canvas a Speaker View draws, as width / height. */
const CANVAS_ASPECTS: readonly number[] = EDL_TARGET_ASPECTS.map((a) => {
  const [w, h] = a.split(":").map(Number)
  return w! / h!
}).filter((r) => r > 0 && Number.isFinite(r))

/**
 * How far a saved default's WIDTH may sit from the one recomputed here: the
 * editor computed it from the camera's own frame, while the frame known here
 * is the face tracks', i.e. the detection proxy's (even-rounded pixels), so an
 * odd aspect drifts by about 1e-3. Only the width: a default's position follows
 * from its width (centred on its speaker's share of the frame), so the saved
 * box must sit exactly there for the width it has (`centredFor`) — a box the
 * person nudged or resized by a camera pixel is set, not a default.
 */
const DEFAULT_WIDTH_TOLERANCE = 2e-3

/** One step of the editor's saved precision (four decimals; `tidyRegion`). */
const SAVED_STEP = 1e-4
const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/**
 * Whether `x` is exactly where the default places a box of width `w` centred
 * at `centre` (clamped into the frame, then saved at four decimals). The width
 * was itself saved rounded, so the unrounded width the editor placed the box
 * with lies within half a step of `w`; `x` must be one of the saved positions
 * that range gives (the placement is monotone in the width).
 */
function centredFor(x: number, w: number, centre: number): boolean {
  const place = (width: number) => round4(Math.min(1 - width, Math.max(0, centre - width / 2)))
  const a = place(w - SAVED_STEP / 2)
  const b = place(w + SAVED_STEP / 2)
  const eps = 1e-9
  return x >= Math.min(a, b) - eps && x <= Math.max(a, b) + eps
}

/**
 * Whether `region`, the k-th of n saved boxes on one camera, is exactly the
 * default box (decided 2026-10-10: for older rows and API- or MCP-written rows,
 * a box exactly equal to the default thirds counts as a default). The camera's
 * aspect is `frameAspect`; the canvas may be any Speaker View canvas. Full
 * height, at the top, centred on the k-th of n shares of the frame for its own
 * width; only the width may differ from the recomputed default, by the proxy
 * frame's rounding (`DEFAULT_WIDTH_TOLERANCE`).
 */
export function isDefaultSpeakerRegion(region: EdlRegion, k: number, n: number, frameAspect: number): boolean {
  if (n < 2 || k < 0 || k >= n || !(frameAspect > 0) || region.y !== 0 || region.h !== 1) return false
  if (!centredFor(region.x, region.w, (2 * k + 1) / (2 * n))) return false
  return CANVAS_ASPECTS.some((canvas) => {
    const def = defaultSpeakerRegions(Array.from({ length: n }, (_, i) => String(i)), canvas, frameAspect)[k]?.region
    return !!def && Math.abs(region.w - def.w) <= DEFAULT_WIDTH_TOLERANCE
  })
}
