import { describe, it, expect } from "vitest"
import { SMART_CUT_WINDOW_MAX, SMART_CUT_WINDOW_MIN } from "@nodaro/shared/edl"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

/**
 * `/v1/combine-videos` bounds `smartCutFramesPrev` / `smartCutFramesNext` with
 * the shared `SMART_CUT_WINDOW_MIN`/`MAX`, and REJECTS anything outside them.
 * A node's `data` is not a trusted source for those numbers: it can be typed
 * into the config panel, written straight into workflow JSON by an agent or an
 * import, or carried over from a template. So every send path clamps through
 * `clampSmartCutWindow` rather than forwarding the raw value — otherwise one
 * stale field 400s the whole workflow run at finalize time (production
 * app_reports, 2026-09-07: `smartCutFramesPrev` AND `smartCutFramesNext` both
 * "Too big: expected number to be <=24").
 */
describe("combine-videos smart-cut search windows (orchestrator send path)", () => {
  const inputs: ResolvedInputs = { videoUrls: ["https://v1.mp4", "https://v2.mp4"] }
  const build = (data: Record<string, unknown>) =>
    buildPayload({ id: "n1", type: "combine-videos", data } as SimpleNode, "job-1", inputs)
      .payload as Record<string, unknown>

  it("clamps an over-wide window down to the route's ceiling", () => {
    const payload = build({ smartCutEnabled: true, smartCutFramesPrev: 48, smartCutFramesNext: 30 })
    expect(payload.smartCutFramesPrev).toBe(SMART_CUT_WINDOW_MAX)
    expect(payload.smartCutFramesNext).toBe(SMART_CUT_WINDOW_MAX)
  })

  it("clamps a below-range window up to the floor", () => {
    const payload = build({ smartCutEnabled: true, smartCutFramesPrev: 0, smartCutFramesNext: -3 })
    expect(payload.smartCutFramesPrev).toBe(SMART_CUT_WINDOW_MIN)
    expect(payload.smartCutFramesNext).toBe(SMART_CUT_WINDOW_MIN)
  })

  it("passes a legal window through untouched", () => {
    const payload = build({ smartCutEnabled: true, smartCutFramesPrev: 12, smartCutFramesNext: 4 })
    expect(payload.smartCutFramesPrev).toBe(12)
    expect(payload.smartCutFramesNext).toBe(4)
  })

  it("drops a non-numeric window so the route's own default applies", () => {
    const payload = build({ smartCutEnabled: true, smartCutFramesPrev: "eight", smartCutFramesNext: null })
    expect(payload.smartCutFramesPrev).toBeUndefined()
    expect(payload.smartCutFramesNext).toBeUndefined()
  })
})
