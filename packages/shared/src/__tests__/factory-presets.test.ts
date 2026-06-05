import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS, getFactoryPresets } from "../factory-presets.js"
import { extractPresetData } from "../node-preset-extract.js"
import { IMAGE_GEN_PROVIDERS } from "../index.js"

describe("FACTORY_PRESETS", () => {
  it("has presets for generate-image", () => {
    expect(getFactoryPresets("generate-image").length).toBeGreaterThan(0)
  })

  it("returns [] for an unknown node type", () => {
    expect(getFactoryPresets("does-not-exist")).toEqual([])
  })

  it("every factory preset has a stable unique id, name, and object data", () => {
    const ids = new Set<string>()
    for (const [, presets] of Object.entries(FACTORY_PRESETS)) {
      for (const p of presets) {
        expect(p.id).toMatch(/.+\/.+/) // "<nodeType>/<slug>"
        expect(ids.has(p.id)).toBe(false)
        ids.add(p.id)
        expect(typeof p.name).toBe("string")
        expect(p.name.length).toBeGreaterThan(0)
        expect(typeof p.data).toBe("object")
      }
    }
  })

  it("factory preset data never contains excluded/runtime keys", () => {
    for (const [, presets] of Object.entries(FACTORY_PRESETS)) {
      for (const p of presets) {
        // extract is a no-op iff data already excludes runtime/label/fieldMappings
        expect(extractPresetData(p.data)).toEqual(p.data)
      }
    }
  })

  it("generate-image factory presets use a known image provider", () => {
    for (const p of getFactoryPresets("generate-image")) {
      if (p.data.provider !== undefined) {
        expect(IMAGE_GEN_PROVIDERS).toContain(p.data.provider as never)
      }
    }
  })
})
