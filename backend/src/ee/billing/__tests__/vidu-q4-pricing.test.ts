// @test-units-by-name looks up only the vidu-q4 credit rows it names
import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { PRICING_DEFAULT_RESOLUTION } from "@nodaro/shared/models"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * Vidu Q4 — ONE per-second ladder for both KIE endpoints and for audio on or
 * off: credits = the tier's per-second base rate × seconds, rounded UP to the
 * next 10 (the minimax-h3 / seedance-2-5 rule). One row per second (3-16s)
 * because the tier lookup snaps UP and commit_credits never collects a
 * shortfall. Migration 533 seeds the same 71 rows (pinned value-for-value by
 * credit-pricing-migration-sync.test.ts).
 */

const BASE_PER_SECOND: Record<string, number> = { "540p": 18, "720p": 38, "1080p": 48, "2k": 76, "4k": 156 }
const DURATIONS = Array.from({ length: 14 }, (_, i) => i + 3)
const ladder = (perSecond: number, sec: number) => Math.ceil((perSecond * sec) / 10) * 10

describe("vidu-q4 static credits", () => {
  it("prices every (duration, resolution) row by the ladder rule", () => {
    for (const [res, perSecond] of Object.entries(BASE_PER_SECOND)) {
      for (const d of DURATIONS) {
        expect(STATIC_CREDIT_COSTS[`vidu-q4:${d}s:${res}`], `vidu-q4:${d}s:${res}`).toBe(ladder(perSecond, d))
      }
    }
  })

  it("carries exactly the bare id plus 70 composites", () => {
    const keys = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === "vidu-q4" || k.startsWith("vidu-q4:"))
    expect(keys).toHaveLength(71)
  })

  it("matches the worked examples", () => {
    expect(["540p", "720p", "1080p", "2k", "4k"].map((r) => STATIC_CREDIT_COSTS[`vidu-q4:5s:${r}`])).toEqual([90, 190, 240, 380, 780])
    expect(STATIC_CREDIT_COSTS["vidu-q4:3s:540p"]).toBe(60)
    expect(STATIC_CREDIT_COSTS["vidu-q4:16s:4k"]).toBe(2500)
  })

  it("the bare id equals the default render it stands for (5s @ 720p)", () => {
    expect(PRICING_DEFAULT_RESOLUTION["vidu-q4"]).toBe("720p")
    expect(STATIC_CREDIT_COSTS["vidu-q4"]).toBe(STATIC_CREDIT_COSTS["vidu-q4:5s:720p"])
    expect(STATIC_CREDIT_COSTS["vidu-q4"]).toBe(190)
  })

  it("every id the builder can emit is priced (no price_not_configured)", () => {
    for (const d of [undefined, 1, 2, ...DURATIONS, 17, 40]) {
      for (const r of [undefined, "540p", "720p", "1080p", "2k", "4k", "2K", "4K", "480p", "garbage"]) {
        for (const sound of [undefined, true, false]) {
          const id = buildVideoCreditModelIdentifier("vidu-q4", d, sound, "image-to-video", undefined, r)
          expect(STATIC_CREDIT_COSTS[id], `${id} (d=${d}, r=${r})`).toBeTypeOf("number")
        }
      }
    }
  })

  it("every catalog pricing row agrees with the static table", () => {
    for (const row of MODEL_CATALOG["vidu-q4"]!.pricing) {
      expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })
})
