/**
 * The editor's quote of an Extend Video on Seedance 2.5 (decided 2026-11-12):
 * (seconds sent + seconds added) ÷ 2 of its resolution's two-second row, the
 * seconds sent read off the canvas — an upload's length, a made generation's
 * recorded length, up to 10 s — and the whole 10 s window while the source is
 * not known (a generation not made yet, or run again). The server's run
 * estimate reads the same rule (`extendSourceEstimateSec`); the run holds and
 * is charged the source it measures.
 */
import { describe, it, expect } from "vitest"
import { seedanceExtendPrice } from "@nodaro/render-rules"
import { extendVideoPricingUnits } from "@/lib/extend-video-estimate"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const at = { x: 0, y: 0 }
const extend = (data: Record<string, unknown>): WorkflowNode =>
  ({ id: "x", type: "extend-video", position: at, data: { label: "Extend", provider: "seedance-2-5-extend", ...data } }) as unknown as WorkflowNode
const wire: WorkflowEdge[] = [{ id: "s-x", source: "s", target: "x", targetHandle: "video" } as WorkflowEdge]
const upload = (sec: number): WorkflowNode =>
  ({ id: "s", type: "upload-video", position: at, data: { url: "https://cdn.example.com/s.mp4", duration: sec, videoDurationSec: sec } }) as unknown as WorkflowNode
const generation = (data: Record<string, unknown>): WorkflowNode =>
  ({ id: "s", type: "generate-video", position: at, data: { provider: "seedance-2-5", duration: 5, ...data } }) as unknown as WorkflowNode

describe("Extend Video on Seedance 2.5 — the units the editor quotes", () => {
  it("brute force: an upload is quoted the units its charge counts; a generation not made yet the whole window, never fewer", () => {
    let cases = 0
    for (let tenths = 18; tenths <= 600; tenths++) {
      const sec = tenths / 10
      for (let duration = 4; duration <= 30; duration++) {
        const x = extend({ duration })
        const charged = seedanceExtendPrice({ duration, resolution: "720p", sourcePictureSec: sec }).units
        expect(extendVideoPricingUnits(x, [upload(sec), x], wire)).toBe(charged)
        const unmade = extendVideoPricingUnits(x, [generation({}), x], wire)
        expect(unmade).toBe((10 + duration) / 2)
        expect(unmade).toBeGreaterThanOrEqual(charged)
        cases++
      }
    }
    expect(cases).toBe(583 * 27)
  })

  it("a source's length follows the container-overhang rule: 8.04 s counts 8 s, 8.3 s counts 8.3 s", () => {
    const x = extend({ duration: 8 })
    expect(extendVideoPricingUnits(x, [upload(8.04), x], wire)).toBe(8)
    expect(extendVideoPricingUnits(x, [upload(8.3), x], wire)).toBe((8.3 + 8) / 2)
  })

  it("a made generation is read at the length it recorded, unless it runs again", () => {
    const x = extend({ duration: 8 })
    const made = generation({ generatedResults: [{ url: "https://cdn.example.com/g.mp4", duration: 5.04 }], activeResultIndex: 0 })
    // Recorded 5.04 s: a quarter second past a whole second at most, so it counts as 5 s.
    expect(extendVideoPricingUnits(x, [made, x], wire)).toBe((5 + 8) / 2)
    expect(extendVideoPricingUnits(x, [made, x], wire, new Set(["s"]))).toBe((10 + 8) / 2)
  })

  it("nothing wired: the whole window; Seedance 2.0 and the other providers: one", () => {
    expect(extendVideoPricingUnits(extend({ duration: 8 }), [extend({ duration: 8 })], [])).toBe(9)
    const x20 = extend({ provider: "seedance-2-0-extend", duration: 8 })
    expect(extendVideoPricingUnits(x20, [upload(4), x20], wire)).toBe(1)
    const ltx = extend({ provider: "ltx-2.3-pro", duration: 12 })
    expect(extendVideoPricingUnits(ltx, [ltx], [])).toBe(12)
  })
})
