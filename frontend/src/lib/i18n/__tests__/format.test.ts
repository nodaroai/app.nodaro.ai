import { describe, it, expect, afterEach } from "vitest"
import { useLocaleStore } from "@/lib/locale-store"
import { formatDate, formatDateTime, formatNumber, formatTime, uiLocale } from "../format"
import * as barrel from ".."

const initial = useLocaleStore.getState()
const setLocale = (locale: typeof initial.locale) => useLocaleStore.setState({ locale })
afterEach(() => useLocaleStore.setState(initial, true))

const HEBREW_LETTER = /[א-ת]/
const AUG_12 = new Date(2026, 7, 12, 15, 4, 5)

describe("uiLocale", () => {
  it("is undefined for English (the browser default) and the locale id otherwise", () => {
    setLocale("en")
    expect(uiLocale()).toBeUndefined()
    setLocale("he")
    expect(uiLocale()).toBe("he")
    setLocale("pt-BR")
    expect(uiLocale()).toBe("pt-BR")
  })

  it("reads the live locale at call time, not a value frozen at import", () => {
    setLocale("he")
    expect(uiLocale()).toBe("he")
    setLocale("ja")
    expect(uiLocale()).toBe("ja")
  })
})

describe("formatting in Hebrew", () => {
  it("prints Hebrew month names", () => {
    setLocale("he")
    const out = formatDate(AUG_12, { month: "short" })
    expect(out).toMatch(HEBREW_LETTER)
    expect(out).toBe(AUG_12.toLocaleDateString("he", { month: "short" }))
  })

  it("passes options through unchanged to every helper", () => {
    setLocale("he")
    const opts = { month: "short", day: "numeric", year: "numeric" } as const
    expect(formatDate(AUG_12, opts)).toBe(AUG_12.toLocaleDateString("he", opts))
    expect(formatTime(AUG_12, { hour: "2-digit", minute: "2-digit" })).toBe(
      AUG_12.toLocaleTimeString("he", { hour: "2-digit", minute: "2-digit" }),
    )
    expect(formatDateTime(AUG_12)).toBe(AUG_12.toLocaleString("he"))
    expect(formatNumber(1234567.5)).toBe((1234567.5).toLocaleString("he"))
  })

  it("accepts a Date, an ISO string or epoch millis alike", () => {
    setLocale("he")
    const iso = AUG_12.toISOString()
    const ms = AUG_12.getTime()
    expect(formatDate(iso)).toBe(formatDate(AUG_12))
    expect(formatDate(ms)).toBe(formatDate(AUG_12))
  })
})

describe("formatting in English is byte-identical to the bare native calls", () => {
  it("dates, times, date-times and numbers", () => {
    setLocale("en")
    expect(formatDate(AUG_12)).toBe(AUG_12.toLocaleDateString())
    expect(formatDate(AUG_12, { month: "short" })).toBe(AUG_12.toLocaleDateString(undefined, { month: "short" }))
    expect(formatTime(AUG_12)).toBe(AUG_12.toLocaleTimeString())
    expect(formatTime(AUG_12, { hour: "2-digit", minute: "2-digit" })).toBe(
      AUG_12.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    )
    // toLocaleString with no options prints the date AND the time.
    expect(formatDateTime(AUG_12)).toBe(AUG_12.toLocaleString())
    expect(formatNumber(1234567.5)).toBe((1234567.5).toLocaleString())
  })

  it("an unparseable date still reads the way the native call does", () => {
    setLocale("en")
    expect(formatDate("not a date")).toBe(new Date("not a date").toLocaleDateString())
  })
})

describe("barrel", () => {
  it("re-exports the helpers from @/lib/i18n", () => {
    expect(barrel.uiLocale).toBe(uiLocale)
    expect(barrel.formatDate).toBe(formatDate)
    expect(barrel.formatTime).toBe(formatTime)
    expect(barrel.formatDateTime).toBe(formatDateTime)
    expect(barrel.formatNumber).toBe(formatNumber)
  })
})
