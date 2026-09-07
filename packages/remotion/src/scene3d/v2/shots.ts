/**
 * Shot timeline: contiguous hard cuts over one global camera track.
 *
 * "Every frame belongs to exactly one shot" is enforced as a TILING, not as a
 * lookup with a fallback: gaps and overlaps are rejected at load, so the
 * per-frame lookup can never have to invent an answer mid-render. Shots are
 * hard cuts — nothing interpolates across `endFrameExclusive`.
 *
 * The shot index is also what scopes a camera override: an "offset this shot"
 * edit must not bleed into the neighbouring shot, and the only way to promise
 * that is to know the exact half-open range of each.
 */
import { check } from "./errors"
import { SCENE3D_V2_LIMITS } from "./limits"
import type { Scene3DShot } from "./plan-shape"

export interface Scene3DShotTimeline {
  readonly shots: readonly Scene3DShot[]
  /** `frame → index into shots`, dense over [0, durationInFrames). */
  readonly shotIndexByFrame: Int32Array
  shotAt(frame: number): Scene3DShot
  indexAt(frame: number): number
}

/**
 * Validate the shot list tiles `[0, durationInFrames)` exactly once and build
 * the frame→shot index.
 */
export function buildShotTimeline(
  shots: readonly Scene3DShot[],
  durationInFrames: number,
): Scene3DShotTimeline {
  check(Array.isArray(shots), "SCENE_SHOT_COVERAGE", "shots must be an array")
  check(shots.length >= 1, "SCENE_SHOT_COVERAGE", "a v2 plan must declare at least one shot")
  check(
    shots.length <= SCENE3D_V2_LIMITS.maxShots,
    "SCENE_RESOURCE_LIMIT",
    `${shots.length} shots exceeds the limit of ${SCENE3D_V2_LIMITS.maxShots}`,
  )

  const seenIds = new Set<string>()
  for (const shot of shots) {
    check(
      typeof shot?.id === "string" && shot.id.length > 0,
      "SCENE_SHOT_COVERAGE",
      "every shot needs a non-empty id",
    )
    check(!seenIds.has(shot.id), "SCENE_SHOT_COVERAGE", "duplicate shot id", shot.id)
    seenIds.add(shot.id)
    check(
      Number.isInteger(shot.startFrame) && Number.isInteger(shot.endFrameExclusive),
      "SCENE_SHOT_COVERAGE",
      "startFrame and endFrameExclusive must be integers",
      shot.id,
    )
    check(
      shot.endFrameExclusive > shot.startFrame,
      "SCENE_SHOT_COVERAGE",
      `empty or inverted range [${shot.startFrame}, ${shot.endFrameExclusive})`,
      shot.id,
    )
  }

  // Sorting is a convenience for authors; the CONTIGUITY check below is what
  // actually rejects a gap, so a sorted-but-gapped list still fails.
  const ordered = [...shots].sort((a, b) => a.startFrame - b.startFrame)

  check(
    ordered[0].startFrame === 0,
    "SCENE_SHOT_COVERAGE",
    `the first shot must start at frame 0, got ${ordered[0].startFrame}`,
    ordered[0].id,
  )
  for (let i = 1; i < ordered.length; i++) {
    check(
      ordered[i].startFrame === ordered[i - 1].endFrameExclusive,
      "SCENE_SHOT_COVERAGE",
      `shot starts at ${ordered[i].startFrame} but the previous shot ends at ${ordered[i - 1].endFrameExclusive} — shots must be contiguous with no gap or overlap`,
      ordered[i].id,
    )
  }
  const last = ordered[ordered.length - 1]
  check(
    last.endFrameExclusive === durationInFrames,
    "SCENE_SHOT_COVERAGE",
    `the last shot ends at ${last.endFrameExclusive} but the plan is ${durationInFrames} frames long`,
    last.id,
  )

  const shotIndexByFrame = new Int32Array(durationInFrames)
  for (let i = 0; i < ordered.length; i++) {
    shotIndexByFrame.fill(i, ordered[i].startFrame, ordered[i].endFrameExclusive)
  }

  const indexAt = (frame: number): number => {
    const f = Number.isFinite(frame) ? Math.floor(frame) : 0
    const clamped = f < 0 ? 0 : f >= durationInFrames ? durationInFrames - 1 : f
    return shotIndexByFrame[clamped]
  }

  return {
    shots: ordered,
    shotIndexByFrame,
    indexAt,
    shotAt: (frame: number) => ordered[indexAt(frame)],
  }
}
