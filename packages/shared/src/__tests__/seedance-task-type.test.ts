import { describe, it, expect } from "vitest"
import {
  listedSeedanceTaskType,
  resolveSeedanceTaskType,
  seedanceTaskTypeFitsMedia,
  supportsReferenceTaskType,
  SEEDANCE_VIDEO_EDIT_SHAPE,
  type SeedanceTaskTypeFacts,
} from "../model-constants.js"
import { isVideoAutoAspectToken, videoAutoAspectRunsAt } from "../model-catalog.js"

const base: Omit<SeedanceTaskTypeFacts, "requested"> = {
  provider: "seedance-2-5",
  draft: false,
  referenceImageCount: 0,
  referenceAudioCount: 0,
  referenceVideoSec: [6],
  aspectRatio: "16:9",
  duration: 5,
}

/** Nothing declared, ratio and length exactly as given, nothing reported. */
function expectUnchanged(facts: SeedanceTaskTypeFacts): void {
  expect(resolveSeedanceTaskType(facts)).toEqual({
    taskType: undefined,
    aspectRatio: facts.aspectRatio,
    duration: facts.duration,
    adjustments: [],
  })
}

describe("resolveSeedanceTaskType", () => {
  it("edit: declares it and forces adaptive + Auto", () => {
    const r = resolveSeedanceTaskType({ ...base, requested: "edit" })
    expect(r).toMatchObject({ taskType: "edit", aspectRatio: "adaptive", duration: -1 })
    expect(r.adjustments.map((a) => a.field).sort()).toEqual(["aspectRatio", "duration"])
  })

  it("extend: forces adaptive, keeps a fixed length, replaces Auto with the model's default", () => {
    expect(resolveSeedanceTaskType({ ...base, requested: "extend" })).toMatchObject({ taskType: "extend", aspectRatio: "adaptive", duration: 5 })
    expect(resolveSeedanceTaskType({ ...base, requested: "extend", duration: -1 }).duration).toBe(8)
    expect(resolveSeedanceTaskType({ ...base, requested: "extend", duration: undefined }).duration).toBe(8)
  })

  it("reference: declares it and changes nothing, adaptive and Auto included", () => {
    expect(resolveSeedanceTaskType({ ...base, requested: "reference", aspectRatio: "adaptive", duration: -1 }))
      .toEqual({ taskType: "reference", aspectRatio: "adaptive", duration: -1, adjustments: [] })
    expect(resolveSeedanceTaskType({ ...base, requested: "reference", referenceVideoSec: [], referenceImageCount: 2 }).taskType).toBe("reference")
  })

  it.each([
    ["auto", "auto"], ["absent", undefined], ["wrong case", "EDIT"], ["number", 1], ["array", []], ["null", null],
  ])("%s is Auto: unchanged", (_n, requested) => {
    expectUnchanged({ ...base, requested })
  })

  it("another model: unchanged, even with a stale value", () => {
    expectUnchanged({ ...base, provider: "kling-4", requested: "edit" })
  })

  it("a draft: unchanged", () => {
    expectUnchanged({ ...base, draft: true, requested: "edit" })
  })

  it("no reference media at all: unchanged", () => {
    expectUnchanged({ ...base, requested: "reference", referenceVideoSec: [], referenceImageCount: 0, referenceAudioCount: 0 })
  })

  it("edit or extend without a reference video: unchanged", () => {
    expectUnchanged({ ...base, requested: "edit", referenceVideoSec: [], referenceImageCount: 1 })
    expectUnchanged({ ...base, requested: "extend", referenceVideoSec: [], referenceImageCount: 1 })
  })

  it.each([[[3]], [[6, 3]], [[31]], [[undefined]], [[6, undefined]]])("edit with videos %j: unchanged", (referenceVideoSec) => {
    expectUnchanged({ ...base, requested: "edit", referenceVideoSec })
  })

  it("edit at the bounds is declared", () => {
    expect(resolveSeedanceTaskType({ ...base, requested: "edit", referenceVideoSec: [4] }).taskType).toBe("edit")
    expect(resolveSeedanceTaskType({ ...base, requested: "edit", referenceVideoSec: [30] }).taskType).toBe("edit")
  })

  // Only `edit` needs measured lengths inside 4–30 s: `reference` and `extend`
  // are declared whatever the reference video measures, or if it was not measured.
  it.each([[[3]], [[31]], [[undefined]]])("reference and extend with videos %j are still declared", (referenceVideoSec) => {
    expect(resolveSeedanceTaskType({ ...base, requested: "reference", referenceVideoSec }).taskType).toBe("reference")
    expect(resolveSeedanceTaskType({ ...base, requested: "extend", referenceVideoSec }).taskType).toBe("extend")
  })

  it("edit reports the ratio and the length it replaces, from and to", () => {
    const { adjustments } = resolveSeedanceTaskType({ ...base, requested: "edit" })
    expect(adjustments).toEqual([
      expect.objectContaining({ field: "aspectRatio", from: "16:9", to: "adaptive" }),
      expect.objectContaining({ field: "duration", from: 5, to: -1 }),
    ])
  })

  it("edit runs in the purpose-built edit shape", () => {
    const r = resolveSeedanceTaskType({ ...base, requested: "edit" })
    expect({ aspectRatio: r.aspectRatio, duration: r.duration }).toEqual(SEEDANCE_VIDEO_EDIT_SHAPE)
  })

  it("extend reports the ratio it replaces and an Auto length it replaces, from and to", () => {
    expect(resolveSeedanceTaskType({ ...base, requested: "extend" }).adjustments).toEqual([
      expect.objectContaining({ field: "aspectRatio", from: "16:9", to: "adaptive" }),
    ])
    expect(resolveSeedanceTaskType({ ...base, requested: "extend", duration: -1 }).adjustments).toEqual([
      expect.objectContaining({ field: "aspectRatio", from: "16:9", to: "adaptive" }),
      expect.objectContaining({ field: "duration", from: -1, to: 8 }),
    ])
  })

  // "Auto" is the unified node's ratio token: with a reference video to match, a
  // model that lists "adaptive" runs it at "adaptive" (`videoAutoAspectRunsAt`,
  // the KIE adapter's own rule), so an edit or extend of an "Auto" request runs
  // at the ratio it asked for — nothing is replaced, so nothing is reported.
  it.each(["edit", "extend"] as const)("%s of an \"Auto\" or \"auto\" ratio reports no ratio adjustment, and still runs at adaptive", (requested) => {
    for (const aspectRatio of ["Auto", "auto"]) {
      const r = resolveSeedanceTaskType({ ...base, requested, aspectRatio, duration: requested === "edit" ? -1 : 8 })
      expect(r).toEqual({ taskType: requested, aspectRatio: "adaptive", duration: requested === "edit" ? -1 : 8, adjustments: [] })
    }
  })

  it.each(["edit", "extend"] as const)("%s of a fixed ratio still reports it", (requested) => {
    const r = resolveSeedanceTaskType({ ...base, requested, aspectRatio: "16:9", duration: requested === "edit" ? -1 : 8 })
    expect(r.adjustments).toEqual([expect.objectContaining({ field: "aspectRatio", from: "16:9", to: "adaptive" })])
  })

  it("the Auto token runs at adaptive only with a visual input, on a model that lists adaptive", () => {
    expect(isVideoAutoAspectToken("Auto")).toBe(true)
    expect(isVideoAutoAspectToken("auto")).toBe(true)
    // Exactly the spellings the provider adapter matches.
    for (const other of ["AUTO", " Auto", "adaptive", "16:9", "", undefined]) expect(isVideoAutoAspectToken(other)).toBe(false)
    expect(videoAutoAspectRunsAt("seedance-2-5", true)).toBe("adaptive")
    expect(videoAutoAspectRunsAt("seedance-2-5", false)).toBeUndefined()
    expect(videoAutoAspectRunsAt("kling-4", true)).toBeUndefined()
    expect(videoAutoAspectRunsAt(undefined, true)).toBeUndefined()
  })

  it("extend filling in a missing length reports nothing", () => {
    const r = resolveSeedanceTaskType({ ...base, requested: "extend", aspectRatio: "adaptive", duration: undefined })
    expect(r).toEqual({ taskType: "extend", aspectRatio: "adaptive", duration: 8, adjustments: [] })
  })

  it("the catalog names the model", () => {
    expect(supportsReferenceTaskType("seedance-2-5")).toBe(true)
    expect(supportsReferenceTaskType("seedance-2")).toBe(false)
    expect(supportsReferenceTaskType(undefined)).toBe(false)
  })

  it("listedSeedanceTaskType: a value the model's list holds, matched exactly", () => {
    for (const value of ["reference", "edit", "extend"]) {
      expect(listedSeedanceTaskType("seedance-2-5", value)).toBe(value)
    }
    for (const value of ["auto", "EDIT", undefined, null, 1, []]) {
      expect(listedSeedanceTaskType("seedance-2-5", value)).toBeUndefined()
    }
    expect(listedSeedanceTaskType("seedance-2", "edit")).toBeUndefined()
    expect(listedSeedanceTaskType(undefined, "edit")).toBeUndefined()
  })
})

describe("seedanceTaskTypeFitsMedia — the media each declared type needs", () => {
  const none = { imageCount: 0, videoCount: 0, audioCount: 0 }

  it("reference takes any reference media", () => {
    expect(seedanceTaskTypeFitsMedia("reference", { ...none, imageCount: 1 })).toBe(true)
    expect(seedanceTaskTypeFitsMedia("reference", { ...none, videoCount: 1 })).toBe(true)
    expect(seedanceTaskTypeFitsMedia("reference", { ...none, audioCount: 1 })).toBe(true)
    expect(seedanceTaskTypeFitsMedia("reference", none)).toBe(false)
  })

  it.each(["edit", "extend"] as const)("%s needs a reference video", (type) => {
    expect(seedanceTaskTypeFitsMedia(type, { ...none, videoCount: 1 })).toBe(true)
    expect(seedanceTaskTypeFitsMedia(type, { imageCount: 3, videoCount: 0, audioCount: 2 })).toBe(false)
    expect(seedanceTaskTypeFitsMedia(type, none)).toBe(false)
  })
})
