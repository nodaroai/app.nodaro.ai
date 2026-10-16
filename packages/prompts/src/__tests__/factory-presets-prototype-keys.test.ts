import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS, getFactoryPresets, presetMinReferences } from "../factory-presets.js"
import { getPromptFields, nodeSupportsPromptAffixes, promptAffixCoreField, promptFieldCarriesAffixes } from "../node-prompt-fields.js"
import { computeNodePrompt } from "../resolve-prompt.js"

/**
 * The registries keyed by node type are plain objects, and a node type is
 * caller-supplied (`?nodeType=` on the public factory route, a preset row's
 * `node_type`, workflow JSON). A name that is an Object.prototype member —
 * `constructor`, `toString`, `__proto__` — must read as "no such type", never
 * as the prototype's member: `FACTORY_PRESETS["constructor"]` is `Object`, so
 * `?? []` did not fire and `.map` threw an anonymous 500.
 */
const PROTOTYPE_KEYS = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"] as const

describe("node-type lookups and Object.prototype member names", () => {
  it.each(PROTOTYPE_KEYS)("getFactoryPresets(%j) is an empty catalog", (key) => {
    expect(getFactoryPresets(key)).toEqual([])
    expect(key in FACTORY_PRESETS).toBe(key === "__proto__" || Object.prototype.hasOwnProperty.call(Object.prototype, key))
  })

  it.each(PROTOTYPE_KEYS)("presetMinReferences(%j, …) counts nothing and never throws", (key) => {
    expect(presetMinReferences(key, { prompt: "{image:1}" })).toBe(0)
    expect(presetMinReferences(key, {}, 2)).toBe(2)
  })

  it.each(PROTOTYPE_KEYS)("the prompt-field registry has no spec for %j", (key) => {
    expect(getPromptFields(key)).toBeUndefined()
    expect(nodeSupportsPromptAffixes(key)).toBe(false)
    expect(promptAffixCoreField(key)).toBeUndefined()
    expect(promptFieldCarriesAffixes(key, "prompt")).toBe(false)
  })

  it.each(PROTOTYPE_KEYS)("computeNodePrompt(%j, …) falls back to the plain prompt field", (key) => {
    expect(computeNodePrompt(key, { prompt: "a fox" }, { refMap: new Map() })).toBe("a fox")
  })

  it("a real node type still resolves (the fix narrows nothing)", () => {
    expect(getFactoryPresets("generate-image").length).toBeGreaterThan(0)
    expect(presetMinReferences("generate-image", { prompt: "{image:2:person}" })).toBe(2)
    expect(getPromptFields("generate-image")?.prompt).toBe("prompt")
  })
})
