/**
 * The recordings of a use-case node: their ids and positions, the order both
 * engines send and build them in, and the Cameras settings a run resolves
 * against how many recordings it has (decided 2026-10-17). Every type still
 * takes one recording here, so none of this changes a run yet.
 */
import { describe, it, expect } from "vitest"
import {
  USE_CASE_CAMERAS_DEFAULTS,
  USE_CASE_MASTER_NODE_ID,
  USE_CASE_MAX_RECORDINGS,
  orderUseCaseMedia,
  resolveUseCaseCameras,
  usecaseRecordingNodeId,
  usecaseRecordingPosition,
  usecaseRecordings,
} from "@nodaro/render-rules"

describe("recording ids", () => {
  it("the first keeps P1's id; the others are uc-cam-<position>", () => {
    expect([0, 1, 2, 5].map(usecaseRecordingNodeId)).toEqual(["uc-source", "uc-cam-2", "uc-cam-3", "uc-cam-6"])
    expect(["uc-source", "uc-cam-2", "uc-cam-6", "uc-cam-7", "uc-master", "uc-plan"].map(usecaseRecordingPosition)).toEqual([1, 2, 6, null, null, null])
  })
  it("every recording id reads back as its position, and the master is no recording", () => {
    for (let i = 0; i < USE_CASE_MAX_RECORDINGS; i++) expect(usecaseRecordingPosition(usecaseRecordingNodeId(i))).toBe(i + 1)
    expect(usecaseRecordingPosition(USE_CASE_MASTER_NODE_ID)).toBeNull()
  })
  it("the id range follows USE_CASE_MAX_RECORDINGS: the last reads back, one past it and a padded number do not", () => {
    expect(usecaseRecordingPosition(usecaseRecordingNodeId(USE_CASE_MAX_RECORDINGS - 1))).toBe(USE_CASE_MAX_RECORDINGS)
    expect(usecaseRecordingPosition(usecaseRecordingNodeId(USE_CASE_MAX_RECORDINGS))).toBeNull()
    expect(["uc-cam-1", "uc-cam-02", "uc-cam-0", "uc-cam-"].map(usecaseRecordingPosition)).toEqual([null, null, null, null])
  })
  it("usecaseRecordings lists the first then the rest, in order", () => {
    const a = { url: "a", kind: "video" as const }, b = { url: "b", kind: "video" as const }
    expect(usecaseRecordings({ media: a })).toEqual([a])
    expect(usecaseRecordings({ media: a, moreMedia: [b] })).toEqual([a, b])
  })
})

describe("orderUseCaseMedia (both engines' order)", () => {
  const wired = [{ nodeId: "n1", url: "1" }, { nodeId: "n2", url: "2" }, { nodeId: "n3", url: "3" }, { nodeId: "n2", url: "2b" }]
  it("listed first by mediaOrder, then the rest in wire order, one row per upstream node", () => {
    expect(orderUseCaseMedia(wired, ["n3", "n1"]).map((w) => w.url)).toEqual(["3", "1", "2"])
    expect(orderUseCaseMedia(wired, undefined).map((w) => w.url)).toEqual(["1", "2", "3"])
    expect(orderUseCaseMedia(wired, ["gone", "n2"]).map((w) => w.url)).toEqual(["2", "1", "3"])
  })
  it("an id listed twice is taken once", () => {
    expect(orderUseCaseMedia(wired, ["n3", "n3", "n1"]).map((w) => w.url)).toEqual(["3", "1", "2"])
  })
  it("never mutates its inputs", () => {
    const order = ["n3"]
    const before = JSON.stringify([wired, order])
    orderUseCaseMedia(wired, order)
    expect(JSON.stringify([wired, order])).toBe(before)
  })
})

describe("resolveUseCaseCameras", () => {
  const shape = { recordings: 3, masterAudio: true }
  it("defaults, and every unknown value falls back", () => {
    expect(resolveUseCaseCameras(undefined, shape)).toEqual(USE_CASE_CAMERAS_DEFAULTS)
    expect(resolveUseCaseCameras({ wide: "x", synced: "yes", speakerCameras: [] }, shape)).toEqual(USE_CASE_CAMERAS_DEFAULTS)
    expect(resolveUseCaseCameras([1, 2], shape)).toEqual(USE_CASE_CAMERAS_DEFAULTS)
  })
  it("a wide camera inside the recordings is kept; past the last is dropped", () => {
    expect(resolveUseCaseCameras({ wide: 3 }, shape).wide).toBe(3)
    expect(resolveUseCaseCameras({ wide: 4 }, shape).wide).toBeNull()
    expect(resolveUseCaseCameras({ wide: 0 }, shape).wide).toBeNull()
  })
  it("synced only when exactly true", () => {
    expect(resolveUseCaseCameras({ synced: true }, shape).synced).toBe(true)
    expect(resolveUseCaseCameras({ synced: 1 }, shape).synced).toBe(false)
  })
  it("the override keeps ordinals 1–6 mapped to a camera position or 0 (no camera of their own)", () => {
    expect(resolveUseCaseCameras({ speakerCameras: { "1": 2, "2": 0, "3": 9, x: 1, "7": 1 } }, shape).speakerCameras).toEqual({ "1": 2, "2": 0 })
    // The speaker ordinals follow USE_CASE_MAX_RECORDINGS too: the last is kept, one past it and a padded one are not.
    const last = String(USE_CASE_MAX_RECORDINGS), past = String(USE_CASE_MAX_RECORDINGS + 1)
    expect(resolveUseCaseCameras({ speakerCameras: { [last]: 1, [past]: 1, "01": 1, "0": 1 } }, shape).speakerCameras).toEqual({ [last]: 1 })
  })
  it("one recording without a master has no cameras to set", () => {
    expect(resolveUseCaseCameras({ wide: 1, synced: true, speakerCameras: { "1": 1 } }, { recordings: 1, masterAudio: false })).toEqual(USE_CASE_CAMERAS_DEFAULTS)
    expect(resolveUseCaseCameras({ wide: 1 }, undefined)).toEqual(USE_CASE_CAMERAS_DEFAULTS)
  })
})
