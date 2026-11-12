import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { stampSeedanceReferenceTaskType, stampSeedanceReferenceTaskTypeForRun } from "../seedance-task-type-stamp.js"
import type { VideoCreditIdArgs } from "../video-credit-id.js"

// The workflow run's twin of the routes' resolution: the payload builder puts
// the REQUESTED reference task type on the Video to Video node's Seedance edit
// (a text-to-video job in edit shape), and the executor resolves it once the
// reference clips are measured — the same shared resolver the routes run.

const CLIP = "https://cdn.example.com/clip.mp4"

/** The Video to Video node's Seedance 2.5 edit payload, as the builder makes it. */
const editPayload = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  jobId: "job-1",
  prompt: "edit @video_1 as follows:\nmake it black and white",
  provider: "seedance-2-5",
  duration: -1,
  aspectRatio: "adaptive",
  resolution: "480p",
  generateAudio: undefined,
  seed: undefined,
  referenceVideoUrls: [CLIP],
  referenceImageUrls: undefined,
  referenceAudioUrls: undefined,
  usageLogId: undefined,
  referenceTaskType: "edit",
  ...extra,
})

/** The payload with the requested key taken off: what "undeclared" must leave. */
const withoutTaskType = (payload: Record<string, unknown>): Record<string, unknown> => {
  const { referenceTaskType: _dropped, ...rest } = payload
  return rest
}

describe("stampSeedanceReferenceTaskType", () => {
  it("keeps a requested edit when the one clip is measured at 6 s", () => {
    const payload = editPayload()
    const stamped = stampSeedanceReferenceTaskType(payload, [6])
    expect(stamped).toStrictEqual(payload)
    expect(stamped.referenceTaskType).toBe("edit")
  })

  it.each([
    ["a 3 s clip (under 4 s)", [3]],
    ["a 31 s clip (over 30 s)", [31]],
    ["a clip whose probe failed (NaN)", [Number.NaN]],
    ["a clip that was never measured (no entry)", []],
    ["no measurement at all", undefined],
  ])("drops the requested edit for %s, and changes nothing else", (_name, measured) => {
    const payload = editPayload()
    const stamped = stampSeedanceReferenceTaskType(payload, measured as number[] | undefined)
    expect(stamped).not.toHaveProperty("referenceTaskType")
    expect(stamped).toStrictEqual(withoutTaskType(payload))
  })

  it("drops the requested edit on a draft, and changes nothing else", () => {
    const payload = editPayload({ draft: true })
    const stamped = stampSeedanceReferenceTaskType(payload, [6])
    expect(stamped).not.toHaveProperty("referenceTaskType")
    expect(stamped).toStrictEqual(withoutTaskType(payload))
  })

  it("drops it on a model that takes no task type", () => {
    const payload = editPayload({ provider: "seedance-2" })
    const stamped = stampSeedanceReferenceTaskType(payload, [6])
    expect(stamped).toStrictEqual(withoutTaskType(payload))
  })

  it("leaves a payload that requests nothing as the very same object", () => {
    const payload = withoutTaskType(editPayload())
    expect(stampSeedanceReferenceTaskType(payload, [6])).toBe(payload)
    expect(stampSeedanceReferenceTaskType(payload, [3])).toBe(payload)
  })

  it("never mutates the payload it is handed", () => {
    const payload = editPayload()
    const before = structuredClone(payload)
    stampSeedanceReferenceTaskType(payload, [3])
    stampSeedanceReferenceTaskType(payload, [6])
    expect(payload).toStrictEqual(before)
  })

  it("applies the ratio and length a declaration moves (not reachable from the edit lane)", () => {
    // An extension of a 6 s clip asked at 16:9 and 5 s runs at the clip's own
    // shape and the 5 s it asked for; the edit lane is already adaptive / Auto.
    const payload = editPayload({ referenceTaskType: "extend", aspectRatio: "16:9", duration: 5 })
    const stamped = stampSeedanceReferenceTaskType(payload, [6])
    expect(stamped).toStrictEqual({ ...payload, aspectRatio: "adaptive", duration: 5, referenceTaskType: "extend" })
  })
})

// ---------------------------------------------------------------------------
// The run the executor sends: the stamp above, plus the credit id re-built from
// the lane's own price arguments when the resolution moves the length — so the
// reservation is made for the length that runs. Without price arguments a
// declaration that would move the length is dropped and the run goes out as
// built (never mis-priced).
// ---------------------------------------------------------------------------

/** A Generate Video node's Seedance 2.5 job asked at 16:9 and 5 s, as the builder makes it. */
const lanePayload = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  jobId: "job-1",
  prompt: "make it black and white",
  provider: "seedance-2-5",
  duration: 5,
  aspectRatio: "16:9",
  resolution: "720p",
  referenceVideoUrls: [CLIP],
  referenceTaskType: "edit",
  ...extra,
})

/** The lane's price arguments for that job. */
const laneArgs = (duration: number | string = 5): VideoCreditIdArgs => ({
  provider: "seedance-2-5",
  duration,
  sound: undefined,
  mode: "text-to-video",
  sizeOrMode: undefined,
  resolution: "720p",
  hasVideoRef: true,
})

