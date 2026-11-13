// @test-units-by-name names no node unit: it reads only the pixverse-v6-extend rows of STATIC_CREDIT_COSTS (extend-video is a legacy node)
import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * PixVerse V6 Extend — the Extend Video provider `pixverse-v6-extend`. One row
 * per second added (1–15 s) at each quality (360p / 540p / 720p / 1080p), each
 * with an `:audio` twin (the sound switch changes the price). Every row is the
 * seconds added × the quality's base credits a second, rounded up to the next
 * 10 — the per-second ladder rule. The bases are whole numbers, so the rule
 * runs in integers and a float can never move a row. The seed migration
 * seeds the same rows (static-costs-match-migrations.test.ts and
 * credit-pricing-migration-sync.test.ts hold the two together).
 */
const ID = "pixverse-v6-extend"
const SECONDS = Array.from({ length: 15 }, (_, i) => i + 1)
const QUALITIES = ["360p", "540p", "720p", "1080p"] as const
type Quality = (typeof QUALITIES)[number]
/** Base credits a second added: [silent, with sound]. */
const BASE_PER_SEC: Record<Quality, readonly [silent: number, sound: number]> = {
  "360p": [10, 14],
  "540p": [14, 18],
  "720p": [18, 24],
  "1080p": [36, 46],
}
const ladder = (q: Quality, sec: number, sound: boolean) => Math.ceil((BASE_PER_SEC[q][sound ? 1 : 0] * sec) / 10) * 10
const rowId = (q: string, sec: number, sound: boolean) => `${ID}:${sec}s:${q}${sound ? ":audio" : ""}`

describe("pixverse-v6-extend static credits", () => {
  it("prices every second 1-15 at every quality, silent and with sound, by the ladder rule", () => {
    for (const q of QUALITIES) {
      for (const s of SECONDS) {
        for (const sound of [false, true]) {
          expect(STATIC_CREDIT_COSTS[rowId(q, s, sound)], rowId(q, s, sound)).toBe(ladder(q, s, sound))
        }
      }
    }
  })

  it("spot rows: 5 s at 540p with sound is 90, 15 s at 1080p with sound is 690, 1 s at 360p is 10", () => {
    expect(STATIC_CREDIT_COSTS["pixverse-v6-extend:5s:540p:audio"]).toBe(90)
    expect(STATIC_CREDIT_COSTS["pixverse-v6-extend:5s:720p"]).toBe(90)
    expect(STATIC_CREDIT_COSTS["pixverse-v6-extend:15s:1080p:audio"]).toBe(690)
    // A 1 s clip still rounds up to a whole 10.
    expect(STATIC_CREDIT_COSTS["pixverse-v6-extend:1s:360p"]).toBe(10)
  })

  it("carries exactly 15 × 4 × 2 = 120 rows — no bare id, nothing past 15 s, no other quality or suffix", () => {
    const keys = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === ID || k.startsWith(`${ID}:`))
    expect(keys).toHaveLength(120)
    expect(keys).not.toContain(ID)
    expect(keys.every((k) => /^pixverse-v6-extend:([1-9]|1[0-5])s:(360p|540p|720p|1080p)(:audio)?$/.test(k)), keys.join(", ")).toBe(true)
  })

  it("never costs less for more: longer, sharper or with sound is the same or dearer", () => {
    for (const q of QUALITIES) {
      for (const s of SECONDS) {
        expect(STATIC_CREDIT_COSTS[rowId(q, s, true)]!, `${s}s ${q} sound ≥ silent`).toBeGreaterThanOrEqual(STATIC_CREDIT_COSTS[rowId(q, s, false)]!)
        if (s > 1) {
          for (const sound of [false, true]) {
            expect(STATIC_CREDIT_COSTS[rowId(q, s, sound)]!, `${s}s ${q}`).toBeGreaterThan(STATIC_CREDIT_COSTS[rowId(q, s - 1, sound)]!)
          }
        }
      }
    }
    for (let i = 1; i < QUALITIES.length; i++) {
      for (const s of SECONDS) {
        for (const sound of [false, true]) {
          expect(STATIC_CREDIT_COSTS[rowId(QUALITIES[i]!, s, sound)]!, `${s}s ${QUALITIES[i]}`).toBeGreaterThanOrEqual(STATIC_CREDIT_COSTS[rowId(QUALITIES[i - 1]!, s, sound)]!)
        }
      }
    }
  })
})
