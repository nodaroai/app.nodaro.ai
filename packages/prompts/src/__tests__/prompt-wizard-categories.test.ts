import { describe, it, expect } from "vitest"
import {
  getCategoriesForNodeType,
  isWizardSupported,
  MUSIC_WIZARD_CATEGORIES,
} from "../prompt-wizard-categories.js"

describe("suno-generate:style wizard target", () => {
  it("reuses MUSIC categories and is supported", () => {
    // The composite `:style` target drives the SAME music wizard form as the
    // base `suno-generate` node — it only changes the OUTPUT shape (tags vs
    // prose), handled in the backend system-prompt builder.
    expect(getCategoriesForNodeType("suno-generate:style")).toEqual(MUSIC_WIZARD_CATEGORIES)
    expect(isWizardSupported("suno-generate:style")).toBe(true)
  })
})

describe("suno-generate:negativeStyle + :lyrics wizard targets", () => {
  // Task 5 extends the Phase-D composite-key pattern to two more Suno fields.
  // BOTH reuse the SAME music wizard FORM as `:style`/`suno-generate`; only the
  // backend OUTPUT framing differs (avoid-tags / sectioned lyrics).
  it("negativeStyle reuses MUSIC categories and is supported", () => {
    expect(getCategoriesForNodeType("suno-generate:negativeStyle")).toEqual(MUSIC_WIZARD_CATEGORIES)
    expect(isWizardSupported("suno-generate:negativeStyle")).toBe(true)
  })

  it("lyrics reuses MUSIC categories and is supported", () => {
    expect(getCategoriesForNodeType("suno-generate:lyrics")).toEqual(MUSIC_WIZARD_CATEGORIES)
    expect(isWizardSupported("suno-generate:lyrics")).toBe(true)
  })
})
