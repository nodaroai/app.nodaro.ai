import { describe, expect, it } from "vitest"
import { findRestrictedPickerValue } from "../picker-restrictions.js"

const nodes = [{ id: "person", type: "person" }, { id: "setting", type: "setting" }, { id: "site", type: "text-prompt" }]
const cardMeta = {
  person: { pickerAllowedValuesByField: { age: ["age-20s", "age-30s"], type: ["office-worker"] } },
  setting: { pickerAllowedValues: ["kitchen", "studio"] },
}

describe("server check of picker restrictions (R4)", () => {
  it("passes allowed values and untouched fields", () => {
    expect(findRestrictedPickerValue({ cardMeta, nodes, inputValues: { person: { age: "age-30s" }, setting: { setting: "studio" }, site: { text: "x" } } })).toBeNull()
    expect(findRestrictedPickerValue({ cardMeta, nodes, inputValues: undefined })).toBeNull()
    expect(findRestrictedPickerValue({ cardMeta: undefined, nodes, inputValues: { person: { age: "anything" } } })).toBeNull()
  })
  it("refuses a value outside a per-field restriction, including inside a list", () => {
    expect(findRestrictedPickerValue({ cardMeta, nodes, inputValues: { person: { age: "age-teen" } } })).toBe("Invalid value for age: age-teen. Allowed: age-20s, age-30s")
    expect(findRestrictedPickerValue({ cardMeta, nodes, inputValues: { person: { type: ["office-worker", "princess"] } } })).toBe("Invalid value for type: princess. Allowed: office-worker")
  })
  it("applies a single-dimension restriction to the representative field", () => {
    expect(findRestrictedPickerValue({ cardMeta, nodes, inputValues: { setting: { setting: "beach" } } })).toBe("Invalid value for setting: beach. Allowed: kitchen, studio")
  })
  it("treats an empty allowed list as no restriction, and ignores a node the snapshot does not hold", () => {
    const empty = { person: { pickerAllowedValuesByField: { age: [] as string[] } }, ghost: { pickerAllowedValues: ["a"] } }
    expect(findRestrictedPickerValue({ cardMeta: empty, nodes, inputValues: { person: { age: "age-teen" }, ghost: { x: "b" } } })).toBeNull()
  })
  it("refuses a non-string value where a catalog id belongs; an unset pick passes", () => {
    expect(findRestrictedPickerValue({ cardMeta, nodes, inputValues: { person: { age: 30 } } })).toBe("Invalid value for age: 30. Allowed: age-20s, age-30s")
    expect(findRestrictedPickerValue({ cardMeta, nodes, inputValues: { person: { age: "", type: [] } } })).toBeNull()
  })
  it("reads a submitted legacy spelling of a field through its canonical key", () => {
    const tts = { tts: { pickerAllowedValuesByField: { similarityBoost: ["0.5"] } } }
    const ttsNodes = [{ id: "tts", type: "text-to-speech" }]
    expect(findRestrictedPickerValue({ cardMeta: tts, nodes: ttsNodes, inputValues: { tts: { similarity: "0.9" } } })).toBe("Invalid value for similarityBoost: 0.9. Allowed: 0.5")
  })
})
