import { describe, expect, it } from "vitest"
import {
  CHARACTER_PICKER_DISPLAY_ORDER,
  characterBucketDisplayRank,
  characterMentionableAssetArrays,
  sortCharacterEntriesForDisplay,
} from "../character-variant-assets"
import { CHARACTER_ATTACH_COLUMNS } from "../entity-asset-types"

describe("CHARACTER_PICKER_DISPLAY_ORDER", () => {
  it("covers exactly the keys of characterMentionableAssetArrays (drift guard)", () => {
    // If a new bucket is added to the data record without a display rank (or
    // vice versa), pickers would silently drop/misplace it. Fail loudly here.
    const dataKeys = Object.keys(characterMentionableAssetArrays({})).sort()
    const displayKeys = [...CHARACTER_PICKER_DISPLAY_ORDER].sort()
    expect(displayKeys).toEqual(dataKeys)
  })

  it("pins boards first, sheets second", () => {
    expect(CHARACTER_PICKER_DISPLAY_ORDER[0]).toBe("boards")
    expect(CHARACTER_PICKER_DISPLAY_ORDER[1]).toBe("sheets")
  })
})

describe("characterBucketDisplayRank", () => {
  it("ranks canonical (no bucket) before boards, boards before variant buckets", () => {
    expect(characterBucketDisplayRank(undefined)).toBeLessThan(characterBucketDisplayRank("boards"))
    expect(characterBucketDisplayRank("boards")).toBeLessThan(characterBucketDisplayRank("expressions"))
  })

  it("puts unknown buckets last", () => {
    expect(characterBucketDisplayRank("someFutureBucket")).toBeGreaterThan(
      characterBucketDisplayRank("detailCloseups"),
    )
  })
})

describe("sortCharacterEntriesForDisplay", () => {
  it("reorders within a character run (boards first) and keeps non-character items in place", () => {
    const items = [
      { characterSlug: undefined, url: "upload1" },
      { characterSlug: "kira", bucket: undefined, url: "canonical" },
      { characterSlug: "kira", bucket: "expressions", url: "smile" },
      { characterSlug: "kira", bucket: "boards", url: "board1" },
      { characterSlug: undefined, url: "upload2" },
      { characterSlug: "bob", bucket: "poses", url: "bobpose" },
      { characterSlug: "bob", bucket: "boards", url: "bobboard" },
    ]
    const sorted = sortCharacterEntriesForDisplay(items)
    expect(sorted.map((i) => i.url)).toEqual([
      "upload1", "canonical", "board1", "smile", "upload2", "bobboard", "bobpose",
    ])
  })

  it("is stable within the same bucket", () => {
    const items = [
      { characterSlug: "kira", bucket: "boards", url: "b1" },
      { characterSlug: "kira", bucket: "boards", url: "b2" },
    ]
    expect(sortCharacterEntriesForDisplay(items).map((i) => i.url)).toEqual(["b1", "b2"])
  })
})

describe("CHARACTER_ATTACH_COLUMNS", () => {
  it("includes boards (worker auto-attach whitelist, mirrors migration 250)", () => {
    expect(CHARACTER_ATTACH_COLUMNS).toContain("boards")
  })
})
