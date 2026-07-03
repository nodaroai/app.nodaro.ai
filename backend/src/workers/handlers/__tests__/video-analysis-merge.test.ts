// backend/src/workers/handlers/__tests__/video-analysis-merge.test.ts
import { describe, it, expect } from "vitest"
import { computeWindowPlan, mergeWindowResults } from "../video-analysis-merge.js"
import type { WindowAnalysis } from "@nodaro/shared"

const S = (startSec: number, endSec: number, over: Partial<WindowAnalysis["scenes"][number]> = {}) => ({
  startSec, endSec, label: "beat", shotType: "Wide Shot", camera: "static",
  visual: "a scene", audio: { mode: "silence" as const, content: "" }, ...over,
})
const W = (scenes: ReturnType<typeof S>[], slots: WindowAnalysis["slots"] = [], language?: string): WindowAnalysis =>
  ({ language, slots, scenes })

describe("computeWindowPlan", () => {
  it("single window ≤180s; stop condition on nominal targets", () => {
    expect(computeWindowPlan(170)).toEqual([{ k: 0, targetStartSec: 0 }])
    expect(computeWindowPlan(600).map((w) => w.targetStartSec)).toEqual([0, 145, 290, 435, 580])
    // 585: target 580 >= 585-5 → NOT emitted (no degenerate window)
    expect(computeWindowPlan(585).map((w) => w.targetStartSec)).toEqual([0, 145, 290, 435])
  })
})

describe("ownership on ACTUAL boundaries [S_k, S_{k+1})", () => {
  const windows = [{ k: 0, startSec: 0, endSec: 150 }, { k: 1, startSec: 145, endSec: 295 }]
  it("148s boundary scene: later window wins (saw it whole)", () => {
    const r = mergeWindowResults({ durationSec: 295, windows, results: {
      0: W([S(0, 5), S(148, 150)]),             // w0's copy is tail-truncated
      1: W([S(3, 11, { label: "whole" })]),      // abs 148→156, whole
    } })
    const scene = r.scenes.find((s) => Math.abs(s.startSec - 148) < 0.6)!
    expect(scene.label).toBe("whole")
    expect(Math.abs(scene.endSec - 156)).toBeLessThan(0.6)
  })
  it("variable actual overlap still yields total, disjoint ownership", () => {
    const w = [{ k: 0, startSec: 0, endSec: 150 }, { k: 1, startSec: 149, endSec: 295 }] // snap gave 1s overlap
    const r = mergeWindowResults({ durationSec: 295, windows: w, results: {
      0: W([S(0, 5)]), 1: W([S(0.5, 6)]),        // abs 149.5 — owned by w1
    } })
    expect(r.scenes).toHaveLength(2)
  })
  it("start-clipped duplicate at relative~0 is dropped (guard a)", () => {
    const r = mergeWindowResults({ durationSec: 295, windows, results: {
      0: W([S(140, 149, { label: "true-start" })]),   // w0 saw the true start, owned by w0
      1: W([S(0.3, 4, { label: "clipped-dup" })]),    // abs 145.3, 80% inside w0's scene
    } })
    expect(r.scenes.map((s) => s.label)).toEqual(["true-start"])
  })
  it("jitter-truncated earlier copy loses to whole later copy (guard b, symmetric)", () => {
    const r = mergeWindowResults({ durationSec: 295, windows, results: {
      0: W([S(144.6, 150, { label: "truncated" })]),  // ends at E0, model couldn't see the end
      1: W([S(0, 11.5, { label: "whole" })]),          // abs 145→156.5, covers it
    } })
    expect(r.scenes.map((s) => s.label)).toEqual(["whole"])
  })
  it("mutual ≥80% cover at a boundary keeps exactly the later whole copy (no double-drop)", () => {
    const r = mergeWindowResults({ durationSec: 295, windows, results: {
      0: W([S(144.6, 150, { label: "truncated" })]),   // ends at E0 → guard (b) condemns it
      1: W([S(0, 5.5, { label: "whole" })]),            // abs 145→150.5; rel 0 → guard (a) would fire, but prev is already dropped
    } })
    expect(r.scenes.map((s) => s.label)).toEqual(["whole"])
    expect(Math.abs(r.scenes[0].startSec - 145)).toBeLessThan(0.01)
    expect(Math.abs(r.scenes[0].endSec - 150.5)).toBeLessThan(0.01)
  })
})

describe("post-merge invariants", () => {
  const windows = [{ k: 0, startSec: 0, endSec: 150 }]
  it("clamp + renumber + oversized flag (never split) + slotRefs derived from tokens", () => {
    const slots = [{ slotId: "hero", label: "Hero", source: "wired-character" as const, role: "person", description: "tan man" }]
    const r = mergeWindowResults({ durationSec: 150, windows, results: {
      0: W([S(0, 12, { visual: "{slot:hero} monologue" }), S(11, 20)], slots),
    } })
    expect(r.scenes[0].oversized).toBe(true)                 // 12s, flagged not split
    expect(r.scenes[0].slotRefs).toEqual(["hero"])
    expect(r.scenes[0].visualResolved).toBe("tan man monologue")
    expect(r.scenes[1].startSec).toBe(12)                    // clamped to prev end
    expect(r.scenes.map((s) => s.sceneNumber)).toEqual([1, 2])
  })
  it("slot unification rewrites loser tokens; unresolved tokens unwrap in BOTH fields", () => {
    const a = { slotId: "man", label: "Man", source: "wired-character" as const, role: "person", description: "short desc" }
    const b = { slotId: "man", label: "man", source: "wired-character" as const, role: "person", description: "a much richer description" }
    const r = mergeWindowResults({ durationSec: 295, windows: [{ k: 0, startSec: 0, endSec: 150 }, { k: 1, startSec: 145, endSec: 295 }], results: {
      0: W([S(0, 4, { visual: "{slot:man} waves" })], [a]),
      1: W([S(10, 14, { visual: "{slot:man} runs past {slot:ghost}" })], [b]),
    } })
    expect(r.slots).toHaveLength(1)
    expect(r.slots[0].description).toBe("a much richer description") // richest wins
    const s2 = r.scenes[1]
    expect(s2.visual).toContain("{slot:man}")
    expect(s2.visual).toContain("ghost")            // unwrapped literal
    expect(s2.visual).not.toContain("{slot:ghost}")
    expect(r.warnings.some((w) => w.includes("ghost"))).toBe(true)
  })
  it("zero-scene window is a VALID result; language picked by speech-seconds", () => {
    const r = mergeWindowResults({ durationSec: 295, windows: [{ k: 0, startSec: 0, endSec: 150 }, { k: 1, startSec: 145, endSec: 295 }], results: {
      0: W([S(0, 6, { audio: { mode: "speech", content: "hola" } })], [], "es"),
      1: W([], [], "en"),                            // quiet window — fine
    } })
    expect(r.language).toBe("es")
    expect(r.scenes).toHaveLength(1)
  })
})
