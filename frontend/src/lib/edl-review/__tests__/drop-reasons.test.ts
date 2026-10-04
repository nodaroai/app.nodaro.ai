import { describe, it, expect } from "vitest"
import { translate } from "@/lib/i18n"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"
import { ja } from "@/lib/i18n/ja"
import { ko } from "@/lib/i18n/ko"
import { ptBR } from "@/lib/i18n/pt-br"
import { DROP_REASONS, dropReasonLabel, dropReasonStyle, isKnownDropReason } from "../drop-reasons"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

describe("the drop-reason display registry", () => {
  it("covers every reason Edit Plan writes, plus the reviewer's own manual cut", () => {
    expect([...DROP_REASONS].sort()).toEqual(["false-start", "filler", "manual", "no-picture", "silence", "tangent"])
  })

  it("labels each reason in all five complete dictionaries", () => {
    for (const reason of DROP_REASONS) {
      const label = dropReasonLabel(reason, t)
      expect(label, reason).not.toBe(reason)
      for (const [locale, dict] of [["en", en], ["he", he], ["ja", ja], ["ko", ko], ["pt-br", ptBR]] as const) {
        const value = dropReasonLabel(reason, (key) => (dict as Record<string, string>)[key] ?? "")
        expect(value, `${locale}: ${reason}`).not.toBe("")
      }
    }
    expect(dropReasonLabel("false-start", t)).toBe("False start")
    expect(dropReasonLabel("no-picture", (key) => translate("he", key))).toBe("אין תמונה")
  })

  it("gives each reason its own strike colour, as literal Tailwind classes", () => {
    const strikes = DROP_REASONS.map((r) => dropReasonStyle(r).strike)
    expect(new Set(strikes).size).toBe(DROP_REASONS.length)
    for (const reason of DROP_REASONS) {
      const style = dropReasonStyle(reason)
      expect(style.strike, reason).toMatch(/\bline-through\b/)
      expect(style.strike, reason).toMatch(/\bdecoration-[a-z]+-\d{3}\b/)
      expect(style.swatch, reason).toMatch(/^bg-[a-z]+-\d{3}$/)
      expect(style.chip, reason).toMatch(/\bdark:text-[a-z]+-\d{3}\b/)
    }
  })

  it("an unknown reason (a newer planner's) falls back: shown as written, in a neutral style of its own", () => {
    expect(isKnownDropReason("breath")).toBe(false)
    expect(isKnownDropReason("filler")).toBe(true)
    expect(dropReasonLabel("breath", t)).toBe("breath")
    const fallback = dropReasonStyle("breath")
    expect(DROP_REASONS.map((r) => dropReasonStyle(r).strike)).not.toContain(fallback.strike)
    expect(dropReasonStyle("toString")).toEqual(fallback)
    expect(dropReasonLabel("toString", t)).toBe("toString")
  })

  it("a blank reason reads as Other", () => {
    expect(dropReasonLabel("", t)).toBe("Other")
    expect(dropReasonLabel("  ", (key) => translate("ja", key))).toBe("その他")
  })
})
