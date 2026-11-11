import { describe, expect, it } from "vitest"
import { PRESET_SHELF_ORDER, getFactoryPresets, presetShelf, presetShelfRank } from "../factory-presets.js"

describe("the image catalog's shelves", () => {
  it("files every group of the generate-image catalog on a shelf a picker shows", () => {
    const groups = [...new Set(getFactoryPresets("generate-image").map((preset) => preset.group ?? ""))]
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) expect(PRESET_SHELF_ORDER).toContain(presetShelf(group))
  })

  it("puts the named groups on their shelves and the pro catalog's on Studio · Pro", () => {
    expect(presetShelf("YouTube")).toBe("video")
    expect(presetShelf("Social & Ads")).toBe("marketing")
    expect(presetShelf("Personal Photos")).toBe("photos")
    expect(presetShelf("Text")).toBe("creative")
    expect(presetShelf("Family & Events")).toBe("life")
    expect(presetShelf("Reference Sheet")).toBe("pro")
    expect(presetShelf("Edits")).toBe("pro")
  })

  it("puts a group no shelf names on More, so a new group still shows", () => {
    expect(presetShelf("A Group Added Later")).toBe("more")
    expect(presetShelfRank("A Group Added Later")).toBe(-1)
  })

  it("ranks the named groups in the design's order", () => {
    expect(presetShelfRank("YouTube")).toBeLessThan(presetShelfRank("Social & Ads"))
    expect(presetShelfRank("Life & Events")).toBeLessThan(presetShelfRank("Family & Events"))
  })
})
