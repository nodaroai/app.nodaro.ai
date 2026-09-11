import { describe, it, expect } from "vitest"
import { DEFAULT_SUNO_MODEL, SUNO_MODELS, sunoCreditType } from "@nodaro/shared"
import { guardSunoCreditType } from "../suno.js"

/**
 * The creditGuard reserves from the RAW body before Zod applies the model
 * default; the worker egresses under sunoCreditType(parsed.model). The two
 * must agree for every body shape, or an omitted model reserves under the
 * operation key and egresses under the version key.
 */
describe("guardSunoCreditType — reservation key == egress key", () => {
  it("applies the model default when the body omits model", () => {
    for (const op of ["suno-generate", "suno-cover", "suno-extend"]) {
      expect(guardSunoCreditType({}, op)).toBe(sunoCreditType(DEFAULT_SUNO_MODEL, op))
      expect(guardSunoCreditType(undefined, op)).toBe(sunoCreditType(DEFAULT_SUNO_MODEL, op))
      expect(guardSunoCreditType({ model: 42 }, op)).toBe(sunoCreditType(DEFAULT_SUNO_MODEL, op))
    }
    expect(guardSunoCreditType({}, "suno-generate")).toBe("suno-v6")
  })

  it("matches sunoCreditType for every accepted version (active + legacy)", () => {
    for (const model of SUNO_MODELS) {
      for (const op of ["suno-generate", "suno-cover", "suno-extend", "suno-mashup"]) {
        expect(guardSunoCreditType({ model }, op)).toBe(sunoCreditType(model, op))
      }
    }
  })
})