const idFor = (a: VideoCreditIdArgs): string =>
  buildVideoCreditModelIdentifier(a.provider, a.duration, a.sound, a.mode, a.sizeOrMode, a.resolution, a.hasVideoRef)

/** The build result the executor holds for `payload`, with the lane's price arguments. */
const builtRun = (payload: Record<string, unknown>) => ({
  payload,
  modelIdentifier: idFor(laneArgs(payload.duration as number)),
  videoCreditIdArgs: laneArgs(payload.duration as number),
})

/** The same build result without price arguments. */
const unpricedRun = (payload: Record<string, unknown>) => {
  const { videoCreditIdArgs: _args, ...rest } = builtRun(payload)
  return rest
}

describe("stampSeedanceReferenceTaskTypeForRun", () => {
  it("an edit of a 6 s clip runs adaptive at Auto length, priced for Auto from the lane's own arguments", () => {
    const built = builtRun(lanePayload())
    const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
    expect(run.payload).toStrictEqual({ ...lanePayload(), aspectRatio: "adaptive", duration: -1 })
    expect(run.modelIdentifier).toBe(idFor({ ...laneArgs(), duration: -1 }))
    expect(run.modelIdentifier).not.toBe(built.modelIdentifier)
    expect(run.droppedUnpriced).toBe(false)
  })

  it.each([
    ["a 3 s clip", [3]],
    ["an unmeasured clip", [Number.NaN]],
  ])("an edit of %s declares nothing: the payload as built without the key, the built id", (_name, measured) => {
    const built = builtRun(lanePayload())
    const run = stampSeedanceReferenceTaskTypeForRun(built, measured)
    expect(run.payload).toStrictEqual(withoutTaskType(lanePayload()))
    expect(run.modelIdentifier).toBe(built.modelIdentifier)
    expect(run.droppedUnpriced).toBe(false)
  })

  it("an extend at Auto length runs adaptive at 8 s, priced for 8 s", () => {
    const built = builtRun(lanePayload({ referenceTaskType: "extend", duration: -1 }))
    const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
    expect(run.payload).toStrictEqual(lanePayload({ referenceTaskType: "extend", aspectRatio: "adaptive", duration: 8 }))
    expect(run.modelIdentifier).toBe(idFor({ ...laneArgs(), duration: 8 }))
  })

  it("an extend at 5 s runs adaptive at 5 s, at the built id", () => {
    const built = builtRun(lanePayload({ referenceTaskType: "extend" }))
    const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
    expect(run.payload).toStrictEqual(lanePayload({ referenceTaskType: "extend", aspectRatio: "adaptive" }))
    expect(run.modelIdentifier).toBe(built.modelIdentifier)
  })

  it("a reference declaration moves nothing: the key only, at the built id", () => {
    const built = builtRun(lanePayload({ referenceTaskType: "reference" }))
    const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
    expect(run.payload).toStrictEqual(lanePayload({ referenceTaskType: "reference" }))
    expect(run.modelIdentifier).toBe(built.modelIdentifier)
  })

  it("a draft edit goes out undeclared, nothing else moves", () => {
    const built = builtRun(lanePayload({ draft: true }))
    const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
    expect(run.payload).toStrictEqual(withoutTaskType(lanePayload({ draft: true })))
    expect(run.modelIdentifier).toBe(built.modelIdentifier)
  })

  it("a payload that requests nothing is the very same object, at the built id", () => {
    const built = unpricedRun(withoutTaskType(lanePayload()))
    const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
    expect(run.payload).toBe(built.payload)
    expect(run.modelIdentifier).toBe(built.modelIdentifier)
    expect(run.droppedUnpriced).toBe(false)
  })

  describe("fail safe: no price arguments to re-price from", () => {
    it("an edit that would move the length goes out as built without the key, at the built id", () => {
      const built = unpricedRun(lanePayload())
      const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
      expect(run.payload).toStrictEqual(withoutTaskType(lanePayload()))
      expect(run.modelIdentifier).toBe(built.modelIdentifier)
      expect(run.droppedUnpriced).toBe(true)
    })

    it("a declaration that moves only the ratio still applies: the ratio is not priced", () => {
      const built = unpricedRun(lanePayload({ referenceTaskType: "extend" }))
      const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
      expect(run.payload).toStrictEqual(lanePayload({ referenceTaskType: "extend", aspectRatio: "adaptive" }))
      expect(run.modelIdentifier).toBe(built.modelIdentifier)
      expect(run.droppedUnpriced).toBe(false)
    })

    it("a length written as text is the same length, not a move", () => {
      const built = unpricedRun(lanePayload({ referenceTaskType: "extend", duration: "5" }))
      const run = stampSeedanceReferenceTaskTypeForRun(built, [6])
      expect(run.payload.referenceTaskType).toBe("extend")
      expect(run.droppedUnpriced).toBe(false)
    })
  })

  it("never mutates the build it is handed", () => {
    const built = builtRun(lanePayload())
    const before = structuredClone(built)
    stampSeedanceReferenceTaskTypeForRun(built, [6])
    stampSeedanceReferenceTaskTypeForRun({ ...built, videoCreditIdArgs: undefined }, [6])
    expect(built).toStrictEqual(before)
  })
})
