import { describe, expect, it } from "vitest"
import { sunoStemFieldFor } from "../suno-stem-fields.js"

describe("sunoStemFieldFor", () => {
  it.each([
    ["Backing_Vocals", "backingVocalsUrl"], ["backing vocals", "backingVocalsUrl"], ["Vocals", "vocalUrl"],
    ["Instrumental", "instrumentalUrl"], ["FX", "fxUrl"], ["Woodwinds", "woodwindsUrl"], ["Didgeridoo", undefined],
  ])("%s → %s", (name, field) => expect(sunoStemFieldFor(name)).toBe(field))
})
