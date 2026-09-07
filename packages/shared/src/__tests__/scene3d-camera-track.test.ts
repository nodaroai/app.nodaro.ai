import { describe, expect, it } from "vitest"
import {
  SCENE3D_CAMERA_TRACK_LIMITS,
  isScene3DCameraTrack,
  parseScene3DCameraTrackJson,
  scene3DCameraTrackIssues,
  scene3DCameraTrackPlanIssues,
  scene3DCameraTrackSchema,
  scene3DProjectionIssues,
  scene3DSampleForFrame,
} from "../scene3d-camera-track.js"
import {
  FIXTURE_FPS,
  FIXTURE_FRAMES,
  FIXTURE_HEIGHT,
  FIXTURE_WIDTH,
  cameraSample,
  cameraTrack,
  orthographicMatrix,
  perspectiveMatrix,
  planV2,
} from "./scene3d-v2-fixtures.js"

function joined(track: unknown): string {
  const result = scene3DCameraTrackSchema.safeParse(track)
  return result.success ? "" : result.error.issues.map((issue) => issue.message).join(" | ")
}

describe("scene3d camera track — structure", () => {
  it("accepts a full 720-sample track", () => {
    const track = cameraTrack()
    expect(scene3DCameraTrackSchema.safeParse(track).success).toBe(true)
    expect(isScene3DCameraTrack(track)).toBe(true)
    expect(scene3DCameraTrackIssues(track)).toEqual([])
  })

  it("accepts the maximum frame count and rejects one more", () => {
    expect(SCENE3D_CAMERA_TRACK_LIMITS.maxFrameCount).toBe(3600)
    expect(scene3DCameraTrackSchema.safeParse(cameraTrack(3600)).success).toBe(true)
    expect(scene3DCameraTrackSchema.safeParse(cameraTrack(3601)).success).toBe(false)
  })

  it("requires exactly one sample per frame", () => {
    const short = cameraTrack(10)
    short.samples = short.samples.slice(0, 9)
    expect(joined(short)).toContain("exactly one sample per frame is required")

    const long = cameraTrack(10)
    long.samples.push(cameraSample())
    expect(joined(long)).toContain("exactly one sample per frame is required")
  })

  it("pins the format, version and zero-based frame start", () => {
    expect(joined({ ...cameraTrack(2), format: "something-else" })).not.toBe("")
    expect(joined({ ...cameraTrack(2), version: 2 })).not.toBe("")
    expect(joined({ ...cameraTrack(2), frameStart: 1 })).not.toBe("")
  })

  it("rejects unknown keys on the track and on a sample", () => {
    expect(joined({ ...cameraTrack(2), extra: true })).not.toBe("")
    const track = cameraTrack(2)
    ;(track.samples[0] as unknown as Record<string, unknown>).lookAtOverride = [0, 0, 0]
    expect(joined(track)).not.toBe("")
  })

  it("rejects a foreign value outright", () => {
    for (const bad of [null, 7, "track", [], {}]) {
      expect(isScene3DCameraTrack(bad)).toBe(false)
    }
  })
})

describe("scene3d camera track — quaternions", () => {
  it("rejects an unnormalized quaternion", () => {
    const track = cameraTrack(3)
    track.samples[1] = cameraSample({ quaternion: [0, 0, 0, 2] })
    expect(joined(track)).toContain("it must be normalized")
  })

  it("accepts float noise inside the tolerance", () => {
    const track = cameraTrack(3)
    track.samples[1] = cameraSample({ quaternion: [0, 0, 0, 1 + 1e-6] })
    expect(scene3DCameraTrackSchema.safeParse(track).success).toBe(true)
  })

  it("rejects a non-finite quaternion component", () => {
    const track = cameraTrack(2)
    track.samples[0] = cameraSample({ quaternion: [0, 0, 0, Number.NaN] })
    expect(scene3DCameraTrackSchema.safeParse(track).success).toBe(false)
  })
})

describe("scene3d camera track — projection", () => {
  const aspect = FIXTURE_WIDTH / FIXTURE_HEIGHT

  it("accepts a real perspective matrix", () => {
    expect(scene3DProjectionIssues(perspectiveMatrix(35, aspect, 0.1, 200), 0.1, 200, ["m"])).toEqual([])
  })

  it("names orthographic instead of mis-reading it as a broken perspective", () => {
    const issues = scene3DProjectionIssues(orthographicMatrix(0.1, 200), 0.1, 200, ["m"])
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain("orthographic")
  })

  it("rejects the wrong number of entries and non-finite entries", () => {
    expect(scene3DProjectionIssues([1, 2, 3], 0.1, 200, ["m"])[0].message).toContain("exactly 16 entries")
    const broken = perspectiveMatrix(35, aspect, 0.1, 200)
    broken[0] = Number.POSITIVE_INFINITY
    expect(scene3DProjectionIssues(broken, 0.1, 200, ["m"])[0].message).toContain("non-finite")
  })

  it("rejects a matrix whose fixed entries are not fixed", () => {
    for (const index of [1, 2, 3, 4, 6, 7, 12, 13, 15]) {
      const matrix = perspectiveMatrix(35, aspect, 0.1, 200)
      matrix[index] = 0.5
      const issues = scene3DProjectionIssues(matrix, 0.1, 200, ["m"])
      expect(issues.length).toBeGreaterThan(0)
    }
    const notPerspective = perspectiveMatrix(35, aspect, 0.1, 200)
    notPerspective[11] = -0.5
    expect(scene3DProjectionIssues(notPerspective, 0.1, 200, ["m"])[0].message).toContain("must be -1")
  })

  it("rejects a matrix that disagrees with its own declared near/far", () => {
    const matrix = perspectiveMatrix(35, aspect, 0.1, 200)
    const nearIssues = scene3DProjectionIssues(matrix, 0.5, 200, ["m"])
    expect(nearIssues.map((issue) => issue.message).join(" ")).toContain("implies near")

    const farIssues = scene3DProjectionIssues(matrix, 0.1, 500, ["m"])
    expect(farIssues.map((issue) => issue.message).join(" ")).toContain("implies far")
  })

  it("rejects an infinite-far matrix that declares a finite far plane", () => {
    const matrix = perspectiveMatrix(35, aspect, 0.1, 200)
    matrix[10] = -1
    matrix[14] = -0.2
    expect(scene3DProjectionIssues(matrix, 0.1, 200, ["m"]).map((i) => i.message).join(" ")).toContain(
      "infinite far plane",
    )
  })

  it("rejects near/far that are not strictly ordered", () => {
    const track = cameraTrack(2)
    track.samples[0] = cameraSample({ near: 200, far: 200 })
    expect(joined(track)).toContain("must be greater than near")
  })
})

