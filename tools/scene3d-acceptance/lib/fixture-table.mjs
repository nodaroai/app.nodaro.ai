/**
 * The table fixture's contract, as data and as arithmetic.
 *
 * Section 6A of the acceptance spec is a list of claims about WHO is on screen
 * in WHICH frames. This module turns per-frame segmentation into a verdict on
 * exactly those claims and nothing else — no aggregate "quality score", which
 * would be a number nobody could act on.
 *
 * Three deliberate choices:
 *
 * ONE — a window check passes on a FRACTION of its frames, not on all of them.
 * The spec says visibility is "tested across the transition, not only
 * endpoints"; requiring literally every frame would fail the fixture on a
 * single frame where a head crosses the subject, which is a thing the shot is
 * allowed to do. The fraction and the floors are all recorded, so a reader can
 * re-judge at a different tolerance without re-rendering.
 *
 * TWO — "present" means a MINIMUM PROJECTED AREA, never a non-zero pixel
 * count. The spec is explicit: do not accept a tiny unblocked dot as a face.
 *
 * THREE — nothing here is tuned to make a particular render pass. The floors
 * are properties of the fixture's own geometry (a seated proxy at that camera
 * distance covers on the order of a thousandth of the frame) and are exposed
 * as options precisely so freezing them against reviewed frames — which the
 * spec asks for — is an edit to a receipt input, not to this file.
 */
import { checkExpectedCuts } from "./cuts.mjs"

/** The three cut boundaries the prompt names, as FIRST frames of a new shot. */
export const TABLE_CUTS = Object.freeze([360, 432, 492])
export const TABLE_FRAME_COUNT = 720
export const TABLE_FPS = 24
export const TABLE_DIMENSIONS = Object.freeze({ width: 1680, height: 720 })

export const DEFAULT_FIXTURE_THRESHOLDS = Object.freeze({
  /** Smallest projected area (fraction of frame) that counts as "visible". */
  minSubjectArea: 0.0015,
  /** Smallest foreground-band occupancy that counts as an over-the-shoulder mass. */
  minShoulderForeground: 0.02,
  /** Fraction of a window's frames that must satisfy the window's checks. */
  windowFrameFraction: 0.9,
  /** Frames at the end of shot 4 in which cyan must be clear. */
  endWindowFrames: 24,
  /** Frames a detected cut may sit away from its nominal index. */
  cutTolerance: 1,
})

/**
 * The four shots, derived from the cut list rather than restated.
 *
 * `subject` is who the shot is ABOUT (checked by projected area), `shoulder`
 * is who is deliberately in front of the lens (checked in the foreground
 * band), and `passes` are the orbit's two named fly-behinds.
 */
export function tableShots(cuts = TABLE_CUTS, frameCount = TABLE_FRAME_COUNT) {
  const [cut1, cut2, cut3] = cuts
  return [
    {
      index: 0, from: 0, to: cut1, label: "slow orbit, target yellow → blue → green",
      subject: null, shoulder: null,
      passes: [
        { color: "red", from: 0, to: Math.round(cut1 * 0.25), what: "camera passes behind red near the start" },
        { color: "cyan", from: Math.round(cut1 * 0.33), to: Math.round(cut1 * 0.67), what: "camera passes behind cyan in the middle" },
      ],
    },
    { index: 1, from: cut1, to: cut2, label: "cyan over blue's shoulder", subject: "cyan", shoulder: "blue", passes: [] },
    { index: 2, from: cut2, to: cut3, label: "red over yellow's shoulder", subject: "red", shoulder: "yellow", passes: [] },
    {
      index: 3, from: cut3, to: frameCount, label: "purple → cyan over green's shoulder",
      subject: null, shoulder: "green", passes: [],
      gaze: { from: "purple", to: "cyan", midpoint: Math.round((cut3 + frameCount) / 2) },
    },
  ]
}

