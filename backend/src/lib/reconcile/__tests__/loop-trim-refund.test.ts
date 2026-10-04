import { describe, it, expect } from "vitest"

import { loopTrimAddonForReconcile } from "../loop-trim-refund.js"

// P0.3 (audit M3): this used to be `refundLoopTrimAddonOnReconcile`, which
// COMMITTED the usage_log at (reserved − addon) BEFORE finalize. If finalize
// then failed persistently, the log was no longer `reserved`, so the
// exhaustion refund (`forceFailExhausted` → reserved-only) silently no-oped —
// the user stayed charged for a failed job while the anomaly note claimed a
// refund happened. The helper is now PURE: it only computes the addon; the
// commit-side application (and the orchestrated-job skip, which needs the
// jobs row) lives in finalizeJobWithMedia AFTER markJobCompleted succeeds —
// see the "loop-trim addon" tests in lib/__tests__/job-finalize.test.ts.
describe("loopTrimAddonForReconcile", () => {
  it("returns the addon for an i2v job with loopTrim enabled", () => {
    // addon = 10 × (ceil(8/5) + ceil(16/24)) = 10 × (2 + 1) = 30
    expect(
      loopTrimAddonForReconcile("image-to-video", {
        loopTrim: { enabled: true, framesToTest: 16 },
        duration: 8,
      }),
    ).toBe(30)
  })

  it("defaults duration to 8 when absent", () => {
    expect(
      loopTrimAddonForReconcile("image-to-video", {
        loopTrim: { enabled: true, framesToTest: 16 },
      }),
    ).toBe(30)
  })

  it("returns 0 for a non-i2v job", () => {
    expect(
      loopTrimAddonForReconcile("generate-image", { loopTrim: { enabled: true } }),
    ).toBe(0)
  })

  it("returns 0 when loopTrim is disabled or absent", () => {
    expect(loopTrimAddonForReconcile("image-to-video", { loopTrim: { enabled: false } })).toBe(0)
    expect(loopTrimAddonForReconcile("image-to-video", {})).toBe(0)
    expect(loopTrimAddonForReconcile("image-to-video", null)).toBe(0)
    expect(loopTrimAddonForReconcile(null, null)).toBe(0)
  })

  it("Auto duration (-1) is sized at the model's longest clip, like the reservation and the worker", () => {
    const loopTrim = { enabled: true, framesToTest: 24 }
    const auto = loopTrimAddonForReconcile("image-to-video", { provider: "seedance-2-5", duration: -1, loopTrim })
    const ceiling = loopTrimAddonForReconcile("image-to-video", { provider: "seedance-2-5", duration: 30, loopTrim })
    expect(auto).toBe(ceiling)
    expect(auto).toBeGreaterThan(loopTrimAddonForReconcile("image-to-video", { provider: "seedance-2-5", duration: 5, loopTrim }))
  })
})
