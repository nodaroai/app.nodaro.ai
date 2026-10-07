/**
 * The review minimap (§2.3 of the inspectors design): the whole source on one
 * strip, one column per pixel. Each column takes its DOMINANT state, the one
 * holding most of its time:
 *  - kept: kept time the plan kept too (neutral);
 *  - restored: kept time the plan had cut (hatched);
 *  - cut: dropped time in the edit, coloured by its reason (the reviewer's own
 *    cuts are "manual");
 *  - none: time neither kept nor dropped.
 * Two dropped spans that overlap (a silence inside a tangent) each count their
 * own time for their reason. Pure: the component paints the columns.
 */
import type { Edl } from "@nodaro/shared"
import { intersectIntervals, subtractIntervals, toIntervalSet, type Interval } from "./intervals"
import type { KeptSet } from "./kept-set"

export type MinimapColumn =
  | { readonly state: "none" | "kept" | "restored" }
  | { readonly state: "cut"; readonly reason: string }

export interface MinimapInput {
  readonly base: Edl
  /** The edit as it stands: its dropped spans name the cuts' reasons. */
  readonly edited: Edl
  readonly kept: KeptSet
  /** The strip's length on the master clock, from 0. */
  readonly sourceMs: number
  readonly columns: number
}

const NONE: MinimapColumn = { state: "none" }
const KEPT: MinimapColumn = { state: "kept" }
const RESTORED: MinimapColumn = { state: "restored" }

export function minimapColumns({ base, edited, kept, sourceMs, columns }: MinimapInput): MinimapColumn[] {
  const n = Math.floor(columns)
  if (!(sourceMs > 0) || n <= 0) return []
  const width = sourceMs / n
  // Layer 0 kept, 1 restored, 2.. one per reason.
  const reasons: string[] = []
  const layerOf = (reason: string): number => {
    const i = reasons.indexOf(reason)
    if (i >= 0) return i + 2
    reasons.push(reason)
    return reasons.length + 1
  }
  const add: Array<{ readonly layer: number; readonly span: Interval }> = []
  const restored = intersectIntervals(kept, toIntervalSet(base.dropped ?? []))
  for (const span of subtractIntervals(kept, restored)) add.push({ layer: 0, span })
  for (const span of restored) add.push({ layer: 1, span })
  for (const d of edited.dropped ?? []) add.push({ layer: layerOf(d.reason), span: d })

  const layers = reasons.length + 2
  const time = new Float64Array(n * layers)
  for (const { layer, span } of add) {
    const inMs = Math.max(0, span.inMs)
    const outMs = Math.min(sourceMs, span.outMs)
    if (!(outMs > inMs)) continue
    const last = Math.min(n - 1, Math.floor((outMs - 1e-9) / width))
    for (let c = Math.floor(inMs / width); c <= last; c++) {
      const overlap = Math.min(outMs, (c + 1) * width) - Math.max(inMs, c * width)
      if (overlap > 0) time[c * layers + layer]! += overlap
    }
  }

  const out: MinimapColumn[] = new Array<MinimapColumn>(n)
  for (let c = 0; c < n; c++) {
    let best = -1
    let most = 0
    for (let l = 0; l < layers; l++) {
      const ms = time[c * layers + l]!
      if (ms > most) {
        most = ms
        best = l
      }
    }
    out[c] = best < 0 ? NONE : best === 0 ? KEPT : best === 1 ? RESTORED : { state: "cut", reason: reasons[best - 2]! }
  }
  return out
}

/** The master instant at x position `x` on a strip `width` px wide. */
export function minimapMsAt(x: number, width: number, sourceMs: number): number {
  if (!(width > 0)) return 0
  return Math.min(sourceMs, Math.max(0, (x / width) * sourceMs))
}

/** The last of `rows` (in time order) starting at or before `ms`; 0 before the first, -1 with none. */
export function indexAtMs(rows: readonly { readonly inMs: number }[], ms: number): number {
  let lo = 0
  let hi = rows.length - 1
  let at = rows.length > 0 ? 0 : -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid]!.inMs <= ms) {
      at = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return at
}
