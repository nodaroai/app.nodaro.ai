import { describe, expect, it } from "vitest"
import { decodeScene3DCameraTrack, sampleBakedCamera } from "../camera-track"
import { jsonAssetBytes } from "./glb-fixtures"
import { makeCameraTrack, makeV2Plan, orthographicMatrix, perspectiveMatrix } from "./v2-fixtures"

/**
 * Field-level validation of the sidecar (projection shape, quaternion norm,
 * near/far ordering, sample count) belongs to `@nodaro/shared` and is tested
 * there. What is tested HERE is the renderer's own contribution: the byte gate
 * before `JSON.parse`, the mapping from contract issues onto stable renderer
 * failure codes, and the per-frame lookup semantics.
 */
const PLAN = makeV2Plan({ durationInFrames: 48, fps: 24 })

function decode(track: unknown) {
  return decodeScene3DCameraTrack(jsonAssetBytes(track), PLAN, "cam")
}

function withSample(index: number, patch: Record<string, unknown>) {
  const clone = JSON.parse(JSON.stringify(makeCameraTrack({ frameCount: 48 }))) as {
    samples: Array<Record<string, unknown>>
  }
  clone.samples[index] = { ...clone.samples[index], ...patch }
  return clone
}

describe("camera sidecar admission", () => {
  it("accepts a well-formed track that matches its manifest", () => {
    const track = decode(makeCameraTrack({ frameCount: 48 }))
    expect(track.samples).toHaveLength(48)
    expect(track.fps).toBe(24)
  })

  it("rejects a track whose fps disagrees with the manifest", () => {
    // Changing fps requires an explicit resample and a NEW revision, so a
    // mismatched pair is a mismatched pair — never something to stretch.
    expect(() => decode(makeCameraTrack({ frameCount: 48, fps: 30 }))).toThrow(
      /SCENE_CAMERA_TRACK_INVALID/,
    )
  })

  it("rejects a track that does not cover every frame", () => {
    expect(() => decode(makeCameraTrack({ frameCount: 47 }))).toThrow(/SCENE_CAMERA_TRACK_INVALID/)
  })

  it("rejects a track baked at a different aspect ratio", () => {
    expect(() => decode(makeCameraTrack({ frameCount: 48, aspect: 1 }))).toThrow(
      /SCENE_CAMERA_TRACK_INVALID/,
    )
  })

  it("reports an orthographic projection as UNSUPPORTED, not as malformed", () => {
    // The difference is what a support answer hangs on: orthographic is a
    // future capability, not a broken file.
    expect(() =>
      decode(withSample(0, { projectionMatrix: orthographicMatrix() })),
    ).toThrow(/SCENE_EXPORT_UNSUPPORTED/)
  })

  it.each([
    ["a de-normalized quaternion", { quaternion: [0, 0, 0, 0.5] }],
    ["a NaN position", { position: [Number.NaN, 0, 0] }],
    ["inverted near/far", { near: 10, far: 5 }],
    ["a 15-element projection", { projectionMatrix: perspectiveMatrix().slice(0, 15) }],
  ])("rejects %s", (_label, patch) => {
    expect(() => decode(withSample(3, patch))).toThrow(/SCENE_CAMERA_TRACK_INVALID/)
  })

  it("rejects a foreign format and an unknown sidecar version", () => {
    expect(() => decode({ ...makeCameraTrack({ frameCount: 48 }), format: "other" })).toThrow()
    expect(() => decode({ ...makeCameraTrack({ frameCount: 48 }), version: 2 })).toThrow()
  })

  it("rejects malformed JSON and invalid UTF-8 with a stable code", () => {
    const encode = (values: number[]) => {
      const bytes = new ArrayBuffer(values.length)
      new Uint8Array(bytes).set(values)
      return bytes
    }
    expect(() =>
      decodeScene3DCameraTrack(jsonAssetBytesRaw("{ not json"), PLAN, "cam"),
    ).toThrow(/SCENE_CAMERA_TRACK_INVALID/)
    expect(() => decodeScene3DCameraTrack(encode([0xff, 0xfe, 0xfd, 0xfc]), PLAN, "cam")).toThrow(
      /not valid UTF-8/,
    )
  })

  it("refuses a track larger than the decoded-bytes ceiling", () => {
    // 8 MiB + 1, allocated as bytes only — the gate must fire on LENGTH, before
    // anything tries to parse it.
    const oversized = new ArrayBuffer(8 * 1024 * 1024 + 1)
    expect(() => decodeScene3DCameraTrack(oversized, PLAN, "cam")).toThrow(/SCENE_RESOURCE_LIMIT/)
  })
})

function jsonAssetBytesRaw(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text)
  const out = new ArrayBuffer(encoded.byteLength)
  new Uint8Array(out).set(encoded)
  return out
}

describe("camera sampling is selection, not interpolation", () => {
  const track = decode(makeCameraTrack({ frameCount: 48 }))

  it("returns sample f at integer frame f", () => {
    for (const frame of [0, 1, 17, 47]) {
      expect(sampleBakedCamera(track, frame).position[0]).toBeCloseTo(frame * 0.01, 12)
    }
  })

  it("floors a fractional frame rather than blending across it", () => {
    // Blending would silently cross a cut; motion blur is off and any later
    // subframe sampling must stay inside the selected shot.
    expect(sampleBakedCamera(track, 17.9)).toBe(sampleBakedCamera(track, 17))
  })

  it("clamps out-of-range frames instead of throwing", () => {
    expect(sampleBakedCamera(track, -5)).toBe(track.samples[0])
    expect(sampleBakedCamera(track, 999)).toBe(track.samples[47])
  })

  it("is order-independent: a backward scrub returns identical objects", () => {
    const forward = [0, 1, 2, 3, 4].map((f) => sampleBakedCamera(track, f))
    const backward = [4, 3, 2, 1, 0].map((f) => sampleBakedCamera(track, f)).reverse()
    expect(backward).toEqual(forward)
  })
})
