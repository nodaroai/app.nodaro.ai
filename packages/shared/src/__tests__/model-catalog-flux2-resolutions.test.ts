import { describe, it, expect } from "vitest"
import { resolutionOptionsByKind } from "../model-catalog.js"

const FLUX2_MP_VALUES = ["0.5 MP", "1 MP", "2 MP", "4 MP"]
const FLUX2_MODELS = ["flux-2-klein", "flux-2-pro", "flux-2-max"]

describe("resolutionOptionsByKind('image') — Flux 2 models expose all four MP tiers", () => {
  const imageResolutions = resolutionOptionsByKind("image")

  for (const model of FLUX2_MODELS) {
    it(`${model} has all four MP resolution options`, () => {
      const opts = imageResolutions[model]
      expect(opts, `${model} missing from resolutionOptionsByKind("image")`).toBeDefined()
      const values = opts!.map((o) => o.value)
      for (const mp of FLUX2_MP_VALUES) {
        expect(values, `${model} missing "${mp}"`).toContain(mp)
      }
      expect(values).toHaveLength(4)
    })
  }
})
