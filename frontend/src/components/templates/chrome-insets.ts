/**
 * The canvas preview floats its chrome — the top bar, the results rail, the
 * Clone panel — over the canvas. Framed edge to edge, a flow's outputs sat under
 * the Clone panel and its lower lanes under the rail on the first frame
 * (2026-09-24). These insets are how far that chrome reaches in from each side,
 * so the first frame fits the flow into the ground it leaves free.
 */

import type { FitViewOptions } from "@xyflow/react"

/** Room, in px, to keep free on each side of the canvas when framing the flow. */
export interface Insets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** A viewport rectangle in px — the shape of `getBoundingClientRect()`. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

type Side = keyof Insets

/** Room kept on a side no chrome touches. */
const BASE = 40
/** Air between the flow and a piece of chrome. */
const MARGIN = 24
/** Below this share of the canvas left free, chrome insets would shrink the flow to nothing. */
const MIN_FREE_SHARE = 0.4

const uniform = (value: number): Insets => ({ top: value, right: value, bottom: value, left: value })

/**
 * A piece of chrome is charged to the ONE side it reaches in least from: the
 * rail in the bottom corner is a strip along the bottom, not a column down the
 * left. Hidden chrome (no size) and chrome outside the canvas cost nothing.
 */
function reach(canvas: Box, box: Box): readonly [Side, number] | null {
  if (box.right - box.left <= 0 || box.bottom - box.top <= 0) return null
  const depths: ReadonlyArray<readonly [Side, number]> = [
    ["top", box.bottom - canvas.top],
    ["right", canvas.right - box.left],
    ["bottom", canvas.bottom - box.top],
    ["left", box.right - canvas.left],
  ]
  const nearest = depths.reduce((best, next) => (next[1] < best[1] ? next : best))
  return nearest[1] > 0 ? nearest : null
}

/**
 * How far the given chrome reaches into the canvas from each side, plus air —
 * or a plain margin all round when honouring it would leave too little canvas.
 */
export function chromeInsets(canvas: Box, chrome: readonly Box[]): Insets {
  const insets = chrome.reduce<Insets>((acc, box) => {
    const hit = reach(canvas, box)
    if (hit === null) return acc
    const [side, depth] = hit
    return { ...acc, [side]: Math.max(acc[side], depth + MARGIN) }
  }, uniform(BASE))
  const freeWidth = canvas.right - canvas.left - insets.left - insets.right
  const freeHeight = canvas.bottom - canvas.top - insets.top - insets.bottom
  const tooTight =
    freeWidth < (canvas.right - canvas.left) * MIN_FREE_SHARE ||
    freeHeight < (canvas.bottom - canvas.top) * MIN_FREE_SHARE
  return tooTight ? uniform(BASE) : insets
}

/** React Flow `fitView` padding: 10% all round, or exactly the insets, in px. */
export function fitViewPadding(insets: Insets | undefined): FitViewOptions["padding"] {
  if (insets === undefined) return 0.1
  const { top, right, bottom, left } = insets
  return { top: `${top}px`, right: `${right}px`, bottom: `${bottom}px`, left: `${left}px` }
}
