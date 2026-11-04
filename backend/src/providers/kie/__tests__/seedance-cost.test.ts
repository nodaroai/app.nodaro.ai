import { describe, it, expect } from "vitest"
import { KIE_CREDIT_USD } from "../models.js"
import {
  SEEDANCE_25_KIE_CREDITS_PER_SEC,
  SEEDANCE_DRAFT_FINALIZE_KIE_CREDITS_PER_SEC,
  seedance25CostUsd,
  seedanceDraftFinalizeCostUsd,
} from "../seedance-cost.js"

/**
 * What KIE bills for a Seedance 2.5 render, recorded as the job's provider
 * cost: the per-second rate in KIE credits for the tier it rendered at, times
 * the seconds it billed (output alone, or input + output with a reference
 * video), converted at KIE_CREDIT_USD. Never a charge.
 */
describe("SEEDANCE_25_KIE_CREDITS_PER_SEC", () => {
  it("is the per-second rate table the model entry carries", () => {
    expect(SEEDANCE_25_KIE_CREDITS_PER_SEC).toEqual({
      "480p": { plain: 28, ref: 17 },
      "720p": { plain: 63, ref: 38 },
      "1080p": { plain: 158, ref: 95 },
    })
  })
})

describe("seedance25CostUsd", () => {
  it("a reference run bills input + output seconds at the ref rate: 720p, 10 s in + 10 s out", () => {
    expect(seedance25CostUsd({ resolution: "720p", draft: false, hasVideoRef: true, outputSec: 10, inputSec: 10 }))
      .toBeCloseTo(38 * 20 * KIE_CREDIT_USD, 12)
  })

  it("another reference run gets its own figure: 1080p, 6 s in + 6 s out", () => {
    expect(seedance25CostUsd({ resolution: "1080p", draft: false, hasVideoRef: true, outputSec: 6, inputSec: 6 }))
      .toBeCloseTo(95 * 12 * KIE_CREDIT_USD, 12)
  })

  it("a run with no reference video bills its output seconds at the plain rate: 1080p, 8 s", () => {
    expect(seedance25CostUsd({ resolution: "1080p", draft: false, hasVideoRef: false, outputSec: 8, inputSec: 0 }))
      .toBeCloseTo(158 * 8 * KIE_CREDIT_USD, 12)
  })

  it("input seconds count only with a reference video", () => {
    expect(seedance25CostUsd({ resolution: "1080p", draft: false, hasVideoRef: false, outputSec: 8, inputSec: 30 }))
      .toBe(seedance25CostUsd({ resolution: "1080p", draft: false, hasVideoRef: false, outputSec: 8, inputSec: 0 }))
  })

  it("a draft renders and bills at 480p, whatever resolution it was sent with", () => {
    expect(seedance25CostUsd({ resolution: "720p", draft: true, hasVideoRef: false, outputSec: 4, inputSec: 0 }))
      .toBeCloseTo(28 * 4 * KIE_CREDIT_USD, 12)
    expect(seedance25CostUsd({ resolution: "720p", draft: true, hasVideoRef: true, outputSec: 4, inputSec: 4 }))
      .toBeCloseTo(17 * 8 * KIE_CREDIT_USD, 12)
  })

  it("an unknown resolution renders at the model's default, 720p", () => {
    expect(seedance25CostUsd({ resolution: undefined, draft: false, hasVideoRef: false, outputSec: 8, inputSec: 0 }))
      .toBeCloseTo(63 * 8 * KIE_CREDIT_USD, 12)
    expect(seedance25CostUsd({ resolution: "4k", draft: false, hasVideoRef: true, outputSec: 5, inputSec: 5 }))
      .toBeCloseTo(38 * 10 * KIE_CREDIT_USD, 12)
  })

  it("a delivered length that is not a whole second is billed as measured", () => {
    expect(seedance25CostUsd({ resolution: "720p", draft: false, hasVideoRef: true, outputSec: 12.04, inputSec: 30 }))
      .toBeCloseTo(38 * 42.04 * KIE_CREDIT_USD, 12)
  })
})

/**
 * The 1080p HD finalize of a Seedance 2.5 draft: its own per-second rate in KIE
 * credits, over the seconds its charge bills (the draft's output seconds, or
 * input + output with a reference video).
 */
describe("seedanceDraftFinalizeCostUsd", () => {
  it("is the rate the seedance-2-5-hd credit rows carry", () => {
    expect(SEEDANCE_DRAFT_FINALIZE_KIE_CREDITS_PER_SEC).toEqual({ plain: 158, ref: 95 })
  })

  it("a draft made with a reference video: the ref rate over the billed seconds", () => {
    expect(seedanceDraftFinalizeCostUsd(12, true)).toBe(95 * 12 * KIE_CREDIT_USD)
  })

  it("a draft without one: the plain rate over its output seconds", () => {
    expect(seedanceDraftFinalizeCostUsd(8, false)).toBe(158 * 8 * KIE_CREDIT_USD)
  })
})
