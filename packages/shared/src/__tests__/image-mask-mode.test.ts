import { describe, it, expect } from "vitest"
import { IMAGE_GEN_PROVIDERS } from "../model-constants.js"
import { IMAGE_MASK_MODE } from "../model-constants.js"

describe("IMAGE_MASK_MODE", () => {
  it("has an entry for every image-gen provider (completeness invariant)", () => {
    const missing = IMAGE_GEN_PROVIDERS.filter((p) => IMAGE_MASK_MODE[p] === undefined)
    expect(missing).toEqual([])
  })

  it("only uses prompt|composite in Phase 1 (native is reserved for Phase 1.5)", () => {
    const values = new Set(Object.values(IMAGE_MASK_MODE))
    expect(values.has("native")).toBe(false)
    for (const v of values) expect(["prompt", "composite"]).toContain(v)
  })
})
