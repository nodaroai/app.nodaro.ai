import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, type ModelCatalogEntry } from "@nodaro/shared/model-catalog"
import { EXTEND_VIDEO_PROVIDERS } from "@nodaro/shared/models"
import { LTX_EXTEND_DURATION } from "@nodaro/shared/credits"
import { EXTEND_DURATION_MAX_SEC, EXTEND_DURATION_SECONDS, describeSeconds } from "../extend-durations.js"

// The seconds each Extend Video provider may be asked to add. Every provider
// declares its own list — there is no fallback a new provider could silently
// inherit — and a provider whose extend entry in the catalog declares
// `durations` is held to them (the editor offers them and the price rows
// cover them).

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i)

describe("EXTEND_DURATION_SECONDS", () => {
  it("declares exactly the Extend Video providers, none missing and none extra", () => {
    expect(Object.keys(EXTEND_DURATION_SECONDS).sort()).toEqual([...EXTEND_VIDEO_PROVIDERS].sort())
  })

  it.each([...EXTEND_VIDEO_PROVIDERS])("%s: a non-empty, ascending list of distinct whole seconds", (provider) => {
    const seconds = EXTEND_DURATION_SECONDS[provider]
    expect(seconds.length).toBeGreaterThan(0)
    for (const s of seconds) expect(Number.isInteger(s) && s > 0, String(s)).toBe(true)
    expect([...seconds]).toEqual([...new Set(seconds)].sort((a, b) => a - b))
  })

  // Per provider, never the exact list of such models: each new engine that
  // declares its own lengths joins this check without editing it.
  it("an extend model whose catalog entry declares durations is held to them", () => {
    const declared = Object.values(MODEL_CATALOG as Record<string, ModelCatalogEntry>).filter(
      (e) => e.kind === "video" && e.modes.includes("extend") && (e.durations?.length ?? 0) > 0,
    )
    expect(declared.length).toBeGreaterThan(0)
    for (const e of declared) {
      expect(EXTEND_VIDEO_PROVIDERS as readonly string[], e.id).toContain(e.id)
      expect(EXTEND_DURATION_SECONDS[e.id as keyof typeof EXTEND_DURATION_SECONDS], e.id).toEqual(e.durations)
    }
  })

  it("Seedance 2.5 adds 4–30 s, Seedance 2.0 4–15 s, Kling 4 3–30 s", () => {
    expect(EXTEND_DURATION_SECONDS["seedance-2-5-extend"]).toEqual(range(4, 30))
    expect(EXTEND_DURATION_SECONDS["seedance-2-0-extend"]).toEqual(range(4, 15))
    expect(EXTEND_DURATION_SECONDS["kling-4-extend"]).toEqual(range(3, 30))
  })

  it("LTX 2.3 Pro takes its own 1–20 s, never its generation model's 6/8/10", () => {
    expect(EXTEND_DURATION_SECONDS["ltx-2.3-pro"]).toEqual(range(LTX_EXTEND_DURATION.MIN_SEC, LTX_EXTEND_DURATION.MAX_SEC))
    expect(EXTEND_DURATION_SECONDS["ltx-2.3-pro"]).toEqual(range(1, 20))
  })

  it("VEO and Runway keep the 1–20 s the route has always accepted (they add a length of their own)", () => {
    expect(EXTEND_DURATION_SECONDS["veo-extend"]).toEqual(range(1, 20))
    expect(EXTEND_DURATION_SECONDS["runway-extend"]).toEqual(range(1, 20))
  })

  it("the schema's ceiling is the longest any provider adds", () => {
    expect(EXTEND_DURATION_MAX_SEC).toBe(30)
  })
})

describe("describeSeconds", () => {
  it("a run of whole seconds reads as a range, a set as a list", () => {
    expect(describeSeconds(range(4, 15))).toBe("4–15 seconds")
    expect(describeSeconds([6, 10])).toBe("6 or 10 seconds")
    expect(describeSeconds([5, 8, 10])).toBe("5, 8 or 10 seconds")
    expect(describeSeconds([6])).toBe("6 seconds")
  })
})
