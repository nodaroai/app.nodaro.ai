import { describe, it, expect } from "vitest"
import {
  sunoCreditType,
  SUNO_VERSION_CREDIT_KEYS,
  SUNO_VERSION_PRICED_OPERATIONS,
  SUNO_SELECT_OPERATIONS,
  SUNO_MODELS,
  SUNO_ACTIVE_MODELS,
  SUNO_LEGACY_MODELS,
  SUNO_ADD_TRACK_MODELS,
  DEFAULT_SUNO_MODEL,
  sunoModelHonoursDuration,
  MODEL_CATALOG,
} from "../index.js"

describe("sunoCreditType — the ONE implementation of the Suno route pricing contract", () => {
  it("prices generate/cover/extend by model version", () => {
    expect(sunoCreditType("V6", "suno-generate")).toBe("suno-v6")
    expect(sunoCreditType("V6_WILD", "suno-cover")).toBe("suno-v6_wild")
    expect(sunoCreditType("V6_MINI", "suno-extend")).toBe("suno-v6_mini")
    expect(sunoCreditType("V5_5", "suno-generate")).toBe("suno-v5_5")
    expect(sunoCreditType("V5", "suno-cover")).toBe("suno-v5")
    expect(sunoCreditType("V5_5", "suno-extend")).toBe("suno-v5_5")
  })

  // A new active version with no key would silently bill at the operation
  // key — and be invisible in /admin/models. Every active version must own a
  // key, and that key must be the pricing identifier of the catalog entry
  // whose dataValue is that version (the Models tab + /v1/models contract).
  it("gives every ACTIVE version its own credit key, matching its catalog entry", () => {
    const sunoEntries = Object.values(MODEL_CATALOG).filter((m) => m.family === "Suno")
    for (const model of SUNO_ACTIVE_MODELS) {
      const key = SUNO_VERSION_CREDIT_KEYS[model]
      expect(key, `${model} has no SUNO_VERSION_CREDIT_KEYS row`).toBeTruthy()
      for (const op of SUNO_VERSION_PRICED_OPERATIONS) {
        expect(sunoCreditType(model, op)).toBe(key)
      }
      const entry = sunoEntries.find((m) => m.dataValue === model)
      expect(entry, `${model} has no MODEL_CATALOG entry with dataValue`).toBeTruthy()
      expect(entry!.pricing.map((p) => p.identifier)).toContain(key)
    }
  })

  it("keeps the model lists active-first with the default at the head", () => {
    expect([...SUNO_ACTIVE_MODELS]).toEqual(["V6", "V6_WILD", "V6_MINI"])
    expect(SUNO_MODELS[0]).toBe(DEFAULT_SUNO_MODEL)
    expect([...SUNO_MODELS]).toEqual([...SUNO_ACTIVE_MODELS, ...SUNO_LEGACY_MODELS])
    // The two halves never overlap.
    for (const legacy of SUNO_LEGACY_MODELS) {
      expect(SUNO_ACTIVE_MODELS as readonly string[]).not.toContain(legacy)
    }
    for (const m of SUNO_ADD_TRACK_MODELS) expect(SUNO_MODELS as readonly string[]).toContain(m)
    for (const m of SUNO_ACTIVE_MODELS) expect(SUNO_ADD_TRACK_MODELS as readonly string[]).toContain(m)
  })

  it("honours duration on the V6 family only (V5_5 was struck from the docs sentence)", () => {
    for (const m of SUNO_ACTIVE_MODELS) expect(sunoModelHonoursDuration(m)).toBe(true)
    for (const m of SUNO_LEGACY_MODELS) expect(sunoModelHonoursDuration(m)).toBe(false)
    expect(sunoModelHonoursDuration(undefined)).toBe(false)
  })

  it("falls back to the operation key for versions with no dedicated price", () => {
    expect(sunoCreditType("V4", "suno-generate")).toBe("suno-generate")
    expect(sunoCreditType("V4_5ALL", "suno-cover")).toBe("suno-cover")
    expect(sunoCreditType(undefined, "suno-extend")).toBe("suno-extend")
  })

  // The reason this function is gated rather than a bare version map: these four
  // routes charge a FLAT per-operation key no matter which version the node
  // carries (routes/suno.ts:648, :852, :907, :1016). A quote of "suno-v5_5" for
  // one of them is a key the route never charges.
  it.each([
    "suno-mashup",
    "suno-add-instrumental",
    "suno-add-vocals",
    "suno-upload-extend",
  ])("keeps the flat operation key for %s regardless of version", (operation) => {
    for (const model of SUNO_MODELS) {
      expect(sunoCreditType(model, operation)).toBe(operation)
    }
    expect(sunoCreditType(undefined, operation)).toBe(operation)
  })

  it("returns an unknown operation unchanged (never invents a key)", () => {
    expect(sunoCreditType("V5", "suno-voice")).toBe("suno-voice")
    expect(sunoCreditType("V5_5", "not-a-suno-op")).toBe("not-a-suno-op")
  })

  it("exports exactly the three version-priced operations", () => {
    expect([...SUNO_VERSION_PRICED_OPERATIONS]).toEqual([
      "suno-generate",
      "suno-cover",
      "suno-extend",
    ])
  })

  it("exports exactly the seven select operations", () => {
    expect(SUNO_SELECT_OPERATIONS.length).toBe(7)
  })
})
