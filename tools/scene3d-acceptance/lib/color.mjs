/**
 * Six-proxy colour segmentation for the Scene3D acceptance fixture.
 *
 * The table fixture gives every seated proxy a contrasting identity colour
 * (red, green, blue, yellow, purple, cyan) against a deliberately neutral grey
 * room, so "who is on screen, and how much of the frame do they occupy" is a
 * hue question rather than a recognition question. That is the ONLY reason
 * these checks can be mechanical at all — remove the identity colours and no
 * pixel measurement here means anything.
 *
 * Pure: takes raw RGB bytes, returns numbers. No I/O, no ffmpeg, no network,
 * so the whole file is unit-testable on synthetic frames.
 */

/** Hue centres of the fixture's six identity colours, in degrees. */
export const PROXY_HUES = Object.freeze({
  red: 0,
  yellow: 60,
  green: 120,
  cyan: 180,
  blue: 240,
  purple: 285,
})

export const PROXY_COLORS = Object.freeze(Object.keys(PROXY_HUES))

/**
 * Segmentation thresholds — ONE object, echoed verbatim into every receipt.
 *
 * `maxHueDistance` is deliberately below half the smallest gap between two
 * centres (blue 240 → purple 285 is 45°), so a pixel can never be "nearest" to
 * one identity while plausibly belonging to its neighbour. `minSaturation` and
 * `minValue` are what drop the neutral grey floor, wall and table, and the
 * black of a shadow, rather than letting them smear into whichever hue their
 * noise happens to lean towards.
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  minSaturation: 0.35,
  minValue: 0.2,
  maxHueDistance: 22,
  /** Neutral (table/floor/wall) mass: low saturation, not crushed to black. */
  greyMaxSaturation: 0.18,
  greyMinValue: 0.15,
  /** Fraction of frame height, measured from the bottom, treated as foreground. */
  foregroundBandFraction: 0.4,
})

/** RGB (0-255) → HSV with h in degrees 0-360, s and v in 0-1. */
export function rgbToHsv(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  if (delta > 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
    else h = 60 * ((rn - gn) / delta + 4)
  }
  if (h < 0) h += 360
  const s = max === 0 ? 0 : delta / max
  return { h, s, v: max }
}

/** Shortest distance between two hues on the colour wheel, in degrees. */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Which identity colour a pixel belongs to, or `null`.
 *
 * Nearest-centre with a hard distance ceiling: a pixel that is not clearly one
 * of the six is not silently attributed to the closest one.
 */
export function classifyPixel(r, g, b, thresholds = DEFAULT_THRESHOLDS) {
  const { h, s, v } = rgbToHsv(r, g, b)
  if (s < thresholds.minSaturation || v < thresholds.minValue) return null
  let best = null
  let bestDistance = Infinity
  for (const name of PROXY_COLORS) {
    const distance = hueDistance(h, PROXY_HUES[name])
    if (distance < bestDistance) {
      bestDistance = distance
      best = name
    }
  }
  return bestDistance <= thresholds.maxHueDistance ? best : null
}

