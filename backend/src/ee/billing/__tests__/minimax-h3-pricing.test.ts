import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

// KIE 36.5 cr/s @2K (docs.kie.ai/market/minimax-h3, 2026-08-01) and 22.5 cr/s
// @768P (resolution lever added 2026-08-03; verified on kie.ai/minimax-h3).
// Nodaro credits = ceil(rate × duration / 4) × 10 — same conversion as Seedance-2.
// Bare ids are the 2K rate (byte-identical to the pre-lever rows so existing
// workflows/overrides keep their ids); ":768p" appends the cheaper tier.
describe("minimax-h3 static credits — per-second at the 2K (bare) rate", () => {
  const expected: Record<string, number> = {
    "minimax-h3": 550, // base fallback = 6s @2K (the KIE default duration + resolution)
    "minimax-h3:4s": 370,
    "minimax-h3:5s": 460,
    "minimax-h3:6s": 550,
    "minimax-h3:7s": 640,
    "minimax-h3:8s": 730,
    "minimax-h3:9s": 830,
    "minimax-h3:10s": 920,
    "minimax-h3:11s": 1010,
    "minimax-h3:12s": 1100,
    "minimax-h3:13s": 1190,
    "minimax-h3:14s": 1280,
    "minimax-h3:15s": 1370,
  }
  for (const [id, credits] of Object.entries(expected)) {
    it(`${id} = ${credits}`, () => { expect(STATIC_CREDIT_COSTS[id]).toBe(credits) })
  }
})

describe("minimax-h3 static credits — per-second at the 768P rate (ceil(22.5 × d / 4) × 10)", () => {
  const expected: Record<string, number> = {
    "minimax-h3:4s:768p": 230,
    "minimax-h3:5s:768p": 290,
    "minimax-h3:6s:768p": 340,
    "minimax-h3:7s:768p": 400,
    "minimax-h3:8s:768p": 450,
    "minimax-h3:9s:768p": 510,
    "minimax-h3:10s:768p": 570,
    "minimax-h3:11s:768p": 620,
    "minimax-h3:12s:768p": 680,
    "minimax-h3:13s:768p": 740,
    "minimax-h3:14s:768p": 790,
    "minimax-h3:15s:768p": 850,
  }
  for (const [id, credits] of Object.entries(expected)) {
    it(`${id} = ${credits}`, () => { expect(STATIC_CREDIT_COSTS[id]).toBe(credits) })
  }

  it("every 768P tier derives from the SAME ceil formula as the seeded value", () => {
    for (let d = 4; d <= 15; d++) {
      expect(STATIC_CREDIT_COSTS[`minimax-h3:${d}s:768p`]).toBe(Math.ceil((22.5 * d) / 4) * 10)
    }
  })

  it("every 2K tier still matches its formula (36.5 cr/s — unchanged by the lever)", () => {
    for (let d = 4; d <= 15; d++) {
      expect(STATIC_CREDIT_COSTS[`minimax-h3:${d}s`]).toBe(Math.ceil((36.5 * d) / 4) * 10)
    }
  })
})

describe("minimax-h3 has NO other resolution and NO -ref composites (2K rides the bare id; ref billing is the compute hook)", () => {
  // Proves the two-tier design: bare = 2K, ":768p" = the only suffix. Any
  // other id appearing later means someone re-introduced a lever without going
  // through the catalog + identifier + hook chain — and the identifier builder
  // would never emit it.
  const phantom = [
    "minimax-h3:8s:480p",
    "minimax-h3:8s:720p",
    "minimax-h3:8s:1080p",
    "minimax-h3:8s:2k",
    "minimax-h3:8s:2K",
    "minimax-h3:8s:768P",
    "minimax-h3:8s:4k",
    "minimax-h3:8s-ref",
    "minimax-h3:8s:720p-ref",
    "minimax-h3:8s:768p-ref",
    "minimax-h3:8s:2k-ref",
  ]
  for (const id of phantom) {
    it(`${id} is undefined`, () => { expect(STATIC_CREDIT_COSTS[id]).toBeUndefined() })
  }
})
