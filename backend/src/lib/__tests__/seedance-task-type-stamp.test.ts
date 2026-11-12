import { describe, it, expect } from "vitest"
import { stampSeedanceReferenceTaskType } from "../seedance-task-type-stamp.js"

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
