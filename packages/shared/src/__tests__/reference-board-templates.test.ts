import { describe, it, expect } from "vitest"
import {
  REFERENCE_BOARD_PROVIDERS,
  REFERENCE_BOARD_TEMPLATES,
  buildBoardPrompt,
  listBoardTemplates,
} from "../reference-board-templates.js"

describe("reference-board templates", () => {
  it("ships gen providers as a subset of image providers", () => {
    expect(REFERENCE_BOARD_PROVIDERS).toContain("nano-banana-pro")
    expect(REFERENCE_BOARD_PROVIDERS).toContain("gpt-image-2")
  })

  it("every entity kind has a full-board template", () => {
    for (const kind of ["character", "location", "object"] as const) {
      const ids = listBoardTemplates(kind).map((t) => t.id)
      expect(ids).toContain(`${kind}/full-board`)
    }
  })

  it("full-board prompt carries the three guide tricks", () => {
    const p = buildBoardPrompt("character/full-board", {})
    expect(p.toLowerCase()).toContain("palette")          // 6-HEX palette panel
    expect(p.toLowerCase()).toContain("hex")
    expect(p).toContain("visual reference for consistent depiction") // self-referential caption
    expect(p.toLowerCase()).toContain("aspect ratio")     // anti-rigid AR clause
  })

  it("unknown template id throws (no silent empty prompt)", () => {
    expect(() => buildBoardPrompt("character/nope", {})).toThrow()
  })
})
