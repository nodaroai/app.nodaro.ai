import { describe, expect, it } from "vitest"
import {
  seedanceExtendAddedSec,
  seedanceExtendFullWindowCreditId,
  seedanceExtendRefusesSource,
  seedanceExtendSentSec,
  seedanceExtendSourceCreditId,
  seedanceExtendSourceSec,
  seedanceExtendUnits,
  tailExtendCreditId,
} from "../entries/credits.js"

/**
 * `seedanceExtendSourceCreditId` (decided 2026-11-13): the ONE whole-run quote
 * id a Seedance 2.5 Extend run on a known source is charged, by the seconds
 * rule the server charges it by — units = (seconds sent + seconds added) ÷ 2,
 * the seconds sent the source's picture read by the container-overhang rule,
 * at most 10. Its parity with the server's charge is held in the backend
 * (`seedance-extend-source-quote.test.ts`), where the server's quote
 * resolution runs.
 */

const RESOLUTIONS = [undefined, "480p", "720p", "1080p", "4k"] as const
const DURATIONS = [undefined, 1, 4, 8, 12, 30, 45, "12", -1] as const

describe("seedanceExtendSourceCreditId", () => {
  it.each([
    // [source picture s, seconds added, resolution, id]
    [1.8, 4, "480p", "seedance-2-5-extend:480p:per-2s:2.9u"],
    [4, 8, "720p", "seedance-2-5-extend:720p:per-2s:6u"],
    // 8.04 s is a whole 8 s by the container-overhang rule; 8.3 s counts as measured.
    [8.04, 8, "720p", "seedance-2-5-extend:720p:per-2s:8u"],
    [8.3, 8, "720p", "seedance-2-5-extend:720p:per-2s:8.15u"],
    // At most the 10 s window is sent: 10.05 s reads as 10 s, 25 s sends its last 10.
    [10.05, 30, "1080p", "seedance-2-5-extend:1080p:per-2s:20u"],
    [25, 4, "1080p", "seedance-2-5-extend:1080p:per-2s:7u"],
  ] as const)("a %s s source, %s s added at %s: %s", (source, added, resolution, id) => {
    expect(seedanceExtendSourceCreditId(source, added, resolution)).toBe(id)
  })

  it("a source the extend refuses (a measured picture under 1.8 s) names no id, whatever the seconds added", () => {
    for (const [source, added] of [[1.7, 4], [1.7, 8], [1.0, 8], [0.5, 30], [1.79, 30]] as const) {
      expect(seedanceExtendSourceCreditId(source, added, "720p"), `${source} s + ${added} s`).toBeUndefined()
    }
    expect(seedanceExtendSourceCreditId(1.8, 8, "720p")).toBe("seedance-2-5-extend:720p:per-2s:4.9u")
    expect([1.79, 1.8, undefined, 0].map(seedanceExtendRefusesSource)).toEqual([true, false, false, false])
  })

  it("a length not known or unreadable names the full-window id, string for string", () => {
    for (const unknown of [undefined, null, Number.NaN, 0, -1, -0.5, Number.POSITIVE_INFINITY]) {
      for (const duration of DURATIONS) {
        for (const resolution of RESOLUTIONS) {
          expect(seedanceExtendSourceCreditId(unknown, duration, resolution), `${String(unknown)} ${String(duration)} ${String(resolution)}`)
            .toBe(seedanceExtendFullWindowCreditId(duration, resolution))
        }
      }
    }
    // …which is what every client's builder names for a Seedance 2.5 extend.
    expect(seedanceExtendFullWindowCreditId(8, "720p")).toBe(tailExtendCreditId("seedance-2-5-extend", 8, "720p"))
    expect(seedanceExtendFullWindowCreditId(8, "720p")).toBe("seedance-2-5-extend:720p:per-2s:9u")
  })

  it("a source of 10 s or longer is the full window: the most a run sends", () => {
    for (const source of [10, 10.2, 12, 25, 3600]) {
      expect(seedanceExtendSourceCreditId(source, 8, "720p")).toBe(seedanceExtendFullWindowCreditId(8, "720p"))
    }
  })

  it("is the seconds rule, composed: units = (sent + added) ÷ 2 on the resolution's two-second row", () => {
    for (const source of [1.8, 2, 4.37, 6.04, 8.25, 8.26, 9.99]) {
      for (const duration of DURATIONS) {
        const units = seedanceExtendUnits(seedanceExtendSentSec(source), seedanceExtendAddedSec("seedance-2-5-extend", duration))
        expect(seedanceExtendSourceCreditId(source, duration, "1080p")).toBe(`seedance-2-5-extend:1080p:per-2s:${String(units)}u`)
      }
    }
  })
})

describe("the seconds rule (moved from @nodaro/render-rules, unchanged)", () => {
  it("reads a picture by the container-overhang rule, then caps it at the 10 s window", () => {
    expect([8.04, 8.25, 8.26, 8.3, 4.37, 0.5, 1.2].map(seedanceExtendSourceSec)).toEqual([8, 8, 8.26, 8.3, 4.37, 0.5, 1])
    expect([1.8, 8.04, 10.05, 25, undefined, null, 0, Number.NaN].map(seedanceExtendSentSec)).toEqual([1.8, 8, 10, 10, 10, 10, 10, 10])
  })

  it("adds the requested seconds held in the catalog window (default 8 s), for every tail-recipe provider", () => {
    expect([undefined, 1, 4, 30, 45, "12", "abc"].map((d) => seedanceExtendAddedSec("seedance-2-5-extend", d))).toEqual([8, 4, 4, 30, 30, 12, 8])
    expect(seedanceExtendAddedSec("kling-4-extend", undefined)).toBe(5)
  })
})
