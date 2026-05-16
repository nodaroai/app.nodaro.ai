import { describe, it, expect } from "vitest"
import {
  CHARACTER_ASPECT_DEFAULTS,
  CHARACTER_ASPECT_OPTIONS,
  isCharacterAspectRatio,
  resolveCharacterAspectRatio,
} from "../character-aspect-defaults.js"

describe("CHARACTER_ASPECT_OPTIONS", () => {
  it("exposes exactly the 4 supported values in canonical order", () => {
    expect(CHARACTER_ASPECT_OPTIONS).toEqual(["1:1", "3:4", "16:9", "9:16"])
  })
})

describe("isCharacterAspectRatio", () => {
  it("accepts every option in the registry", () => {
    for (const ar of CHARACTER_ASPECT_OPTIONS) {
      expect(isCharacterAspectRatio(ar)).toBe(true)
    }
  })

  it("rejects values outside the union", () => {
    expect(isCharacterAspectRatio("4:3")).toBe(false)
    expect(isCharacterAspectRatio("21:9")).toBe(false)
    expect(isCharacterAspectRatio("")).toBe(false)
    expect(isCharacterAspectRatio("1:1 ")).toBe(false)
    expect(isCharacterAspectRatio("1x1")).toBe(false)
  })
})

describe("CHARACTER_ASPECT_DEFAULTS", () => {
  it("matches the per-asset-type spec table", () => {
    expect(CHARACTER_ASPECT_DEFAULTS).toEqual({
      portrait: "3:4",
      expressions: "1:1",
      poses: "9:16",
      angles: "3:4",
      headAngles: "3:4",
      bodyAngles: "9:16",
      lighting: "3:4",
      motions: "9:16",
    })
  })
})

describe("resolveCharacterAspectRatio — precedence", () => {
  // Spec: explicit > node override > per-asset-type default.

  it("returns the per-asset-type default when neither explicit nor node override is set", () => {
    expect(resolveCharacterAspectRatio({ assetType: "portrait" })).toBe("3:4")
    expect(resolveCharacterAspectRatio({ assetType: "expressions" })).toBe("1:1")
    expect(resolveCharacterAspectRatio({ assetType: "poses" })).toBe("9:16")
    expect(resolveCharacterAspectRatio({ assetType: "headAngles" })).toBe("3:4")
    expect(resolveCharacterAspectRatio({ assetType: "bodyAngles" })).toBe("9:16")
    expect(resolveCharacterAspectRatio({ assetType: "lighting" })).toBe("3:4")
    expect(resolveCharacterAspectRatio({ assetType: "motions" })).toBe("9:16")
    expect(resolveCharacterAspectRatio({ assetType: "angles" })).toBe("3:4")
  })

  it("returns the node override when explicit is not set", () => {
    expect(
      resolveCharacterAspectRatio({
        assetType: "portrait",
        nodeOverride: "16:9",
      }),
    ).toBe("16:9")
    expect(
      resolveCharacterAspectRatio({
        assetType: "expressions",
        nodeOverride: "9:16",
      }),
    ).toBe("9:16")
  })

  it("returns explicit when set, regardless of node override or default", () => {
    expect(
      resolveCharacterAspectRatio({
        assetType: "portrait",
        explicit: "1:1",
        nodeOverride: "16:9",
      }),
    ).toBe("1:1")
    expect(
      resolveCharacterAspectRatio({
        assetType: "motions",
        explicit: "16:9",
        nodeOverride: "1:1",
      }),
    ).toBe("16:9")
  })

  it("treats null / undefined / empty string as 'not set' at each layer", () => {
    // explicit null/empty → falls through to nodeOverride
    expect(
      resolveCharacterAspectRatio({
        assetType: "poses",
        explicit: null,
        nodeOverride: "1:1",
      }),
    ).toBe("1:1")
    expect(
      resolveCharacterAspectRatio({
        assetType: "poses",
        explicit: "",
        nodeOverride: "3:4",
      }),
    ).toBe("3:4")
    // node override null/empty → falls through to per-asset default
    expect(
      resolveCharacterAspectRatio({
        assetType: "lighting",
        explicit: null,
        nodeOverride: null,
      }),
    ).toBe("3:4")
  })

  it("ignores an invalid (out-of-registry) explicit / node override value", () => {
    // Invalid explicit value: fall through to node override.
    expect(
      resolveCharacterAspectRatio({
        assetType: "portrait",
        explicit: "21:9",
        nodeOverride: "9:16",
      }),
    ).toBe("9:16")
    // Invalid explicit AND invalid node override: fall through to per-asset default.
    expect(
      resolveCharacterAspectRatio({
        assetType: "headAngles",
        explicit: "21:9",
        nodeOverride: "4:3",
      }),
    ).toBe("3:4")
  })

  it("treats legacy `angles` alias same as `headAngles`", () => {
    expect(resolveCharacterAspectRatio({ assetType: "angles" })).toBe(
      CHARACTER_ASPECT_DEFAULTS.headAngles,
    )
  })
})
