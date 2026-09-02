import { describe, it, expect } from "vitest"
import { checkRefVideoDurations, VIDEO_REF_VIDEO_DURATION_LIMITS, VIDEO_REF_LIMITS_BY_PROVIDER } from "../index.js"

describe("checkRefVideoDurations", () => {
  it("accepts seedance-2-5 clips inside [2, 30]s", () => {
    expect(checkRefVideoDurations("seedance-2-5", [2, 15, 12.5])).toEqual({ ok: true })
  })
  it("rejects a clip under the floor and names the offender", () => {
    const r = checkRefVideoDurations("seedance-2-5", [1.4])
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toContain("between 2 and 30 seconds")
  })
  it("rejects a clip over the ceiling", () => {
    expect(checkRefVideoDurations("seedance-2-5", [31]).ok).toBe(false)
  })
  it("rejects a legal set whose TOTAL exceeds the cap", () => {
    const r = checkRefVideoDurations("seedance-2-5", [20, 20])
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toContain("30 seconds in total")
  })
  it("passes any provider with no declared limit through", () => {
    expect(checkRefVideoDurations("veo3", [99])).toEqual({ ok: true })
  })
  it("ignores unusable probe values rather than inventing a rejection", () => {
    expect(checkRefVideoDurations("seedance-2-5", [Number.NaN, 0, -1])).toEqual({ ok: true })
  })
  it("ignores a failed probe mixed in with usable ones (NaN never inflates the total)", () => {
    // The route stashes RAW per-URL probe outcomes, so a rejected ffprobe reaches
    // this checker as NaN. It must neither reject on its own nor push an
    // otherwise-legal set over the total cap.
    expect(checkRefVideoDurations("seedance-2-5", [20, Number.NaN, 9])).toEqual({ ok: true })
  })
  it("only declares limits for providers that actually accept reference videos", () => {
    for (const id of Object.keys(VIDEO_REF_VIDEO_DURATION_LIMITS)) {
      expect((VIDEO_REF_LIMITS_BY_PROVIDER[id]?.videos ?? 0), `${id} declares a duration limit but takes no reference videos`).toBeGreaterThan(0)
    }
  })
})

describe("minimax-h3 reference-video bounds", () => {
  // §11.3 / P4: "video duration 52838 ms, expected [2000, 15000] ms" ×2 — the
  // provider's own reject text is the per-clip source; the combined cap comes
  // from docs.kie.ai/market/minimax-h3/reference-to-video.
  it("declares the 2-15s per-clip bound the provider enforces", () => {
    expect(VIDEO_REF_VIDEO_DURATION_LIMITS["minimax-h3"]).toMatchObject({ minSec: 2, maxSec: 15 })
  })
  it("declares the 15s COMBINED cap the KIE doc states", () => {
    expect(VIDEO_REF_VIDEO_DURATION_LIMITS["minimax-h3"]).toMatchObject({ maxTotalSec: 15 })
  })
  it("rejects the exact clip from the two P4 rows", () => {
    const r = checkRefVideoDurations("minimax-h3", [52.838])
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toContain("between 2 and 15 seconds")
  })
  it("accepts a clip inside the bound", () => {
    expect(checkRefVideoDurations("minimax-h3", [14.9])).toEqual({ ok: true })
  })
  it("accepts three clips that together stay inside the combined cap", () => {
    expect(checkRefVideoDurations("minimax-h3", [5, 5, 5])).toEqual({ ok: true })
  })
  it("rejects three per-clip-legal videos whose TOTAL exceeds 15s", () => {
    const r = checkRefVideoDurations("minimax-h3", [6, 6, 6])
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toContain("15 seconds in total")
  })
  it("ignores a failed probe rather than rejecting the run", () => {
    expect(checkRefVideoDurations("minimax-h3", [Number.NaN, 10])).toEqual({ ok: true })
  })
})
