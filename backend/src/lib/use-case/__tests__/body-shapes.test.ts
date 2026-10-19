/**
 * The multicam body shapes (decided 2026-10-17): the recordings, a Master
 * audio and the Cameras settings a multicam-capable node's body spreads. No
 * node spreads them yet; their ranges follow USE_CASE_MAX_RECORDINGS.
 */
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { USE_CASE_MAX_RECORDINGS } from "@nodaro/render-rules"
import { camerasShape, usecaseMulticamRecordingShape } from "../body-shapes.js"

const body = z.object(usecaseMulticamRecordingShape)
const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://r2/cam-${i + 1}.mp4`)

describe("usecaseMulticamRecordingShape", () => {
  it(`takes 1 to ${USE_CASE_MAX_RECORDINGS} recordings`, () => {
    expect(body.safeParse({ mediaUrls: [] }).success).toBe(false)
    expect(body.safeParse({ mediaUrls: urls(1) }).success).toBe(true)
    expect(body.safeParse({ mediaUrls: urls(USE_CASE_MAX_RECORDINGS) }).success).toBe(true)
    expect(body.safeParse({ mediaUrls: urls(USE_CASE_MAX_RECORDINGS + 1) }).success).toBe(false)
  })
  it("an optional Master audio, a URL like any input", () => {
    expect(body.safeParse({ mediaUrls: urls(2), masterAudioUrl: "https://r2/master.wav" }).success).toBe(true)
    expect(body.safeParse({ mediaUrls: urls(2), masterAudioUrl: "not a url" }).success).toBe(false)
  })
})

describe("camerasShape", () => {
  it("a wide camera is a position, or none", () => {
    for (const wide of [1, USE_CASE_MAX_RECORDINGS, null]) expect(camerasShape.safeParse({ wide }).success, String(wide)).toBe(true)
    for (const wide of [0, USE_CASE_MAX_RECORDINGS + 1, 1.5, "1"]) expect(camerasShape.safeParse({ wide }).success, String(wide)).toBe(false)
  })
  it("speakerCameras maps a speaker ordinal to a camera position, 0 for none", () => {
    expect(camerasShape.safeParse({ speakerCameras: { "1": 2, [String(USE_CASE_MAX_RECORDINGS)]: 0 } }).success).toBe(true)
    for (const key of ["0", "01", String(USE_CASE_MAX_RECORDINGS + 1), "x"]) {
      expect(camerasShape.safeParse({ speakerCameras: { [key]: 1 } }).success, key).toBe(false)
    }
    expect(camerasShape.safeParse({ speakerCameras: { "1": USE_CASE_MAX_RECORDINGS + 1 } }).success).toBe(false)
    expect(camerasShape.safeParse({ speakerCameras: { "1": -1 } }).success).toBe(false)
  })
  it("synced is a boolean; an unknown key is refused", () => {
    expect(camerasShape.safeParse({ synced: true }).success).toBe(true)
    expect(camerasShape.safeParse({ synced: "yes" }).success).toBe(false)
    expect(camerasShape.safeParse({ map: {} }).success).toBe(false)
  })
})
