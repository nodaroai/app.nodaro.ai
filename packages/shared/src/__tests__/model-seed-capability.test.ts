import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, modelTakesSeed } from "../model-catalog.js"

// `noSeed` is the catalog's answer to "does a seed on this model do anything".
// The editor hides its Seed field off it; the backend's KIE `omitSeed` flags
// are pinned to it by backend/src/providers/kie/__tests__/seed-capability-parity.test.ts.
describe("modelTakesSeed", () => {
  it("is false for Seedance 2.5 — the provider refuses a seed", () => {
    expect(modelTakesSeed("seedance-2-5")).toBe(false)
  })

  it("is false for HappyHorse 1.1 (its schema dropped seed)", () => {
    expect(modelTakesSeed("happyhorse")).toBe(false)
    expect(modelTakesSeed("happyhorse-i2v")).toBe(false)
    expect(modelTakesSeed("happyhorse-ref2v")).toBe(false)
  })

  it("is true for models that declare nothing", () => {
    expect(modelTakesSeed("veo3")).toBe(true)
    expect(modelTakesSeed("bytedance-lite")).toBe(true)
    expect(modelTakesSeed("seedance-2")).toBe(true)
  })

  it("is true for an unknown or missing id — never hides a field it knows nothing about", () => {
    expect(modelTakesSeed("not-a-model")).toBe(true)
    expect(modelTakesSeed(undefined)).toBe(true)
  })

  it("agrees with the catalog flag for every entry", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      expect(modelTakesSeed(m.id), m.id).toBe(m.noSeed !== true)
    }
  })
})