/** Per-frame statistics for one colour over one frame range. */
export function rangeStats(segments, from, to, colour, key, floor) {
  const values = []
  for (let i = Math.max(0, from); i < Math.min(segments.length, to); i++) {
    const stats = segments[i]?.colors?.[colour]
    values.push(key === "foregroundArea" ? (stats?.foregroundArea ?? 0) : (stats?.area ?? 0))
  }
  const satisfying = values.filter((v) => v >= floor).length
  const sum = values.reduce((a, b) => a + b, 0)
  return {
    colour,
    key,
    from,
    to,
    floor,
    frames: values.length,
    framesAtOrAboveFloor: satisfying,
    fraction: values.length === 0 ? 0 : satisfying / values.length,
    min: values.length === 0 ? null : Math.min(...values),
    max: values.length === 0 ? null : Math.max(...values),
    mean: values.length === 0 ? null : sum / values.length,
  }
}

/**
 * Judge the whole fixture.
 *
 * `segments[i]` is `segmentFrame`'s output for frame `i`; `diffs[i]` is the
 * mean absolute difference between frames `i-1` and `i`.
 */
export function evaluateTableFixture({ segments, diffs, fps = TABLE_FPS, cuts = TABLE_CUTS, thresholds = {} }) {
  const t = { ...DEFAULT_FIXTURE_THRESHOLDS, ...thresholds }
  const frameCount = segments.length
  const shots = tableShots(cuts, frameCount)
  const cutReport = checkExpectedCuts(diffs, cuts, { tolerance: t.cutTolerance })

  const windows = shots.map((shot) => {
    const checks = []
    if (shot.subject) {
      const stats = rangeStats(segments, shot.from, shot.to, shot.subject, "area", t.minSubjectArea)
      checks.push({ what: `${shot.subject} is visible at a useful size`, stats, pass: stats.fraction >= t.windowFrameFraction })
    }
    if (shot.shoulder) {
      const stats = rangeStats(segments, shot.from, shot.to, shot.shoulder, "foregroundArea", t.minShoulderForeground)
      checks.push({ what: `${shot.shoulder} holds the foreground`, stats, pass: stats.fraction >= t.windowFrameFraction })
    }
    for (const pass of shot.passes ?? []) {
      const stats = rangeStats(segments, pass.from, pass.to, pass.color, "foregroundArea", t.minShoulderForeground)
      checks.push({ what: pass.what, stats, pass: stats.max !== null && stats.max >= t.minShoulderForeground })
    }
    if (shot.gaze) {
      const before = rangeStats(segments, shot.from, shot.gaze.midpoint, shot.gaze.from, "area", t.minSubjectArea)
      const endFrom = Math.max(shot.from, shot.to - t.endWindowFrames)
      const after = rangeStats(segments, endFrom, shot.to, shot.gaze.to, "area", t.minSubjectArea)
      checks.push({ what: `${shot.gaze.from} carries the first half of the shot`, stats: before, pass: before.fraction >= 0.5 })
      checks.push({ what: `${shot.gaze.to} is clear at the end`, stats: after, pass: after.fraction >= t.windowFrameFraction })
    }
    return { ...shot, checks, pass: checks.every((c) => c.pass) }
  })

  return {
    thresholds: t,
    frameCount,
    fps,
    cuts: cutReport,
    windows,
    pass: cutReport.pass && windows.every((w) => w.pass),
  }
}

/**
 * Camera motion versus subject motion, as two series.
 *
 * The neutral grey mass IS the room — floor, wall and tabletop — so its
 * centroid moves when and only when the camera does. A seated proxy's centroid
 * moves when the camera moves AND when the proxy breathes. Reported as two
 * separate sway/tremor decompositions rather than a ratio with a verdict: the
 * prompt asks for "real, slow handheld, not wiggle", which is a judgement a
 * human makes from these numbers, not a threshold.
 */
export function motionSeries(segments) {
  const camera = []
  const subject = []
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]
    const current = segments[i]
    camera.push(delta(prev?.grey?.centroid, current?.grey?.centroid))
    const perColour = []
    for (const colour of Object.keys(current?.colors ?? {})) {
      const d = delta(prev?.colors?.[colour]?.centroid, current?.colors?.[colour]?.centroid)
      if (d !== null) perColour.push(d)
    }
    subject.push(perColour.length === 0 ? null : perColour.reduce((a, b) => a + b, 0) / perColour.length)
  }
  return { camera, subject }
}

function delta(a, b) {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}
