import { describe, expect, it } from "vitest"
import { isBareDashToken, trimEdgeDashTokens } from "../caption-edge-dash.js"

describe("isBareDashToken", () => {
  it("is true for a token of dashes only", () => {
    for (const t of ["—", "–", "-", " — ", "‑", "−", "־", "--"]) expect(isBareDashToken(t)).toBe(true)
  })
  it("is false for words, hyphenated words and other punctuation", () => {
    for (const t of ["ה-AI", "re-run", "Nodaro", ",", ".", "", " ", "—Nodaro"]) expect(isBareDashToken(t)).toBe(false)
  })
})

describe("trimEdgeDashTokens", () => {
  const id = (s: string) => s
  it("drops lone dashes from both edges only, keeping one inside", () => {
    expect(trimEdgeDashTokens(["—", "קנבס", "—", "אחד.", "–"], id)).toEqual(["קנבס", "—", "אחד."])
  })
  it("returns an empty list for dashes alone, and never mutates its input", () => {
    const input = ["—", "-"]
    expect(trimEdgeDashTokens(input, id)).toEqual([])
    expect(input).toEqual(["—", "-"])
  })
})
