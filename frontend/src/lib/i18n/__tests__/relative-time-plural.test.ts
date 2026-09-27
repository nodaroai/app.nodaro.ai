import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { useLocaleStore } from "@/lib/locale-store"
import { formatRelative } from ".."

/**
 * "{n} months ago" spelled out needs a singular in languages that inflect it:
 * Portuguese reads "há 1 mês", never "há 1 meses". formatRelative picks
 * time.moAgoOne for exactly one month.
 */
const NOW = new Date("2026-09-27T12:00:00Z").getTime()
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  useLocaleStore.setState({ locale: "en" })
})

describe("formatRelative — one month vs several", () => {
  it("Portuguese uses the singular for one month and the plural for more", () => {
    useLocaleStore.setState({ locale: "pt-BR" })
    expect(formatRelative(daysAgo(40))).toBe("há 1 mês")
    expect(formatRelative(daysAgo(70))).toBe("há 2 meses")
  })

  it("English keeps its abbreviation either way", () => {
    useLocaleStore.setState({ locale: "en" })
    expect(formatRelative(daysAgo(40))).toBe("1mo ago")
    expect(formatRelative(daysAgo(70))).toBe("2mo ago")
  })
})
