import { describe, it, expect } from "vitest"
import {
  SHEET_TYPES, SHEET_SKINS, SHEET_ASPECTS, OUTPUT_FORMATS, SECTION_KINDS,
} from "../types.js"

describe("reference-sheet literal axes", () => {
  it("exposes the four types", () => {
    expect(SHEET_TYPES).toEqual(["turnaround", "variation-board", "detail", "full-reference"])
  })
  it("exposes the four skins", () => {
    expect(SHEET_SKINS).toEqual(["studio", "cinematic", "blueprint", "illustrated"])
  })
  it("exposes aspects and output formats", () => {
    expect(SHEET_ASPECTS).toEqual(["landscape", "square", "story"])
    expect(OUTPUT_FORMATS).toEqual(["still", "motion"])
  })
  it("section kinds include the board, structural, and turnaround kinds", () => {
    for (const k of ["header", "head-turnaround", "body-turnaround", "turnaround", "coverage",
      "expression-board", "pose-board", "material-board", "variation-board", "environment-board",
      "detail-board", "wardrobe-board", "palette", "scale", "notes"]) {
      expect(SECTION_KINDS).toContain(k)
    }
  })
})
