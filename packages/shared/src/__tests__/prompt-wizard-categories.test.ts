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