function emptyAccumulator() {
  const acc = {}
  for (const name of PROXY_COLORS) {
    acc[name] = { count: 0, bandCount: 0, sumX: 0, sumY: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  }
  return acc
}

/**
 * Segment ONE raw rgb24 frame.
 *
 * Returns per-colour projected area (as a fraction of the frame), the
 * foreground-band occupancy (bottom `foregroundBandFraction` of the image, the
 * part an over-the-shoulder mass actually lives in), the centroid used for the
 * motion heuristic, and the neutral-grey centroid that stands in for the room
 * and table.
 */
export function segmentFrame(rgb, width, height, thresholds = DEFAULT_THRESHOLDS) {
  const total = width * height
  const acc = emptyAccumulator()
  const bandStartY = Math.floor(height * (1 - thresholds.foregroundBandFraction))
  const bandPixels = Math.max(1, (height - bandStartY) * width)
  let greyCount = 0
  let greySumX = 0
  let greySumY = 0

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 3
    for (let x = 0; x < width; x++) {
      const i = rowOffset + x * 3
      const r = rgb[i]
      const g = rgb[i + 1]
      const b = rgb[i + 2]
      const name = classifyPixel(r, g, b, thresholds)
      if (name === null) {
        const { s, v } = rgbToHsv(r, g, b)
        if (s <= thresholds.greyMaxSaturation && v >= thresholds.greyMinValue) {
          greyCount++
          greySumX += x
          greySumY += y
        }
        continue
      }
      const slot = acc[name]
      slot.count++
      slot.sumX += x
      slot.sumY += y
      if (x < slot.minX) slot.minX = x
      if (y < slot.minY) slot.minY = y
      if (x > slot.maxX) slot.maxX = x
      if (y > slot.maxY) slot.maxY = y
      if (y >= bandStartY) slot.bandCount++
    }
  }

  const colors = {}
  for (const name of PROXY_COLORS) {
    const slot = acc[name]
    colors[name] = {
      pixels: slot.count,
      area: slot.count / total,
      foregroundArea: slot.bandCount / bandPixels,
      centroid: slot.count > 0 ? { x: slot.sumX / slot.count, y: slot.sumY / slot.count } : null,
      bbox: slot.count > 0 ? { x0: slot.minX, y0: slot.minY, x1: slot.maxX, y1: slot.maxY } : null,
    }
  }
  return {
    width,
    height,
    total,
    bandStartY,
    colors,
    grey: {
      pixels: greyCount,
      area: greyCount / total,
      centroid: greyCount > 0 ? { x: greySumX / greyCount, y: greySumY / greyCount } : null,
    },
  }
}

/**
 * The pilot's red-body measurement, kept BYTE-FOR-BYTE as the earlier A/B ran
 * it rather than re-derived from the HSV segmenter above.
 *
 * The two measurements answer different questions and must not be merged: this
 * one is a same-method comparison against a previously published number, and
 * changing its arithmetic would silently invalidate that comparison.
 */
export const PILOT_RED_THRESHOLDS = Object.freeze({
  minRed: 20,
  greenRatio: 1.5,
  blueRatio: 1.5,
  minSeparation: 12,
  /** Fewer than this many red pixels in the window is an absence candidate. */
  absencePixels: 4,
})

/** Count pilot-method red pixels inside a central column of the frame. */
export function countPilotRed(rgb, width, height, options = {}) {
  const t = { ...PILOT_RED_THRESHOLDS, ...(options.thresholds ?? {}) }
  const centralFraction = options.centralFraction ?? 1
  const halfSpan = Math.max(1, Math.floor((width * centralFraction) / 2))
  const centreX = Math.floor(width / 2)
  const x0 = Math.max(0, centreX - halfSpan)
  const x1 = Math.min(width - 1, centreX + halfSpan)
  let count = 0
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 3
    for (let x = x0; x <= x1; x++) {
      const i = rowOffset + x * 3
      const r = rgb[i]
      const g = rgb[i + 1]
      const b = rgb[i + 2]
      if (r > t.minRed && r > t.greenRatio * g && r > t.blueRatio * b && r - Math.min(g, b) > t.minSeparation) count++
    }
  }
  return count
}

/**
 * The longest run of frames whose pilot-red count is below the absence floor.
 *
 * Reported as a window in seconds so it lines up with the earlier pilot's
 * published intervals. Supporting evidence only — the pilot's own note that
 * thresholding cannot tell occlusion from leaving frame still stands.
 */
export function longestAbsenceWindow(counts, fps, absencePixels = PILOT_RED_THRESHOLDS.absencePixels) {
  let bestStart = -1
  let bestLength = 0
  let start = -1
  for (let i = 0; i <= counts.length; i++) {
    const absent = i < counts.length && counts[i] < absencePixels
    if (absent && start === -1) start = i
    if (!absent && start !== -1) {
      const length = i - start
      if (length > bestLength) {
        bestLength = length
        bestStart = start
      }
      start = -1
    }
  }
  if (bestLength === 0) return null
  return {
    startFrame: bestStart,
    endFrame: bestStart + bestLength - 1,
    frames: bestLength,
    startSeconds: bestStart / fps,
    endSeconds: (bestStart + bestLength) / fps,
  }
}
