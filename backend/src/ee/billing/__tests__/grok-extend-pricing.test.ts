// @test-units-by-name names no node unit: it reads only the grok-extend rows of STATIC_CREDIT_COSTS (extend-video is a legacy node)
import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * Grok Extend — the Extend Video provider `grok-extend`. Grok extends only its
 * own clips, by 6 or 10 seconds, and bills the seconds it adds at the
 * SOURCE's resolution (480p or 720p, the two Grok Imagine renders here). So
 * one row per length added × source resolution, and no bare id: a run always
 * names both. The seed migration seeds the same rows
 * (static-costs-match-migrations.test.ts and
 * credit-pricing-migration-sync.test.ts hold the two together).
 */
const ID = "grok-extend"
const ROWS: Record<string, number> = {
  "grok-extend:6s:480p": 40,
  "grok-extend:6s:720p": 70,
  "grok-extend:10s:480p": 60,
  "grok-extend:10s:720p": 120,
}

describe("grok-extend static credits", () => {
  it("prices 6 s and 10 s added at a 480p and a 720p source", () => {
    for (const [id, credits] of Object.entries(ROWS)) {
      expect(STATIC_CREDIT_COSTS[id], id).toBe(credits)
    }
  })

  it("carries exactly the 2 × 2 = 4 rows — no bare id, no other length or resolution", () => {
    const keys = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === ID || k.startsWith(`${ID}:`))
    expect(keys.sort()).toEqual(Object.keys(ROWS).sort())
    expect(keys).not.toContain(ID)
  })

  it("never costs less for more: longer or from a sharper source is dearer", () => {
    for (const res of ["480p", "720p"]) {
      expect(STATIC_CREDIT_COSTS[`${ID}:10s:${res}`]!, res).toBeGreaterThan(STATIC_CREDIT_COSTS[`${ID}:6s:${res}`]!)
    }
    for (const sec of ["6s", "10s"]) {
      expect(STATIC_CREDIT_COSTS[`${ID}:${sec}:720p`]!, sec).toBeGreaterThan(STATIC_CREDIT_COSTS[`${ID}:${sec}:480p`]!)
    }
  })

  it("every row is a whole number of tens", () => {
    for (const id of Object.keys(ROWS)) {
      expect(STATIC_CREDIT_COSTS[id]! % 10, id).toBe(0)
    }
  })
})
