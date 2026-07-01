import { describe, it, expect } from "vitest"
import {
  CHARACTER_REFERENCE_PHOTO_KINDS,
  type CharacterReferencePhotoKind,
} from "../entity-prompts.js"

// Guards the single schema-of-record for the 7 identity-foundation kinds now
// shared across the generate-character/characters route Zod enums, the backend
// ranking (character-reference-set.ts), and the frontend routing. A change here
// must be deliberate — it moves every consumer at once.
describe("CHARACTER_REFERENCE_PHOTO_KINDS", () => {
  it("is exactly the 7 identity-foundation kinds, in order", () => {
    expect([...CHARACTER_REFERENCE_PHOTO_KINDS]).toEqual([
      "frontFace",
      "sideLeft",
      "sideRight",
      "threeQuarterLeft",
      "threeQuarterRight",
      "frontBody",
      "other",
    ])
  })

  it("has no duplicates", () => {
    expect(new Set(CHARACTER_REFERENCE_PHOTO_KINDS).size).toBe(CHARACTER_REFERENCE_PHOTO_KINDS.length)
  })

  it("type derives from the const (compile-time totality)", () => {
    const sample: CharacterReferencePhotoKind = CHARACTER_REFERENCE_PHOTO_KINDS[0]
    expect(CHARACTER_REFERENCE_PHOTO_KINDS).toContain(sample)
  })
})
