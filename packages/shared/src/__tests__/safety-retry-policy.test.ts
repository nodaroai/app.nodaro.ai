import { T2I_TO_I2I_VARIANT } from "../model-constants.js"
import { describe, it, expect } from "vitest"
import { safetyRetryPolicy } from "../safety-retry-policy.js"
import { MODEL_CATALOG, getModel } from "../model-catalog.js"

describe("safetyRetryPolicy", () => {
  it("gives gpt-image-2 a second attempt and names its fallback", () => {
    expect(safetyRetryPolicy("gpt-image-2")).toEqual({
      maxAttempts: 2,
      fallback: "nano-banana-pro",
    })
  })

  it("gives a model without the flag a single attempt and no fallback", () => {
    // nano-banana-pro does not declare `safetyFilter` itself.
    expect(safetyRetryPolicy("nano-banana-pro")).toEqual({ maxAttempts: 1 })
  })

  it("gives an unknown model id a single attempt and no fallback", () => {
    expect(safetyRetryPolicy("totally-not-a-real-model-id")).toEqual({ maxAttempts: 1 })
  })

  it("every declared fallback resolves to a catalog entry that can actually cover the flagged model", () => {
    const flagged = Object.values(MODEL_CATALOG).filter((m) => m.safetyFilter?.fallback)
    // Sanity: this guard is only meaningful if at least one entry exercises it.
    expect(flagged.length).toBeGreaterThan(0)

    for (const entry of flagged) {
      const fallbackId = entry.safetyFilter!.fallback!
      const fallbackEntry = getModel(fallbackId)

      expect(fallbackEntry, `${entry.id} declares fallback "${fallbackId}" which is not a catalog entry`).toBeDefined()
      expect(fallbackEntry!.kind, `${entry.id}'s fallback "${fallbackId}" does not produce an image`).toBe("image")

      for (const mode of entry.modes) {
        expect(
          fallbackEntry!.modes,
          `${entry.id}'s fallback "${fallbackId}" is missing mode "${mode}" that ${entry.id} supports`,
        ).toContain(mode)
      }

      expect(
        fallbackEntry!.features ?? [],
        `${entry.id}'s fallback "${fallbackId}" does not accept a reference image`,
      ).toContain("reference-image")
    }
  })
})

describe("i2i variants inherit their base model's safety policy", () => {
  it("resolves the referenced-request id (gpt-image-2-i2i) to the same policy as gpt-image-2", () => {
    expect(safetyRetryPolicy("gpt-image-2-i2i")).toEqual({ maxAttempts: 2, fallback: "nano-banana-pro" })
  })

  it("every T2I_TO_I2I_VARIANT pair declares the same safetyFilter on both sides", () => {
    for (const [t2i, i2i] of Object.entries(T2I_TO_I2I_VARIANT)) {
      const base = MODEL_CATALOG[t2i]?.safetyFilter ?? null
      const twin = MODEL_CATALOG[i2i]?.safetyFilter ?? null
      expect({ pair: `${t2i} -> ${i2i}`, twin }).toEqual({ pair: `${t2i} -> ${i2i}`, twin: base })
    }
  })
})
