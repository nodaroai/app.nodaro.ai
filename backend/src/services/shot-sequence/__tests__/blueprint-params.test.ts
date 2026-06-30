import { describe, it, expect } from "vitest"
import { BLUEPRINT_IDS, BLUEPRINT_PARAM_SCHEMAS, BLUEPRINT_META, validateBlueprintParams } from "../blueprint-params.js"

describe("blueprint-params", () => {
  it("every id has a param schema AND a meta entry", () => {
    for (const id of BLUEPRINT_IDS) {
      expect(BLUEPRINT_PARAM_SCHEMAS[id]).toBeDefined()
      expect(BLUEPRINT_META[id]).toBeDefined()
      expect(BLUEPRINT_META[id].defaultDurationFrames).toBeGreaterThan(0)
      expect(BLUEPRINT_META[id].roles.length).toBeGreaterThan(0)
    }
  })
  it("validates good kinetic-type-beats params", () => {
    const r = validateBlueprintParams("kinetic-type-beats", { lines: ["A", "B"], accentColor: "#FF5733" })
    expect(r.ok).toBe(true)
  })
  it("rejects kinetic-type-beats with >4 lines", () => {
    const r = validateBlueprintParams("kinetic-type-beats", { lines: ["a","b","c","d","e"], accentColor: "#fff" })
    expect(r.ok).toBe(false)
  })
  it("rejects an unknown blueprint id", () => {
    const r = validateBlueprintParams("nope", {})
    expect(r.ok).toBe(false)
  })
  it("rejects a non-hex accentColor", () => {
    const r = validateBlueprintParams("cta-morph-press", { label: "Go", accentColor: "red" })
    expect(r.ok).toBe(false)
  })
})
