/**
 * Shared blueprint motion helpers — the small set of timing/layout formulas
 * that more than one blueprint component uses. Mirrors the precedent of
 * `./color.ts` (readableTextColor) and `./types.ts` (BlueprintProps): shared
 * blueprint concerns live in small colocated modules.
 *
 * All helpers are pure — safe to unit-test without a render.
 */

/** Quadratic ease-out: fast start, smooth deceleration, no bounce. */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Quadratic ease-in: slow start, accelerating — the mirror of easeOutQuad. */
export function easeInQuad(t: number): number {
  return t * t
}

/**
 * Angle (radians) for item `index` of `count` evenly spaced on a circle,
 * starting at 12 o'clock and proceeding clockwise.
 */
export function ringAngle(index: number, count: number): number {
  return -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, count)
}

/** The spring-pop overshoot curve peaks at this scale before settling to 1. */
export const POP_OVERSHOOT = 1.12

/**
 * Spring-pop entrance curve over normalized progress `e` (0→1): eases out to
 * a gentle POP_OVERSHOOT by 70% of the window, then settles linearly back to
 * a resting scale of 1. Clamped — returns 0 before the window and 1 after.
 */
export function popWithSettle(e: number): number {
  if (e <= 0) return 0
  if (e >= 1) return 1
  if (e < 0.7) {
    return easeOutQuad(e / 0.7) * POP_OVERSHOOT
  }
  return POP_OVERSHOOT - (POP_OVERSHOOT - 1) * ((e - 0.7) / 0.3)
}

/** Ease-in-out (quadratic) — gentle launch and landing. */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2
}

/**
 * Cross-fade/scale swap over normalized progress `e` (0→1): the outgoing image
 * shrinks slightly and fades out while the incoming pulls up from 0.96→1 and
 * fades in. Clamped.
 */
export function scaleSwap(e: number): { outScale: number; outOpacity: number; inScale: number; inOpacity: number } {
  const t = e <= 0 ? 0 : e >= 1 ? 1 : e
  return {
    outScale: 1 - 0.04 * t,
    outOpacity: 1 - t,
    inScale: 0.96 + 0.04 * t,
    inOpacity: t,
  }
}

/**
 * Side-headline swap over `e` (0→1): outgoing slides up (y: 0→-24) and fades;
 * incoming rises from y:24→0 and fades in. Returns pixel y-offsets + opacities.
 */
export function headlineSwap(e: number): { outY: number; outOpacity: number; inY: number; inOpacity: number } {
  const t = e <= 0 ? 0 : e >= 1 ? 1 : e
  return {
    outY: -24 * t,
    outOpacity: 1 - t,
    inY: 24 * (1 - t),
    inOpacity: t,
  }
}

/**
 * Chase camera for a cursor-driven UI demo: over `durationInFrames`, the virtual
 * camera holds on target 0 then eases to each successive `{xPct,yPct}` (percent of
 * the surface), returning the world-container translate (so the target re-centers)
 * plus a gentle push-in scale. Model generalized from `spatial-pan-stations`'
 * `panCamera` (station index → arbitrary targets) with an added scale term.
 */
export function chaseCamera(
  frame: number,
  durationInFrames: number,
  targets: readonly { xPct: number; yPct: number }[],
  width: number,
  height: number,
): { translateX: number; translateY: number; scale: number } {
  if (targets.length === 0) return { translateX: 0, translateY: 0, scale: 1 }
  const n = Math.max(1, targets.length)
  const segLen = durationInFrames / n
  const legIndex = Math.max(0, Math.min(n - 1, Math.floor(frame / segLen)))
  const PAN_FRACTION = 0.6

  let pos: number // fractional target position
  if (legIndex === 0) {
    pos = 0
  } else {
    const t = (frame - legIndex * segLen) / segLen
    pos = t >= PAN_FRACTION ? legIndex : legIndex - 1 + easeInOutQuad(t / PAN_FRACTION)
  }

  const lo = Math.floor(pos)
  const hi = Math.min(n - 1, Math.ceil(pos))
  const frac = pos - lo
  const px = (k: number) => (targets[k].xPct / 100) * width
  const py = (k: number) => (targets[k].yPct / 100) * height
  const camX = px(lo) + (px(hi) - px(lo)) * frac
  const camY = py(lo) + (py(hi) - py(lo)) * frac

  return {
    translateX: width / 2 - camX,
    translateY: height / 2 - camY,
    scale: 1 + 0.06 * (pos / Math.max(1, n - 1)),
  }
}