describe("scene3d camera track — agreement with the manifest", () => {
  const plan = planV2()

  it("accepts a matching track", () => {
    expect(scene3DCameraTrackPlanIssues(cameraTrack(), plan)).toEqual([])
  })

  it("rejects a different fps — retiming needs a new revision", () => {
    const track = cameraTrack(FIXTURE_FRAMES, { fps: 30 })
    const messages = scene3DCameraTrackPlanIssues(track, plan).map((issue) => issue.message)
    expect(messages.join(" ")).toContain("changing fps requires an explicit resample")
    expect(FIXTURE_FPS).toBe(24)
  })

  it("rejects a different length", () => {
    const messages = scene3DCameraTrackPlanIssues(cameraTrack(600), plan).map((issue) => issue.message)
    expect(messages.join(" ")).toContain("covers 600 frames but the scene is 720 frames")
  })

  it("rejects a projection baked for another aspect ratio", () => {
    const track = cameraTrack(4)
    track.samples[2] = cameraSample({ projectionMatrix: perspectiveMatrix(35, 16 / 9, 0.1, 200) })
    const messages = scene3DCameraTrackPlanIssues(track, {
      fps: FIXTURE_FPS,
      durationInFrames: 4,
      width: FIXTURE_WIDTH,
      height: FIXTURE_HEIGHT,
    }).map((issue) => issue.message)
    expect(messages.join(" ")).toContain("reprojection requires a new revision")
  })
})

describe("scene3d camera track — deterministic sampling", () => {
  it("maps frame f to samples[f], and refuses to clamp", () => {
    const track = cameraTrack(10)
    for (const frame of [0, 4, 9]) {
      expect(scene3DSampleForFrame(track, frame)).toBe(track.samples[frame])
    }
    expect(scene3DSampleForFrame(track, 10)).toBeUndefined()
    expect(scene3DSampleForFrame(track, -1)).toBeUndefined()
    expect(scene3DSampleForFrame(track, 2.5)).toBeUndefined()
  })

  it("is order-independent: backwards and shuffled reads give identical samples", () => {
    const track = cameraTrack(24)
    const forward = Array.from({ length: 24 }, (_unused, frame) => scene3DSampleForFrame(track, frame))
    const backward = Array.from({ length: 24 }, (_unused, index) => scene3DSampleForFrame(track, 23 - index)).reverse()
    const shuffled = [7, 0, 23, 12, 3].map((frame) => scene3DSampleForFrame(track, frame))
    expect(backward).toEqual(forward)
    expect(shuffled).toEqual([7, 0, 23, 12, 3].map((frame) => forward[frame]))
  })
})

describe("scene3d camera track — JSON admission", () => {
  it("accepts a well-formed payload", () => {
    const result = parseScene3DCameraTrackJson(JSON.stringify(cameraTrack(12)))
    expect(result.ok).toBe(true)
  })

  it("refuses an oversized payload before parsing it", () => {
    const padding = "x".repeat(SCENE3D_CAMERA_TRACK_LIMITS.maxJsonBytes + 1)
    const result = parseScene3DCameraTrackJson(padding)
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.issues[0].message).toContain("the limit is")
  })

  it("reports malformed JSON as an issue rather than throwing", () => {
    const result = parseScene3DCameraTrackJson("{ not json")
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.issues[0].message).toContain("not valid JSON")
  })

  it("reports schema failures with paths", () => {
    const track = cameraTrack(3)
    track.samples[1] = cameraSample({ quaternion: [1, 1, 1, 1] })
    const result = parseScene3DCameraTrackJson(JSON.stringify(track))
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues.map((issue) => issue.path.join("."))).toContain("samples.1.quaternion")
  })

  it("counts bytes, not characters", () => {
    // A multi-byte name must not slip past a length check that counted chars.
    const text = JSON.stringify({ note: "é".repeat(10) })
    expect(text.length).toBeLessThan(new TextEncoder().encode(text).length)
  })
})
