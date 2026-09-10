/**
 * Hard-cut detection over per-frame difference values.
 *
 * The fixture's contract is not "the picture changes at frame 360" — a slow
 * orbit changes the picture on every frame. It is that the change at the cut is
 * a SPIKE and not a RAMP: camera, target and zoom all move on the cut, and no
 * intermediate frame blends the two shots. A single large difference would be
 * satisfied by a two-frame dissolve, so every check here is written against the
 * neighbours as well as the boundary itself.
 *
 * Pure over an array of numbers, so a synthetic sequence exercises exactly the
 * same code the fixture run does.
 */

export const DEFAULT_CUT_THRESHOLDS = Object.freeze({
  /**
   * Mean absolute per-channel difference (0-255) at which a boundary is a
   * candidate cut at all. Deliberately a floor and not a tuned value: the
   * spike/ramp ratio below is what does the real work.
   */
  minSpike: 12,
  /** The boundary must dominate BOTH neighbours by this factor. */
  spikeRatio: 3,
  /**
   * A blended frame shows up as a neighbour carrying a large share of the
   * boundary's own difference. Above this share the transition is a ramp.
   */
  maxNeighbourShare: 0.34,
})

/**
 * `diffs[i]` is the difference between frame `i-1` and frame `i`, so index `i`
 * names the FIRST frame of the new shot. `diffs[0]` is 0 by construction — the
 * first frame has no predecessor, and inventing one would report a cut at the
 * start of every clip.
 */
export function neighbourValues(diffs, index) {
  const at = diffs[index] ?? 0
  const before = index - 1 >= 0 ? (diffs[index - 1] ?? 0) : 0
  const after = index + 1 < diffs.length ? (diffs[index + 1] ?? 0) : 0
  return { at, before, after }
}

/** Everything one boundary has to say for itself, whether or not it passes. */
export function describeBoundary(diffs, index, thresholds = DEFAULT_CUT_THRESHOLDS) {
  const t = { ...DEFAULT_CUT_THRESHOLDS, ...thresholds }
  const { at, before, after } = neighbourValues(diffs, index)
  const peakNeighbour = Math.max(before, after)
  const spikeRatio = peakNeighbour === 0 ? Infinity : at / peakNeighbour
  const neighbourShare = at === 0 ? Infinity : peakNeighbour / at
  const aboveFloor = at >= t.minSpike
  const dominates = spikeRatio >= t.spikeRatio
  const noBlend = neighbourShare <= t.maxNeighbourShare
  return {
    index,
    diff: at,
    diffBefore: before,
    diffAfter: after,
    spikeRatio: Number.isFinite(spikeRatio) ? spikeRatio : null,
    neighbourShare: Number.isFinite(neighbourShare) ? neighbourShare : null,
    aboveFloor,
    dominates,
    noBlend,
    isHardCut: aboveFloor && dominates && noBlend,
  }
}

/** Every boundary in the sequence that reads as a hard cut. */
export function detectCuts(diffs, thresholds = DEFAULT_CUT_THRESHOLDS) {
  const found = []
  for (let i = 1; i < diffs.length; i++) {
    const boundary = describeBoundary(diffs, i, thresholds)
    if (boundary.isHardCut) found.push(boundary)
  }
  return found
}

/**
 * Check the boundaries the fixture NAMES, and report what was found elsewhere.
 *
 * `tolerance` allows the cut to land a frame either side of the nominal index —
 * a 720-frame timeline built from second-boundaries can round — but the report
 * always carries the exact offset, so a systematic one-frame drift is visible
 * rather than absorbed.
 */
export function checkExpectedCuts(diffs, expected, options = {}) {
  const thresholds = { ...DEFAULT_CUT_THRESHOLDS, ...(options.thresholds ?? {}) }
  const tolerance = options.tolerance ?? 1
  const detected = detectCuts(diffs, thresholds)
  const detectedIndices = detected.map((cut) => cut.index)
  const matched = new Set()
  const results = expected.map((index) => {
    let hit = null
    for (let offset = 0; offset <= tolerance; offset++) {
      for (const candidate of offset === 0 ? [index] : [index - offset, index + offset]) {
        if (hit === null && detectedIndices.includes(candidate)) hit = candidate
      }
    }
    if (hit !== null) matched.add(hit)
    return {
      expectedIndex: index,
      matchedIndex: hit,
      offset: hit === null ? null : hit - index,
      boundary: describeBoundary(diffs, index, thresholds),
      matchedBoundary: hit === null ? null : describeBoundary(diffs, hit, thresholds),
      pass: hit !== null,
    }
  })
  return {
    thresholds,
    tolerance,
    expected: results,
    detectedIndices,
    unexpectedIndices: detectedIndices.filter((index) => !matched.has(index)),
    pass: results.every((r) => r.pass),
  }
}

/**
 * Split a frame count into the fixture's shot windows.
 *
 * Windows are inclusive of `from`, exclusive of `to`, and are derived from the
 * cut indices rather than restated, so a fixture whose cuts move needs one edit
 * and not two lists that can disagree.
 */
export function shotWindows(cutIndices, frameCount) {
  const bounds = [0, ...cutIndices, frameCount]
  const windows = []
  for (let i = 0; i < bounds.length - 1; i++) {
    windows.push({ index: i, from: bounds[i], to: bounds[i + 1] })
  }
  return windows
}
