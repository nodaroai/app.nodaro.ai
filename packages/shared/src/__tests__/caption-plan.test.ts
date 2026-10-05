// packages/shared/src/__tests__/caption-plan.test.ts
import { describe, it, expect, expectTypeOf } from "vitest"
import type { CaptionPlan, CaptionWordTiming } from "../index.js"

describe("CaptionPlan", () => {
  it("is exported from the package barrel with the documented fields", () => {
    const plan: CaptionPlan = {
      v: 1,
      hookText: "Saved 3 hours a week",
      hookEndMs: 1600,
      bodyEndMs: 4300,
      captions: [{ text: "so", startMs: 1600, endMs: 1900 }],
      videoDurationMs: 8000,
      language: "en",
    }
    expect(plan.v).toBe(1)
    expectTypeOf<CaptionWordTiming>().toEqualTypeOf<{ readonly text: string; readonly startMs: number; readonly endMs: number }>()
  })

  it("requires its version and carries no styling", () => {
    // @ts-expect-error — `v` is required
    const noVersion: CaptionPlan = { hookText: "", hookEndMs: 0, bodyEndMs: 0, captions: [] }
    // @ts-expect-error — a plan carries times and words only
    const styled: CaptionPlan = { v: 1, hookText: "", hookEndMs: 0, bodyEndMs: 0, captions: [], look: "clean" }
    expect([noVersion, styled]).toHaveLength(2)
  })
})
