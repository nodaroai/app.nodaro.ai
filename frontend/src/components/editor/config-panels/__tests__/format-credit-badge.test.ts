/**
 * The price badge on a model picker row. A variable-priced model quotes its
 * CHARGED range once it has loaded, and nothing before: its default variant's
 * price alone would read as the price. A fixed-price model quotes its charged
 * price. Without a credit system, nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared"

const { edition } = vi.hoisted(() => ({ edition: { credits: true } }))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => edition.credits,
}))

import { formatCreditBadge } from "../model-options"
import { creditUnitLabel, creditUnits, formatCreditUnits } from "@/lib/credit-units"

const FIXED = Object.values(MODEL_CATALOG).find((m) => m.pricing.length === 1)!.id

beforeEach(() => {
  edition.credits = true
})

describe("formatCreditBadge", () => {
  it("quotes a variable-priced model's charged range", () => {
    expect(formatCreditBadge("nano-banana-2", 22, { min: 22, max: 55 })).toBe(
      `${creditUnits(22)}-${creditUnits(55)} ${creditUnitLabel()}`,
    )
  })

  it("quotes nothing for a variable-priced model until its range has loaded", () => {
    expect(formatCreditBadge("nano-banana-2", 22, undefined)).toBeUndefined()
  })

  it("quotes a fixed-price model's charged price", () => {
    expect(formatCreditBadge(FIXED, 11, undefined)).toBe(formatCreditUnits(11))
    expect(formatCreditBadge(FIXED, 0, undefined)).toBeUndefined()
  })

  it("quotes nothing without a credit system", () => {
    edition.credits = false
    expect(formatCreditBadge("nano-banana-2", 22, { min: 22, max: 55 })).toBeUndefined()
    expect(formatCreditBadge(FIXED, 11, undefined)).toBeUndefined()
  })
})
