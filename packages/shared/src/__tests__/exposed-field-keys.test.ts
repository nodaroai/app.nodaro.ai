import { describe, it, expect } from "vitest"
import {
  LEGACY_EXPOSED_FIELD_KEYS,
  canonicalExposedFieldKey,
  canonicalizeOverrideKeys,
} from "../exposed-field-keys.js"
import { mergeNodeInputOverrides } from "../presentation-utils.js"

describe("canonicalExposedFieldKey", () => {
  it("maps the legacy Text to Speech key to the node's data field", () => {
    expect(canonicalExposedFieldKey("text-to-speech", "similarity")).toBe("similarityBoost")
  })

  it("passes the current key, any other key, another node type and a missing type through", () => {
    expect(canonicalExposedFieldKey("text-to-speech", "similarityBoost")).toBe("similarityBoost")
    expect(canonicalExposedFieldKey("text-to-speech", "stability")).toBe("stability")
    // The rename belongs to one node type: AI Avatar's Fish voice has a field that really is `similarity`.
    expect(canonicalExposedFieldKey("ai-avatar", "similarity")).toBe("similarity")
    expect(canonicalExposedFieldKey(undefined, "similarity")).toBe("similarity")
  })

  it("an inherited object member name is an unknown key or type, never a function", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(canonicalExposedFieldKey("text-to-speech", name)).toBe(name)
      expect(canonicalExposedFieldKey(name, "similarity")).toBe("similarity")
    }
  })

  it("every row renames to a different key", () => {
    for (const renames of Object.values(LEGACY_EXPOSED_FIELD_KEYS)) {
      for (const [legacy, current] of Object.entries(renames)) expect(current).not.toBe(legacy)
    }
  })
})

describe("canonicalizeOverrideKeys", () => {
  it("renames a legacy key and keeps its value", () => {
    expect(canonicalizeOverrideKeys("text-to-speech", { similarity: 0.2, stability: 0.4 })).toEqual({
      similarityBoost: 0.2,
      stability: 0.4,
    })
  })

  it("the current key wins when the caller sent both spellings", () => {
    expect(canonicalizeOverrideKeys("text-to-speech", { similarity: 0.2, similarityBoost: 0.9 })).toEqual({
      similarityBoost: 0.9,
    })
  })

  it("returns the same object when nothing renames, and never mutates its input", () => {
    const untouched = { stability: 0.4 }
    expect(canonicalizeOverrideKeys("text-to-speech", untouched)).toBe(untouched)
    const input = { similarity: 0.2 }
    canonicalizeOverrideKeys("text-to-speech", input)
    expect(input).toEqual({ similarity: 0.2 })
  })
})

describe("mergeNodeInputOverrides — a legacy exposed key", () => {
  const saved = { label: "Narration", provider: "elevenlabs-turbo", stability: 0.5, similarityBoost: 0.75 }

  it("lands on the node's `similarityBoost` and leaves no dead `similarity` key behind", () => {
    const merged = mergeNodeInputOverrides("text-to-speech", saved, { similarity: 0.2 })
    expect(merged.similarityBoost).toBe(0.2)
    expect("similarity" in merged).toBe(false)
    expect(merged.stability).toBe(0.5)
  })

  it("is the same result as sending the current key", () => {
    expect(mergeNodeInputOverrides("text-to-speech", saved, { similarity: 0.2 })).toEqual(
      mergeNodeInputOverrides("text-to-speech", saved, { similarityBoost: 0.2 }),
    )
  })

  it("leaves `similarity` alone on a node type that really has it", () => {
    expect(mergeNodeInputOverrides("ai-avatar", { label: "Avatar" }, { similarity: 0.2 }).similarity).toBe(0.2)
  })
})
