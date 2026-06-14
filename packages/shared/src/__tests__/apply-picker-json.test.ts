import { describe, it, expect } from "vitest"
import { buildPickerAnalyzerSpec, applyPickerJson } from "../picker-analyzer-registry.js"

const spec = buildPickerAnalyzerSpec("person")

describe("applyPickerJson", () => {
  it("override: sets detected dims, clears undetected dimension fields, preserves preText/label", () => {
    const current = { label: "P", type: "man", hairBase: "base-short-straight", preText: "keep me", customAge: 8, age: "age-custom" }
    const patch = applyPickerJson(current, { type: "woman" }, "override", spec)
    expect(patch.type).toBe("woman")
    expect(patch.hairBase).toBeUndefined() // undetected → cleared
    expect("preText" in patch).toBe(false) // never touched
    expect("label" in patch).toBe(false)
    expect(patch.customAge).toBeUndefined() // age dimension reset
    expect(patch.lips).toBeUndefined() // legacy cleared in override
  })

  it("overwrite-detected: only writes detected dims, leaves others untouched", () => {
    const current = { hairBase: "base-short-straight" }
    const patch = applyPickerJson(current, { type: "woman" }, "overwrite-detected", spec)
    expect(patch.type).toBe("woman")
    expect("hairBase" in patch).toBe(false)
  })

  it("fill-empty: only fills currently-empty fields", () => {
    const current = { type: "man" }
    const patch = applyPickerJson(current, { type: "woman", build: "slim" }, "fill-empty", spec)
    expect("type" in patch).toBe(false) // already set
    expect(patch.build).toBe("slim")
  })

  it("coerces multi-limit dims to arrays and single to scalars", () => {
    const patch = applyPickerJson({}, { ethnicity: ["east-asian", "mediterranean"], type: "man" }, "overwrite-detected", spec)
    expect(Array.isArray(patch.ethnicity)).toBe(true)
    expect(typeof patch.type).toBe("string")
  })

  // Cardinality-mismatch leniency: a misbehaving LLM may emit a bare string for
  // a multi-limit dimension, or an array for a single-limit dimension. coerce()
  // normalizes both shapes so the patch always matches the field's cardinality.
  it("coerces a bare string into an array for a multi-limit dim (ethnicity, limit 2)", () => {
    const patch = applyPickerJson({}, { ethnicity: "east-asian" }, "overwrite-detected", spec)
    expect(patch.ethnicity).toEqual(["east-asian"])
  })

  it("coerces an array into the first-element scalar for a single-limit dim (type, limit 1)", () => {
    const patch = applyPickerJson({}, { type: ["man", "woman"] }, "overwrite-detected", spec)
    expect(patch.type).toBe("man")
  })
})
