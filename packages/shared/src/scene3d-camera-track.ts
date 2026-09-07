/**
 * The Scene3D v2 camera sidecar — one baked sample per frame.
 *
 * A 30-second scene is 720 camera samples. V1's 240-keyframe interpolated track
 * cannot carry that, and interpolating a sparse track across a hard cut blends
 * two shots into a frame that belongs to neither. So v2 moves the camera out of
 * the manifest into this dense JSON asset, and the rule becomes trivial:
 *
 *   **at integer frame `f`, use `samples[f]`.**
 *
 * No interpolation, no easing, no "nearest key". Pausing, scrubbing backwards
 * and rendering frames out of order therefore produce identical state, which is
 * the whole reason preview and export can be trusted to agree.
 *
 * Two things this format refuses to guess at:
 *
 * - **Orientation is a quaternion, not a look-at.** A renderer that replaces the
 *   exported quaternion with `lookAt(target)` throws away the authored roll and
 *   the handheld component. `target` is carried for inspection and intent only.
 * - **Projection is a matrix, not a lens number.** A focal length cannot express
 *   sensor fit or lens shift, and re-deriving a projection at a different aspect
 *   silently reframes every shot. `focalLengthMm` is metadata; the 16-element
 *   column-major matrix is authoritative.
 *
 * Changing fps or aspect ratio is an explicit resample/reprojection producing a
 * NEW revision — never a render-time override. `scene3DCameraTrackPlanIssues`
 * is what makes that non-negotiable.
 */
import { z } from "zod"
import {
  SCENE3D_V2_LIMITS,
  scene3DJsonByteLength,
  scene3DZodIssues,
  type Scene3DParseResult,
  type Scene3DPlanV2,
} from "./scene3d-v2.js"
import { SCENE3D_LIMITS, type Scene3DSemanticIssue, type Vec3 } from "./scene3d.js"

export const SCENE3D_CAMERA_TRACK_FORMAT = "scene3d-camera-track"
export const SCENE3D_CAMERA_TRACK_VERSION = 1

export const SCENE3D_CAMERA_TRACK_LIMITS = {
  maxJsonBytes: SCENE3D_V2_LIMITS.maxCameraTrackBytes,
  maxFrameCount: SCENE3D_V2_LIMITS.maxDurationInFrames,
  minFps: SCENE3D_V2_LIMITS.minFps,
  maxFps: SCENE3D_V2_LIMITS.maxFps,
  /** A unit quaternion off by more than this is a bug, not float noise. */
  quaternionTolerance: 1e-4,
  /** Absolute tolerance on the projection entries that must be exactly zero
   *  (or exactly ∓1) in a perspective matrix. */
  projectionEpsilon: 1e-6,
  /** Relative tolerance when comparing declared near/far against the values the
   *  projection matrix implies. */
  nearFarRelativeTolerance: 1e-3,
  /** Relative tolerance on `m[0]/m[5]` vs the manifest's `height/width`. */
  aspectRelativeTolerance: 1e-3,
  minNear: 1e-4,
  maxFar: 1e7,
} as const

export interface Scene3DCameraSample {
  position: Vec3
  /** `[x, y, z, w]` — that order, normalized. */
  quaternion: [number, number, number, number]
  /** Exactly 16 entries, COLUMN-MAJOR (Three.js `Matrix4.elements` order). */
  projectionMatrix: number[]
  near: number
  far: number
  /** Authoring intent, for inspection and validation reporting. A renderer must
   *  never feed this back through `lookAt()`. */
  target?: Vec3
  /** Metadata only; the projection matrix wins. */
  focalLengthMm?: number
}

export interface Scene3DCameraTrackV1 {
  format: typeof SCENE3D_CAMERA_TRACK_FORMAT
  version: typeof SCENE3D_CAMERA_TRACK_VERSION
  /** Always 0: public frames are zero-based, and the exporter has already
   *  subtracted the authoring package's start frame. */
  frameStart: 0
  frameCount: number
  fps: number
  samples: Scene3DCameraSample[]
}

