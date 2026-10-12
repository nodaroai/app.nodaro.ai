/**
 * Where the in-world labels go: never over each other, never over a HUD card.
 * Each label tries spots around its anchor (above, below, beside, and against
 * the edges of whatever is in the way) and takes the free one closest to the
 * anchor. Past `MAX_MOVE` it is hidden instead — except the selected
 * cluster's label, which always shows.
 */

export interface Box {
  readonly l: number
  readonly t: number
  readonly r: number
  readonly b: number
}

export interface LabelIn {
  /** Anchor: the label's bottom centre sits here when nothing is in the way. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly selected: boolean
}

export interface LabelOut {
  readonly left: number
  readonly top: number
  readonly visible: boolean
  /** True when the label is at its anchor, so its stem may point down to the desk. */
  readonly atAnchor: boolean
}

export const MAX_MOVE = 140
const EDGE = 4
const STEP = 18

const overlaps = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t

/** Labels lowest on screen are placed first: they are nearest the camera. */
export function layoutLabels(items: readonly LabelIn[], huds: readonly Box[], vw: number, vh: number): LabelOut[] {
  const order = items.map((_, i) => i).sort((a, b) => items[b]!.y - items[a]!.y)
  const placed: Box[] = []
  const out: LabelOut[] = items.map(() => ({ left: 0, top: 0, visible: false, atAnchor: false }))

  for (const i of order) {
    const it = items[i]!
    const ax = it.x - it.w / 2
    const ay = it.y - it.h
    const box = (l: number, t: number): Box => ({ l, t, r: l + it.w, b: t + it.h })
    const padded = (b: Box): Box => ({ l: b.l - 6, t: b.t - 4, r: b.r + 6, b: b.b + 4 })
    const free = (l: number, t: number) => {
      const c = box(l, t)
      if (c.t < EDGE || c.b > vh - EDGE || c.l < EDGE || c.r > vw - EDGE) return false
      return !huds.some((h) => overlaps(c, h)) && !placed.some((p) => overlaps(c, padded(p)))
    }
    const candidates: Array<[number, number]> = [[ax, ay]]
    for (let k = 1; k <= 8; k++) {
      const d = k * STEP
      candidates.push([ax, ay - d], [ax, ay + d], [ax - d * 1.5, ay], [ax + d * 1.5, ay])
    }
    for (const h of huds) candidates.push([ax, h.b + 4], [ax, h.t - it.h - 4], [h.l - it.w - 4, ay], [h.r + 4, ay])
    for (const p of placed) candidates.push([ax, p.t - it.h - 6], [ax, p.b + 6])

    let best: [number, number] | null = null
    let bestDistance = Infinity
    for (const [cl, ct] of candidates) {
      const l = Math.min(Math.max(cl, 6), vw - it.w - 6)
      if (!free(l, ct)) continue
      const d = Math.hypot(l - ax, ct - ay)
      if (d < bestDistance) {
        bestDistance = d
        best = [l, ct]
      }
    }

    if (best && bestDistance < MAX_MOVE) {
      out[i] = { left: best[0], top: best[1], visible: true, atAnchor: bestDistance < 2 }
      placed.push(box(best[0], best[1]))
    } else if (it.selected) {
      const l = Math.min(Math.max(ax, 6), vw - it.w - 6)
      out[i] = { left: l, top: ay, visible: true, atAnchor: false }
      placed.push(box(l, ay))
    }
  }
  return out
}
