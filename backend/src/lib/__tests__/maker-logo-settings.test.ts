import { describe, it, expect } from "vitest"
import { MODEL_MAKER_LOGOS_KEY, modelMakerLogosError, parseModelMakerLogos } from "../maker-logo-settings.js"

describe("the model_maker_logos setting", () => {
  it("is the app_settings key the docs name", () => {
    expect(MODEL_MAKER_LOGOS_KEY).toBe("model_maker_logos")
  })

  describe("parseModelMakerLogos (the tolerant read — the row may be written by hand)", () => {
    it("keeps the known maker ids, once each, in the order given", () => {
      expect(parseModelMakerLogos(["openai", "google", "openai", "black-forest-labs"])).toEqual([
        "openai",
        "google",
        "black-forest-labs",
      ])
    })

    it("drops what is not a known maker id", () => {
      expect(parseModelMakerLogos(["google", "Google", "acme", 7, null, "", "toString"])).toEqual(["google"])
    })

    it("reads anything but an array as nothing declared", () => {
      for (const value of [undefined, null, "google", { google: true }, 1, true]) {
        expect(parseModelMakerLogos(value)).toEqual([])
      }
    })
  })

  describe("modelMakerLogosError (the admin write — refuse what the reader would drop)", () => {
    it("accepts a list of known maker ids, and the empty list", () => {
      expect(modelMakerLogosError(["google", "openai"])).toBeNull()
      expect(modelMakerLogosError([])).toBeNull()
    })

    it("refuses a value that is not a list of strings", () => {
      for (const value of ["google", { google: true }, 3, true, ["google", 3]]) {
        expect(modelMakerLogosError(value)).toMatch(/model_maker_logos must be an array of maker ids/)
      }
    })

    it("refuses an unknown maker id, naming it and the ids it may use", () => {
      const message = modelMakerLogosError(["google", "acme", "Google"])
      expect(message).toMatch(/unknown maker id: acme, Google/)
      expect(message).toMatch(/black-forest-labs/)
    })
  })
})
