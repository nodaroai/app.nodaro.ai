import { describe, it, expect } from "vitest"
import { pickerJsonKey, computeInjectionPatch } from "../person-injection"
import type { PersonData } from "@/types/nodes"

// All ids below are REAL person-catalog ids (verified against
// packages/shared/src/person.ts):
//   type     (field "type",     limit 1): "man", "woman"
//   build    (field "build",    limit 1): "slim", "athletic"
//   hairBase (field "hairBase", limit 1): "base-short-straight"
//   ethnicity(field "ethnicity",limit 2): "east-asian", "mediterranean"

describe("pickerJsonKey", () => {
  it("is order-independent and equal for equal content", () => {
    expect(pickerJsonKey({ type: "man", ethnicity: ["east-asian", "mediterranean"] })).toBe(
      pickerJsonKey({ ethnicity: ["east-asian", "mediterranean"], type: "man" }),
    )
  })

  it("differs when a value differs", () => {
    expect(pickerJsonKey({ type: "man" })).not.toBe(pickerJsonKey({ type: "woman" }))
  })

  it("returns empty string for undefined", () => {
    expect(pickerJsonKey(undefined)).toBe("")
  })
})

describe("computeInjectionPatch", () => {
  it("returns a patch including the applied snapshot as lastAppliedPickerJson", () => {
    const current = { label: "P", type: "man" } as PersonData
    const patch = computeInjectionPatch(current, { type: "woman" }, "overwrite-detected")
    expect(patch.type).toBe("woman")
    expect(patch.lastAppliedPickerJson).toEqual({ type: "woman" })
  })

  it("override: sets detected dims, clears undetected dimension fields, preserves label/preText", () => {
    const current = {
      label: "P",
      type: "man",
      hairBase: "base-short-straight",
      preText: "keep me",
    } as PersonData
    const patch = computeInjectionPatch(current, { type: "woman" }, "override")
    expect(patch.type).toBe("woman")
    expect(patch.hairBase).toBeUndefined() // undetected → cleared in override
    expect("preText" in patch).toBe(false) // never touched
    expect("label" in patch).toBe(false)
    // override always records the applied snapshot for change detection
    expect(patch.lastAppliedPickerJson).toEqual({ type: "woman" })
  })

  it("overwrite-detected: only writes detected dims, leaves others untouched", () => {
    const current = { label: "P", hairBase: "base-short-straight" } as PersonData
    const patch = computeInjectionPatch(current, { type: "woman" }, "overwrite-detected")
    expect(patch.type).toBe("woman")
    expect("hairBase" in patch).toBe(false)
  })

  it("fill-empty: only fills currently-empty fields", () => {
    const current = { label: "P", type: "man" } as PersonData
    const patch = computeInjectionPatch(current, { type: "woman", build: "slim" }, "fill-empty")
    expect("type" in patch).toBe(false) // already set → not overwritten
    expect(patch.build).toBe("slim")
  })

  it("coerces multi-limit dims to arrays and single-limit dims to scalars", () => {
    const patch = computeInjectionPatch(
      { label: "P" } as PersonData,
      { ethnicity: ["east-asian", "mediterranean"], type: "man" },
      "overwrite-detected",
    )
    expect(Array.isArray(patch.ethnicity)).toBe(true)
    expect(typeof patch.type).toBe("string")
  })
})
