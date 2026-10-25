/**
 * A render run button's price (Render final, Update preview — on the render
 * node's bar, the review's buttons and banners, the Clip Pack's footer, an
 * app's review): " · {credits}" on a credit edition with a price to show,
 * marked as an estimate while a UGC part's figure is not the server's checked
 * one, the reason on the button's title.
 */
import { describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ credits: true }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => h.credits }))
vi.mock("@/lib/credit-units", () => ({ creditUnits: (n: number) => n }))

import { runPriceSuffix, runPriceTitle } from "../run-price"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

describe("a render run button's price", () => {
  it("a checked figure: the credits, unmarked, and no title", () => {
    expect(runPriceSuffix(t, 530)).toBe(" · 530")
    expect(runPriceTitle(t)).toBeUndefined()
  })
  it("a UGC part's figure not yet the server's, or not checked: marked as an estimate, the reason on the title", () => {
    // `≈` before an estimate, as every run price shows one.
    expect(runPriceSuffix(t, 530, "checking")).toBe(" · ≈530")
    expect(runPriceTitle(t, "checking")).toBe(t("ugc.price.checking"))
    expect(runPriceTitle(t, "editor")).toBe(t("ugc.price.unchecked"))
    expect(runPriceTitle(t, "held")).toBe(t("ugc.price.uncheckedHeld"))
    expect(runPriceTitle(t, "length")).toBe(t("ugc.price.uncheckedLength"))
  })
  it("an approximate figure (a metered LLM estimate, the Clip Pack's footer) is marked the same way", () => {
    expect(runPriceSuffix(t, 420, undefined, { approx: true })).toBe(" · ≈420")
    expect(runPriceSuffix(t, 420, "editor", { approx: true })).toBe(" · ≈420")
  })
  it("a run holding a node the server refuses to price: no figure — not priced yet, the server's sentence on the title", () => {
    const message = 'The model "x" has no price yet, so it cannot be run. Choose another model.'
    expect(runPriceSuffix(t, 420, undefined, { approx: true, unpriced: { message } })).toBe(` · ${t("renderFinal.priceNotPricedYet")}`)
    expect(t("renderFinal.priceNotPricedYet")).toBe("not priced yet")
    expect(runPriceSuffix(t, 0, undefined, { unpriced: {} })).toBe(" · not priced yet")
    expect(runPriceTitle(t, "checking", { message })).toBe(message)
    h.credits = false
    expect(runPriceSuffix(t, 420, undefined, { unpriced: { message } })).toBe("")
    expect(runPriceTitle(t, undefined, { message })).toBeUndefined()
    h.credits = true
  })
  it("no price to show: nothing, marked or not", () => {
    expect(runPriceSuffix(t, 0, "checking")).toBe("")
    h.credits = false
    expect(runPriceSuffix(t, 530, "checking")).toBe("")
    h.credits = true
  })
})
