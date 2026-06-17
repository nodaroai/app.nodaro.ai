import { describe, it, expect } from "vitest"
import { isValidCharacterConnection, IDENTITY_HANDLE_LABELS } from "../identity-handles"

// The character node's `assets` handle (element/asset injection, P1) accepts
// text/dynamic producers + element pickers. Identity & character sources are P2.
const noPicker = () => false

describe("character `assets` handle predicate", () => {
  it("accepts text producers", () => {
    expect(isValidCharacterConnection("assets", "text-prompt", noPicker)).toBe(true)
    expect(isValidCharacterConnection("assets", "ai-writer", noPicker)).toBe(true)
  })

  it("accepts an element picker", () => {
    expect(isValidCharacterConnection("assets", "styling", noPicker)).toBe(true)
  })

  it("rejects identity / character sources in P1", () => {
    expect(isValidCharacterConnection("assets", "character", noPicker)).toBe(false)
    expect(isValidCharacterConnection("assets", "object", noPicker)).toBe(false)
  })

  it("leaves the existing `in`/Prompt handle behaviour intact", () => {
    expect(isValidCharacterConnection("in", "text-prompt", noPicker)).toBe(true)
    expect(isValidCharacterConnection("nope", "text-prompt", noPicker)).toBe(false)
  })

  it("labels the assets handle", () => {
    expect(IDENTITY_HANDLE_LABELS.character.assets).toBe("Assets")
  })
})