const coordinate = z.number().min(-SCENE3D_LIMITS.maxCoordinate).max(SCENE3D_LIMITS.maxCoordinate)
const positionSchema = z.tuple([coordinate, coordinate, coordinate])

export const scene3DCameraSampleSchema = z
  .object({
    position: positionSchema,
    quaternion: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    projectionMatrix: z.array(z.number()).length(16),
    near: z.number().min(SCENE3D_CAMERA_TRACK_LIMITS.minNear).max(SCENE3D_CAMERA_TRACK_LIMITS.maxFar),
    far: z.number().min(SCENE3D_CAMERA_TRACK_LIMITS.minNear).max(SCENE3D_CAMERA_TRACK_LIMITS.maxFar),
    target: positionSchema.optional(),
    focalLengthMm: z
      .number()
      .min(SCENE3D_LIMITS.minFocalLengthMm)
      .max(SCENE3D_LIMITS.maxFocalLengthMm)
      .optional(),
  })
  .strict()

/** Structure only; `scene3DCameraTrackIssues` carries the numeric rules. */
export const scene3DCameraTrackObjectSchema = z
  .object({
    format: z.literal(SCENE3D_CAMERA_TRACK_FORMAT),
    version: z.literal(SCENE3D_CAMERA_TRACK_VERSION),
    frameStart: z.literal(0),
    frameCount: z.number().int().min(1).max(SCENE3D_CAMERA_TRACK_LIMITS.maxFrameCount),
    fps: z.number().int().min(SCENE3D_CAMERA_TRACK_LIMITS.minFps).max(SCENE3D_CAMERA_TRACK_LIMITS.maxFps),
    samples: z.array(scene3DCameraSampleSchema).min(1).max(SCENE3D_CAMERA_TRACK_LIMITS.maxFrameCount),
  })
  .strict()

type Issue = Scene3DSemanticIssue

/**
 * Is this a real PERSPECTIVE projection, and does it agree with the declared
 * near/far?
 *
 * Column-major layout produced by every Three.js/glTF perspective camera:
 *
 * ```text
 *   m0   0   m8   0
 *    0  m5   m9   0
 *    0   0  m10  m14
 *    0   0   -1   0
 * ```
 *
 * `m8`/`m9` carry lens shift and are free. Everything else is pinned. Inverting
 * the two depth terms recovers `near = m14 / (m10 - 1)` and
 * `far = m14 / (m10 + 1)`, which is how a matrix that quietly disagrees with its
 * own declared clip planes gets caught.
 *
 * Exported because the builder validates its export with the same function the
 * renderer admits it with.
 */
