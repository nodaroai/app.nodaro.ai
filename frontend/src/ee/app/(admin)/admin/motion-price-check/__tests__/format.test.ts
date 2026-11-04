// @vitest-environment node
/**
 * Admin → Motion price check: how its figures and its date range read.
 *
 * - Dollars carry four decimals under one dollar (a step costs fractions of a
 *   cent) and two from one, the minus before the sign; credits and percentages
 *   are grouped the English way. A figure that is not there reads "—".
 * - The range is local days: the default is the last seven, today included;
 *   a range is sent as local midnights, To's whole day included; at most 30
 *   days, counted by the calendar (inclusive).
 */
import { describe, expect, it } from "vitest"
import {
  MAX_RANGE_DAYS,
  defaultRange,
  engineLabel,
  formatClock,
  formatCount,
  formatCredits,
  formatPct,
  formatSeconds,
  formatUsd,
  formatWhen,
  rangeProblem,
  rangeToIso,
  resolutionLabel,
  styleLabel,
} from "../format"

describe("Motion price check — figures", () => {
  it("dollars: four decimals under one, two from one, the minus before the sign", () => {
    expect(formatUsd(null)).toBe("—")
    expect(formatUsd(0.0123)).toBe("$0.0123")
    expect(formatUsd(12.3456)).toBe("$12.35")
    expect(formatUsd(-4.72)).toBe("-$4.72")
    expect(formatUsd(1234.5)).toBe("$1,234.50")
    expect(formatUsd(0)).toBe("$0.00")
    // A figure that rounds to nothing carries no minus.
    expect(formatUsd(-0.00001)).toBe("$0.00")
  })

  it("credits, counts, seconds and percentages, grouped the English way", () => {
    expect(formatCredits(1063)).toBe("1,063")
    expect(formatCredits(null)).toBe("—")
    expect(formatCount(10_001)).toBe("10,001")
    expect(formatSeconds(12.4)).toBe("12.4")
    expect(formatSeconds(12)).toBe("12")
    expect(formatSeconds(null)).toBe("—")
    expect(formatPct(41.2041)).toBe("41.2%")
    expect(formatPct(-1685.7143)).toBe("-1,685.7%")
    expect(formatPct(null)).toBe("—")
  })

  it("names engines, styles and resolutions; a draft's resolution says so", () => {
    expect(engineLabel("prism")).toBe("Prism")
    expect(engineLabel("pulse")).toBe("Pulse")
    expect(styleLabel("flex")).toBe("Flex")
    expect(styleLabel("precise")).toBe("Precise")
    // A name the page does not know reads as it came, never through a prototype.
    expect(engineLabel("constructor")).toBe("constructor")
    expect(resolutionLabel("480p", true)).toBe("480p (draft)")
    expect(resolutionLabel("720p", false)).toBe("720p")
    expect(resolutionLabel(null, false)).toBe("—")
  })

  it("times read in local time", () => {
    expect(formatWhen(new Date(2026, 10, 2, 9, 5).toISOString())).toBe("2026-11-02 09:05")
    expect(formatClock(new Date(2026, 10, 3, 12, 0).toISOString())).toBe("12:00")
    expect(formatWhen("not a time")).toBe("—")
  })
})

describe("Motion price check — the range", () => {
  it("defaults to the last seven local days, today included", () => {
    expect(defaultRange(new Date(2026, 10, 3, 12))).toEqual({ fromDay: "2026-10-28", toDay: "2026-11-03" })
    // Just after local midnight it is still that local day, never the UTC one.
    expect(defaultRange(new Date(2026, 10, 3, 0, 5))).toEqual({ fromDay: "2026-10-28", toDay: "2026-11-03" })
  })

  it("is sent as local midnights, To's whole day included", () => {
    const range = rangeToIso("2026-10-28", "2026-11-03")
    expect(range.from).toBe(new Date(2026, 9, 28).toISOString())
    expect(range.to).toBe(new Date(2026, 10, 4).toISOString())
  })

  it("takes at most 30 days, counted by the calendar", () => {
    expect(MAX_RANGE_DAYS).toBe(30)
    expect(rangeProblem("2026-11-03", "2026-11-03")).toBeNull()
    expect(rangeProblem("2026-10-05", "2026-11-03")).toBeNull()
    expect(rangeProblem("2026-10-04", "2026-11-03")).toBe("Pick 30 days or fewer")
    expect(rangeProblem("2026-09-25", "2026-11-03")).toBe("Pick 30 days or fewer")
  })

  it("names a range that cannot be read", () => {
    expect(rangeProblem("2026-11-04", "2026-11-03")).toBe("From must be on or before To")
    expect(rangeProblem("", "2026-11-03")).toBe("Pick a From and a To day")
    expect(rangeProblem("2026-11-03", "")).toBe("Pick a From and a To day")
    expect(rangeProblem("2026-02-30", "2026-03-03")).toBe("Pick a From and a To day")
  })
})
