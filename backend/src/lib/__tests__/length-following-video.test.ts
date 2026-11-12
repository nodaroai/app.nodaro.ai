import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { pricedOutputDurationSec } from "@nodaro/shared/models"
import { lengthFollowingBoundSec } from "@nodaro/render-rules"

/**
 * A video generation run is LENGTH-FOLLOWING when its model offers an
 * automatic length (catalog `autoDuration`) and the run either goes out at an
 * automatic length or carries a declared reference task type: the video it
 * makes is not its stored length, so its real length is recorded. Its upper
 * bound is the length the run is priced at (`pricedOutputDurationSec`), never a
 * number written here.
 */

const AUTO_MODELS = Object.entries(MODEL_CATALOG).filter(([, m]) => m.autoDuration === true).map(([id]) => id)
const TASK_TYPE_MODELS = Object.entries(MODEL_CATALOG).filter(([, m]) => (m.referenceTaskTypes?.length ?? 0) > 0).map(([id]) => id)
/** A video model with set lengths only. */
const FIXED_ONLY = Object.entries(MODEL_CATALOG).find(([, m]) => m.autoDuration !== true && (m.durations?.length ?? 0) > 0)![0]

describe("lengthFollowingBoundSec", () => {
  it("the catalog has models that offer an automatic length, and one that takes a task type", () => {
    expect(AUTO_MODELS.length).toBeGreaterThan(0)
    expect(TASK_TYPE_MODELS.length).toBeGreaterThan(0)
    for (const id of TASK_TYPE_MODELS) expect(AUTO_MODELS, id).toContain(id)
  })

  it.each(AUTO_MODELS)("%s at an automatic length: the length an automatic run is priced at", (provider) => {
    const bound = pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO)
    expect(lengthFollowingBoundSec({ provider, duration: VIDEO_DURATION_AUTO })).toBe(bound)
    expect(lengthFollowingBoundSec({ provider, duration: String(VIDEO_DURATION_AUTO) })).toBe(bound)
    // An automatic run is length-following whatever it declares.
    expect(lengthFollowingBoundSec({ provider, duration: VIDEO_DURATION_AUTO, referenceTaskType: "edit" })).toBe(bound)
  })

  it.each(AUTO_MODELS)("%s at a set length, nothing declared: not length-following", (provider) => {
    for (const duration of [5, 8, "5", undefined]) {
      expect(lengthFollowingBoundSec({ provider, duration }), String(duration)).toBeUndefined()
      expect(lengthFollowingBoundSec({ provider, duration, referenceTaskType: "auto" }), String(duration)).toBeUndefined()
    }
  })

  it.each(TASK_TYPE_MODELS)("%s at a set length with a declared type: that length, as the run is priced at it", (provider) => {
    for (const referenceTaskType of MODEL_CATALOG[provider]!.referenceTaskTypes!) {
      expect(lengthFollowingBoundSec({ provider, duration: 5, referenceTaskType }), referenceTaskType).toBe(pricedOutputDurationSec(provider, 5))
      expect(lengthFollowingBoundSec({ provider, duration: 8, referenceTaskType }), referenceTaskType).toBe(pricedOutputDurationSec(provider, 8))
      // No length: the model's own default, as the run renders and prices it.
      expect(lengthFollowingBoundSec({ provider, duration: undefined, referenceTaskType }), referenceTaskType).toBe(pricedOutputDurationSec(provider, undefined))
    }
  })

  it("a declared value the model does not list is no declaration", () => {
    const provider = AUTO_MODELS.find((id) => !TASK_TYPE_MODELS.includes(id))!
    expect(lengthFollowingBoundSec({ provider, duration: 5, referenceTaskType: "edit" })).toBeUndefined()
    expect(lengthFollowingBoundSec({ provider: TASK_TYPE_MODELS[0], duration: 5, referenceTaskType: "Edit" })).toBeUndefined()
    expect(lengthFollowingBoundSec({ provider: TASK_TYPE_MODELS[0], duration: 5, referenceTaskType: "bogus" })).toBeUndefined()
  })

  it("a model that offers no automatic length is never length-following", () => {
    expect(lengthFollowingBoundSec({ provider: FIXED_ONLY, duration: VIDEO_DURATION_AUTO })).toBeUndefined()
    expect(lengthFollowingBoundSec({ provider: FIXED_ONLY, duration: 5, referenceTaskType: "edit" })).toBeUndefined()
    expect(lengthFollowingBoundSec({ provider: undefined, duration: VIDEO_DURATION_AUTO })).toBeUndefined()
    expect(lengthFollowingBoundSec({ provider: "", duration: VIDEO_DURATION_AUTO })).toBeUndefined()
    expect(lengthFollowingBoundSec({ provider: 42, duration: VIDEO_DURATION_AUTO })).toBeUndefined()
  })
})
