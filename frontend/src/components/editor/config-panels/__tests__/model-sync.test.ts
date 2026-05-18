import { describe, it, expect } from "vitest"
import {
  IMAGE_GEN_MODELS,
  IMAGE_I2I_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
} from "../model-options"

// ---------------------------------------------------------------------------
// Cross-array model sync tests — catch accidental duplicates or misplaced
// models across the four model arrays.
// ---------------------------------------------------------------------------

const ALL_ARRAYS = [
  { name: "IMAGE_GEN_MODELS", models: IMAGE_GEN_MODELS },
  { name: "IMAGE_I2I_MODELS", models: IMAGE_I2I_MODELS },
  { name: "VIDEO_I2V_MODELS", models: VIDEO_I2V_MODELS },
  { name: "VIDEO_T2V_MODELS", models: VIDEO_T2V_MODELS },
] as const

describe("cross-array model sync", () => {
  it("no I2I model value appears in the T2I (IMAGE_GEN_MODELS) list", () => {
    const genValues: Set<string> = new Set(IMAGE_GEN_MODELS.map((m) => m.value))
    const overlapping: string[] = []
    for (const m of IMAGE_I2I_MODELS) {
      if (genValues.has(m.value)) {
        overlapping.push(m.value)
      }
    }
    // nano-banana appears in both intentionally (different use case), so filter it
    // If there are any unexpected overlaps beyond the ones that share the same
    // base model identifier (e.g. nano-banana), fail explicitly.
    const unexpected = overlapping.filter(
      (v) => !["nano-banana", "nano-banana-pro", "flux-kontext", "flux-kontext-max", "flux-2-pro", "flux-2-max"].includes(v),
    )
    expect(unexpected).toEqual([])
  })

  it("no video model value appears in any image model list (except known multimodal)", () => {
    // "grok" is intentionally shared: the same base identifier is used for
    // image generation (IMAGE_GEN_MODELS) and text-to-video (VIDEO_T2V_MODELS)
    // because Grok is a multimodal provider.
    const KNOWN_MULTIMODAL = new Set(["grok"])

    const imageValues: Set<string> = new Set([
      ...IMAGE_GEN_MODELS.map((m) => m.value),
      ...IMAGE_I2I_MODELS.map((m) => m.value),
    ])
    const unexpected: string[] = []
    for (const m of [...VIDEO_I2V_MODELS, ...VIDEO_T2V_MODELS]) {
      if (imageValues.has(m.value) && !KNOWN_MULTIMODAL.has(m.value)) {
        unexpected.push(m.value)
      }
    }
    expect(unexpected).toEqual([])
  })

  it("all model values match lowercase kebab-case with optional dots", () => {
    const validPattern = /^[a-z0-9][a-z0-9._-]*$/
    for (const { name, models } of ALL_ARRAYS) {
      for (const m of models) {
        expect(m.value, `${name}: "${m.value}" is not valid`).toMatch(
          validPattern,
        )
      }
    }
  })

  it("no duplicate values within each individual array", () => {
    for (const { name, models } of ALL_ARRAYS) {
      const values = models.map((m) => m.value)
      const unique = new Set(values)
      if (unique.size !== values.length) {
        const duplicates = values.filter(
          (v, i) => values.indexOf(v) !== i,
        )
        throw new Error(
          `${name} has duplicate values: ${duplicates.join(", ")}`,
        )
      }
      expect(unique.size).toBe(values.length)
    }
  })

  it("every model has a non-empty label and desc", () => {
    for (const { name, models } of ALL_ARRAYS) {
      for (const m of models) {
        expect(
          m.label.length,
          `${name}: model "${m.value}" has empty label`,
        ).toBeGreaterThan(0)
        expect(
          m.desc.length,
          `${name}: model "${m.value}" has empty desc`,
        ).toBeGreaterThan(0)
      }
    }
  })
})