export function scene3DProjectionIssues(
  matrix: readonly number[],
  near: number,
  far: number,
  path: (string | number)[],
): Issue[] {
  const issues: Issue[] = []
  const eps = SCENE3D_CAMERA_TRACK_LIMITS.projectionEpsilon

  if (matrix.length !== 16) {
    issues.push({ path, message: `projection matrix must have exactly 16 entries (got ${matrix.length})` })
    return issues
  }
  if (matrix.some((value) => !Number.isFinite(value))) {
    issues.push({ path, message: "projection matrix contains a non-finite entry" })
    return issues
  }

  // Orthographic is a future explicit capability. Name it, so it is never
  // mis-read as a broken perspective matrix.
  if (Math.abs(matrix[11]) < eps && Math.abs(matrix[15] - 1) < eps) {
    issues.push({
      path,
      message: "projection matrix is orthographic; only perspective cameras are supported by this schema version",
    })
    return issues
  }

  for (const index of [1, 2, 3, 4, 6, 7, 12, 13, 15]) {
    if (Math.abs(matrix[index]) > eps) {
      issues.push({ path: [...path, index], message: `projection matrix entry ${index} must be 0 (got ${matrix[index]})` })
    }
  }
  if (Math.abs(matrix[11] + 1) > eps) {
    issues.push({ path: [...path, 11], message: `projection matrix entry 11 must be -1 for a perspective camera (got ${matrix[11]})` })
  }
  if (!(matrix[0] > 0)) {
    issues.push({ path: [...path, 0], message: `projection matrix entry 0 must be positive (got ${matrix[0]})` })
  }
  if (!(matrix[5] > 0)) {
    issues.push({ path: [...path, 5], message: `projection matrix entry 5 must be positive (got ${matrix[5]})` })
  }
  if (!(matrix[10] < 0)) {
    issues.push({ path: [...path, 10], message: `projection matrix entry 10 must be negative (got ${matrix[10]})` })
  }
  if (!(matrix[14] < 0)) {
    issues.push({ path: [...path, 14], message: `projection matrix entry 14 must be negative (got ${matrix[14]})` })
  }
  if (issues.length > 0) return issues

  if (!(near > 0) || !(far > near)) {
    issues.push({ path, message: `near/far must satisfy 0 < near < far (got near ${near}, far ${far})` })
    return issues
  }

  const tolerance = SCENE3D_CAMERA_TRACK_LIMITS.nearFarRelativeTolerance
  const impliedNear = matrix[14] / (matrix[10] - 1)
  if (Math.abs(impliedNear - near) > Math.abs(near) * tolerance) {
    issues.push({
      path,
      message: `projection matrix implies near ${impliedNear.toPrecision(6)}, but the sample declares ${near}`,
    })
  }
  const farDenominator = matrix[10] + 1
  if (Math.abs(farDenominator) < eps) {
    issues.push({
      path,
      message: `projection matrix implies an infinite far plane, but the sample declares ${far}`,
    })
  } else {
    const impliedFar = matrix[14] / farDenominator
    if (Math.abs(impliedFar - far) > Math.abs(far) * tolerance) {
      issues.push({
        path,
        message: `projection matrix implies far ${impliedFar.toPrecision(6)}, but the sample declares ${far}`,
      })
    }
  }

  return issues
}

/**
 * The numeric rules the schema cannot express: exact sample count, normalized
 * quaternions, and a real perspective projection on every frame.
 *
 * Split out of the schema (as v1 does) so a caller holding a parsed track can
 * re-check it, and so the per-sample walk stays one readable loop over up to
 * 3,600 samples.
 */
export function scene3DCameraTrackIssues(track: Scene3DCameraTrackV1): Issue[] {
  const issues: Issue[] = []

  if (track.samples.length !== track.frameCount) {
    issues.push({
      path: ["samples"],
      message: `track declares ${track.frameCount} frames but carries ${track.samples.length} samples; exactly one sample per frame is required`,
    })
  }

  const quaternionTolerance = SCENE3D_CAMERA_TRACK_LIMITS.quaternionTolerance
  track.samples.forEach((sample, index) => {
    const [x, y, z, w] = sample.quaternion
    const norm = Math.sqrt(x * x + y * y + z * z + w * w)
    if (Math.abs(norm - 1) > quaternionTolerance) {
      issues.push({
        path: ["samples", index, "quaternion"],
        message: `quaternion at frame ${index} has length ${norm.toPrecision(6)}; it must be normalized`,
      })
    }
    if (!(sample.far > sample.near)) {
      issues.push({
        path: ["samples", index, "far"],
        message: `frame ${index}: far (${sample.far}) must be greater than near (${sample.near})`,
      })
    }
    for (const issue of scene3DProjectionIssues(
      sample.projectionMatrix,
      sample.near,
      sample.far,
      ["samples", index, "projectionMatrix"],
    )) {
      issues.push(issue)
    }
  })

  return issues
}

