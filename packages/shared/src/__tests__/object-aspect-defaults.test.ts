import { describe, expect, it } from "vitest"
import {
  OBJECT_ASPECT_OPTIONS,
  OBJECT_ASPECT_DEFAULTS,
  isObjectAspectRatio,
  resolveObjectAspectRatio,
} from "../object-aspect-defaults.js"

describe("object-aspect-defaults", () => {
  describe("OBJECT_ASPECT_DEFAULTS", () => {
    it("defaults every asset type to 1:1", () => {
      for (const ratio of Object.values(OBJECT_ASPECT_DEFAULTS)) {
        expect(ratio).toBe("1:1")
      }
    })

    it("covers all 5 asset types", () => {
      const keys = Object.keys(OBJECT_ASPECT_DEFAULTS).sort()
      expect(keys).toEqual(["angles", "custom", "materials", "motion", "variations"])
    })
  })

  describe("isObjectAspectRatio", () => {
    it.each(OBJECT_ASPECT_OPTIONS)("accepts %s", (ratio) => {
      expect(isObjectAspectRatio(ratio)).toBe(true)
    })

    it("rejects unknown strings", () => {
      expect(isObjectAspectRatio("garbage")).toBe(false)
      expect(isObjectAspectRatio("")).toBe(false)
    })
  })

  describe("resolveObjectAspectRatio", () => {
    it("explicit wins over everything else", () => {
      expect(
        resolveObjectAspectRatio({ explicit: "16:9", nodeOverride: "9:16", assetType: "angles" }),
      ).toBe("16:9")
    })

    it("nodeOverride beats per-asset-type default", () => {
      expect(
        resolveObjectAspectRatio({ explicit: null, nodeOverride: "3:4", assetType: "motion" }),
      ).toBe("3:4")
    })

    it("falls through to per-asset-type default when both soft inputs are null/garbage", () => {
      expect(
        resolveObjectAspectRatio({ explicit: "garbage", nodeOverride: null, assetType: "materials" }),
      ).toBe("1:1")
    })

    it("ignores a stale nodeOverride that's not in the options enum", () => {
      expect(
        resolveObjectAspectRatio({ explicit: null, nodeOverride: "21:9", assetType: "angles" }),
      ).toBe("1:1")
    })
  })
})
