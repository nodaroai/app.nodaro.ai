import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  MODEL_RECOMMENDATIONS,
  listModels,
  groupByFamily,
  validateModelInput,
} from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../../../billing/credits.js"

describe("Model catalog ↔ STATIC_CREDIT_COSTS", () => {
  it("every catalog pricing identifier exists in STATIC_CREDIT_COSTS with matching cost", () => {
    const mismatches: string[] = []
    for (const entry of Object.values(MODEL_CATALOG)) {
      for (const variant of entry.pricing) {
        const expected = (STATIC_CREDIT_COSTS as Record<string, number | undefined>)[
          variant.identifier
        ]
        if (expected === undefined) {
          mismatches.push(`MISSING in STATIC_CREDIT_COSTS: ${variant.identifier}`)
        } else if (expected !== variant.credits) {
          mismatches.push(
            `MISMATCH ${variant.identifier}: catalog=${variant.credits} static=${expected}`,
          )
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it("every featured model has a description and useCases", () => {
    for (const entry of Object.values(MODEL_CATALOG)) {
      if (!entry.featured) continue
      expect(entry.description.length, `${entry.id} description`).toBeGreaterThan(10)
      expect(entry.useCases.length, `${entry.id} useCases`).toBeGreaterThan(0)
    }
  })

  it("every recommendation references a real catalog id", () => {
    const ids = new Set(Object.keys(MODEL_CATALOG))
    for (const rec of MODEL_RECOMMENDATIONS) {
      for (const id of rec.modelIds) {
        expect(ids.has(id), `recommendation references unknown id: ${id}`).toBe(true)
      }
    }
  })

  it("listModels filters by kind / mode / family", () => {
    const images = listModels({ kind: "image" })
    expect(images.every((m) => m.kind === "image")).toBe(true)
    expect(images.length).toBeGreaterThan(0)

    const i2v = listModels({ kind: "video", mode: "i2v" })
    expect(i2v.every((m) => m.mode === "i2v")).toBe(true)
    expect(i2v.length).toBeGreaterThan(0)

    const google = listModels({ family: "google" })
    expect(google.every((m) => m.family.toLowerCase() === "google")).toBe(true)
  })

  it("groupByFamily produces non-empty groups", () => {
    const grouped = groupByFamily(listModels({ kind: "image" }))
    expect(grouped.length).toBeGreaterThan(2)
    for (const g of grouped) {
      expect(g.models.length).toBeGreaterThan(0)
    }
  })
})

describe("validateModelInput", () => {
  it("returns null when input is empty or matches the model", () => {
    expect(validateModelInput("nano-banana-pro", {})).toBeNull()
    expect(
      validateModelInput("nano-banana-pro", { aspectRatio: "9:16", resolution: "4K" }),
    ).toBeNull()
  })

  it("flags an aspect_ratio the model doesn't support", () => {
    const issue = validateModelInput("gpt-image", { aspectRatio: "21:9" })
    expect(issue?.field).toBe("aspectRatio")
    expect(issue?.message).toMatch(/does not support aspect_ratio "21:9"/)
    expect(issue?.allowed).toContain("3:2")
  })

  it("flags a resolution on a model that has no resolution lever", () => {
    // Base nano-banana doesn't expose resolution.
    const issue = validateModelInput("nano-banana", { resolution: "4K" })
    expect(issue?.field).toBe("resolution")
    expect(issue?.message).toMatch(/does not have a resolution lever/)
  })

  it("flags a duration the video model doesn't support", () => {
    // VEO 3 is fixed 8s.
    const issue = validateModelInput("veo3", { duration: 5 })
    expect(issue?.field).toBe("duration")
    expect(issue?.allowed).toContain(8)
  })

  it("ignores unknown model ids (route handler catches those)", () => {
    expect(validateModelInput("totally-fake-model", { aspectRatio: "21:9" })).toBeNull()
  })
})