/** THE camera-track validator: structure, then the numeric rules. */
export const scene3DCameraTrackSchema = scene3DCameraTrackObjectSchema.superRefine((track, ctx) => {
  for (const issue of scene3DCameraTrackIssues(track as Scene3DCameraTrackV1)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message })
  }
})

export function isScene3DCameraTrack(value: unknown): value is Scene3DCameraTrackV1 {
  return scene3DCameraTrackSchema.safeParse(value).success
}

/**
 * Track ↔ manifest agreement. A track that is valid on its own can still be the
 * WRONG track for this scene: a different fps, a different length, or a
 * projection baked for another aspect ratio. Each of those silently reframes or
 * retimes every shot, so each is an error here rather than a render-time
 * surprise.
 */
export function scene3DCameraTrackPlanIssues(
  track: Scene3DCameraTrackV1,
  plan: Pick<Scene3DPlanV2, "fps" | "durationInFrames" | "width" | "height">,
): Issue[] {
  const issues: Issue[] = []

  if (track.fps !== plan.fps) {
    issues.push({
      path: ["fps"],
      message: `camera track is ${track.fps} fps but the scene is ${plan.fps} fps; changing fps requires an explicit resample and a new revision`,
    })
  }
  if (track.frameCount !== plan.durationInFrames) {
    issues.push({
      path: ["frameCount"],
      message: `camera track covers ${track.frameCount} frames but the scene is ${plan.durationInFrames} frames`,
    })
  }

  // m[0]/m[5] === (t-b)/(r-l) === height/width for any perspective matrix,
  // including a shifted one (shift moves m[8]/m[9], not the frustum extents).
  const expected = plan.height / plan.width
  const tolerance = SCENE3D_CAMERA_TRACK_LIMITS.aspectRelativeTolerance
  track.samples.forEach((sample, index) => {
    const m0 = sample.projectionMatrix[0]
    const m5 = sample.projectionMatrix[5]
    if (!Number.isFinite(m0) || !Number.isFinite(m5) || m5 === 0) return
    const actual = m0 / m5
    if (Math.abs(actual - expected) > expected * tolerance) {
      issues.push({
        path: ["samples", index, "projectionMatrix"],
        message: `frame ${index}: projection is baked for aspect ${(1 / actual).toPrecision(6)} but the scene renders ${plan.width}×${plan.height}; reprojection requires a new revision`,
      })
    }
  })

  return issues
}

/**
 * The sample for an integer frame. `undefined` outside `[0, frameCount)` — a
 * caller must fail rather than clamp, because a clamped frame is a wrong frame
 * that looks plausible.
 */
export function scene3DSampleForFrame(
  track: Scene3DCameraTrackV1,
  frame: number,
): Scene3DCameraSample | undefined {
  if (!Number.isInteger(frame) || frame < 0 || frame >= track.frameCount) return undefined
  return track.samples[frame]
}

/**
 * Size-gate, then parse, then validate. This is the admission path for a
 * downloaded camera track: an 80 MiB "8 MiB" track is refused before
 * `JSON.parse` gets a chance to allocate it.
 */
export function parseScene3DCameraTrackJson(text: string): Scene3DParseResult<Scene3DCameraTrackV1> {
  const bytes = scene3DJsonByteLength(text)
  if (bytes > SCENE3D_CAMERA_TRACK_LIMITS.maxJsonBytes) {
    return {
      ok: false,
      issues: [
        {
          path: [],
          message: `camera track is ${bytes} bytes; the limit is ${SCENE3D_CAMERA_TRACK_LIMITS.maxJsonBytes}`,
        },
      ],
    }
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    return { ok: false, issues: [{ path: [], message: "camera track is not valid JSON" }] }
  }
  const parsed = scene3DCameraTrackSchema.safeParse(decoded)
  if (!parsed.success) {
    return { ok: false, issues: scene3DZodIssues(parsed.error) }
  }
  return { ok: true, value: parsed.data as Scene3DCameraTrackV1 }
}
