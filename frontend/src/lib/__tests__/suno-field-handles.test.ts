import { describe, it, expect } from "vitest"
import { isValidSunoGenerateConnection } from "../audio-text-handles"

const noVisual = () => false
describe("isValidSunoGenerateConnection — field-* handles are text-only", () => {
  for (const id of ["field-style", "field-lyrics", "field-title", "field-negativeStyle"]) {
    it(`${id} accepts a text producer`, () => {
      expect(isValidSunoGenerateConnection(id, "ai-writer", noVisual)).toBe(true)
    })
    it(`${id} rejects an audio picker`, () => {
      expect(isValidSunoGenerateConnection(id, "music-genre", noVisual)).toBe(false)
    })
  }
})
