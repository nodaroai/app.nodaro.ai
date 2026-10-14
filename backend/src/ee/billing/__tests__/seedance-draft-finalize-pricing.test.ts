import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, seedanceDraftFinalizeCreditId } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { seedanceDraftFinalizeRefBaseCredits } from "../seedance2-ref-video-credits.js"

/**
 * Seedance 2.5 Draft finalize (`seedance-2-5-hd`) pricing guard.
 *
 * The finalize re-renders a draft at 1080p at the draft's own length, billed
 * per output second, or — for a draft made with a reference video — on input +
 * output seconds. Same conversion as the generation ladder:
 *   credits = ceil(rate × billable seconds / 4) × 10
 * with rate 158 (no reference video) and 95 (reference video). The worked
 * examples below are the paid probes of 2026-10-12, and the public docs
 * (docs/nodes/processing-video/video-upscale.md) quote the same numbers.
 */
const NO_REF_RATE = 158
const REF_RATE = 95
const formula = (rate: number, seconds: number) => Math.ceil((rate * seconds) / 4) * 10

describe("seedance-2-5-hd rows", () => {
  it("one row per output second, 4-30 s, plus a -ref twin, all on the formula", () => {
    for (let n = 4; n <= 30; n++) {
      expect(STATIC_CREDIT_COSTS[`seedance-2-5-hd:${n}s`], `${n}s`).toBe(formula(NO_REF_RATE, n))
      expect(STATIC_CREDIT_COSTS[`seedance-2-5-hd:${n}s-ref`], `${n}s-ref`).toBe(formula(REF_RATE, n))
    }
    expect(STATIC_CREDIT_COSTS["seedance-2-5-hd"]).toBe(STATIC_CREDIT_COSTS["seedance-2-5-hd:8s"])
  })

  it("the catalog's listed rows agree with STATIC_CREDIT_COSTS", () => {
    for (const row of MODEL_CATALOG["seedance-2-5-hd"]!.pricing ?? []) {
      expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })

  it("migration 504 seeds every row at the STATIC value", () => {
    const sql = readFileSync(
      join(__dirname, "..", "..", "..", "..", "..", "supabase/migrations/504_seedance_draft_finalize_pricing.sql"),
      "utf8",
    )
    const seeded = new Map([...sql.matchAll(/\('(seedance-2-5-hd[^']*)',\s*(\d+),/g)].map((m) => [m[1]!, Number(m[2])]))
    const staticIds = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === "seedance-2-5-hd" || k.startsWith("seedance-2-5-hd:"))
    expect(staticIds.length).toBe(1 + 27 * 2)
    for (const id of staticIds) expect(seeded.get(id), id).toBe(STATIC_CREDIT_COSTS[id])
    expect(seeded.size).toBe(staticIds.length)
  })
})

describe("the documented worked examples (docs/nodes/processing-video/video-upscale.md)", () => {
  it("no reference video: ceil(39.5 × s) × 10", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2-5-hd:4s"]).toBe(1580)
    expect(STATIC_CREDIT_COSTS["seedance-2-5-hd:5s"]).toBe(1980)
    expect(STATIC_CREDIT_COSTS["seedance-2-5-hd:8s"]).toBe(3160)
    expect(STATIC_CREDIT_COSTS["seedance-2-5-hd:30s"]).toBe(11850)
  })

  it("with a reference video: ceil(237.5 × (reference + draft seconds))", () => {
    expect(seedanceDraftFinalizeRefBaseCredits({ outputSec: 4, refVideoDurationsSec: [4] })).toBe(1900)
    expect(seedanceDraftFinalizeRefBaseCredits({ outputSec: 10, refVideoDurationsSec: [10] })).toBe(4750)
  })

  it("the cheapest draft: the shortest accepted reference clip (2 s) into a 4 s draft → 1425, below 1580", () => {
    expect(seedanceDraftFinalizeRefBaseCredits({ outputSec: 4, refVideoDurationsSec: [2] })).toBe(1425)
    expect(1425).toBeLessThan(STATIC_CREDIT_COSTS["seedance-2-5-hd:4s"]!)
  })
})

describe("measured worked examples", () => {
  it("4 s draft, no reference video → 1580 credits", () => {
    const id = seedanceDraftFinalizeCreditId(4.04, false)
    expect(id).toBe("seedance-2-5-hd:4s")
    expect(STATIC_CREDIT_COSTS[id]).toBe(1580)
  })

  it("4 s reference clip in + 4 s out → 1900 credits (input + output seconds)", () => {
    expect(seedanceDraftFinalizeCreditId(4.04, true)).toBe("seedance-2-5-hd:4s-ref")
    // The draft's own probe reads a hair over 4 s; the provider bills whole seconds.
    expect(seedanceDraftFinalizeRefBaseCredits({ outputSec: 4, refVideoDurationsSec: [4.04] })).toBe(1900)
    expect(seedanceDraftFinalizeRefBaseCredits({ outputSec: 4, refVideoDurationsSec: [4] })).toBe(formula(REF_RATE, 8))
  })

  it("a reference run scales with the span: 10 s clip edited into 10 s → rate × 20 s", () => {
    expect(seedanceDraftFinalizeRefBaseCredits({ outputSec: 10, refVideoDurationsSec: [10] })).toBe(formula(REF_RATE, 20))
  })

  it("an unreadable reference probe is charged at the per-clip worst case, never less", () => {
    const worst = seedanceDraftFinalizeRefBaseCredits({ outputSec: 4, refVideoDurationsSec: [null] })
    expect(worst).toBeGreaterThan(seedanceDraftFinalizeRefBaseCredits({ outputSec: 4, refVideoDurationsSec: [4] }))
  })

  it("draft first pays off from two attempts (credits, 4 s, no reference video)", () => {
    const draft480 = STATIC_CREDIT_COSTS["seedance-2-5:4s:480p"]!
    const direct1080 = STATIC_CREDIT_COSTS["seedance-2-5:4s:1080p"]!
    const finalize = STATIC_CREDIT_COSTS["seedance-2-5-hd:4s"]!
    expect(draft480).toBe(280)
    expect(direct1080).toBe(1140)
    // One attempt: a direct 1080p is cheaper. Two attempts: drafting first wins.
    expect(draft480 + finalize).toBeGreaterThan(direct1080)
    expect(2 * draft480 + finalize).toBeLessThan(2 * direct1080)
  })
})
