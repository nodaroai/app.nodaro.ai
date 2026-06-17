import { describe, it, expect } from "vitest"
import { isValidCharacterConnection, IDENTITY_HANDLE_LABELS } from "../identity-handles"

// The character node's `assets` handle (element/asset injection) accepts
// text/dynamic producers + element pickers (P1, whole fragment) AND identity /
// character sources (P2, facet-extracted) — the character→character case.
const noPicker = () => false

describe("character `assets` handle predicate", () => {
  it("accepts text producers", () => {
    expect(isValidCharacterConnection("assets", "text-prompt", noPicker)).toBe(true)
    expect(isValidCharacterConnection("assets", "ai-writer", noPicker)).toBe(true)
  })

  it("accepts an element picker", () => {
    expect(isValidCharacterConnection("assets", "styling", noPicker)).toBe(true)
  })

  it("accepts identity / character sources (P2 facet injection)", () => {
    for (const t of ["character", "object", "location", "creature", "face"]) {
      expect(isValidCharacterConnection("assets", t, noPicker)).toBe(true)
    }
  })

  it("rejects an unrelated source type on the assets handle", () => {
    expect(isValidCharacterConnection("assets", "generate-video", noPicker)).toBe(false)
  })

  it("leaves the existing `in`/Prompt handle behaviour intact", () => {
    expect(isValidCharacterConnection("in", "text-prompt", noPicker)).toBe(true)
    expect(isValidCharacterConnection("nope", "text-prompt", noPicker)).toBe(false)
  })

  it("labels the assets handle", () => {
    expect(IDENTITY_HANDLE_LABELS.character.assets).toBe("Assets")
  })
})
