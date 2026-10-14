import { describe, it, expect } from "vitest"
import { nodeAspectRatio, PHOTO_AUTO_ASPECT_NODE_TYPES } from "../normalize-node-params.js"

describe("nodeAspectRatio — unset is Auto on the photo-Auto nodes", () => {
  it("fills auto for an unset or blank ratio on Generate Image and Modify Image", () => {
    for (const type of PHOTO_AUTO_ASPECT_NODE_TYPES) {
      expect(nodeAspectRatio(type, undefined)).toBe("auto")
      expect(nodeAspectRatio(type, "")).toBe("auto")
      expect(nodeAspectRatio(type, "  ")).toBe("auto")
      expect(nodeAspectRatio(type, null)).toBe("auto")
    }
  })

  it("returns a set ratio untouched", () => {
    expect(nodeAspectRatio("modify-image", "3:4")).toBe("3:4")
    expect(nodeAspectRatio("generate-image", "auto")).toBe("auto")
  })

  it("leaves every other node type alone", () => {
    expect(nodeAspectRatio("image-to-image", undefined)).toBeUndefined()
    expect(nodeAspectRatio("edit-image", undefined)).toBeUndefined()
    expect(nodeAspectRatio(undefined, undefined)).toBeUndefined()
    expect(nodeAspectRatio("image-to-image", "1:1")).toBe("1:1")
  })
})
