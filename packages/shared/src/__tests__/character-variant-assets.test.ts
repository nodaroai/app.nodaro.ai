import { describe, it, expect } from "vitest"
import {
  CHARACTER_VARIANT_ASSET_BUCKETS,
  characterVariantAssetArrays,
  characterSheetRefItems,
  characterBoardItems,
  characterMentionableAssetArrays,
} from "../character-variant-assets.js"

describe("CHARACTER_VARIANT_ASSET_BUCKETS", () => {
  it("includes the original six image/video-variant buckets", () => {
    for (const b of ["expressions", "poses", "motions", "angles", "bodyAngles", "lightingVariations"]) {
      expect(CHARACTER_VARIANT_ASSET_BUCKETS).toContain(b)
    }
  })

  it("includes wardrobe (outfitVariations) and detail close-ups — the previously-dropped studio assets", () => {
    // Regression: studio writes these {name,url}[] buckets but the @-mention /
    // connected-reference expansion historically hardcoded only the first six,
    // so wardrobe + close-ups were invisible in the reference picker and @ list.
    expect(CHARACTER_VARIANT_ASSET_BUCKETS).toContain("outfitVariations")
    expect(CHARACTER_VARIANT_ASSET_BUCKETS).toContain("detailCloseups")
  })

  it("has no duplicates", () => {
    expect(new Set(CHARACTER_VARIANT_ASSET_BUCKETS).size).toBe(CHARACTER_VARIANT_ASSET_BUCKETS.length)
  })
})

describe("characterVariantAssetArrays", () => {
  it("returns one entry per bucket, expanding present arrays", () => {
    const data = {
      expressions: [{ name: "smile", url: "https://x/smile.png" }],
      outfitVariations: [{ name: "red dress", url: "https://x/red.png", description: "evening" }],
      detailCloseups: [{ name: "eyes", url: "https://x/eyes.png" }],
      // unrelated field is ignored
      sourceImageUrl: "https://x/main.png",
    }
    const out = characterVariantAssetArrays(data)
    expect(Object.keys(out).sort()).toEqual([...CHARACTER_VARIANT_ASSET_BUCKETS].sort())
    expect(out.expressions).toEqual([{ name: "smile", url: "https://x/smile.png" }])
    expect(out.outfitVariations).toEqual([{ name: "red dress", url: "https://x/red.png", description: "evening" }])
    expect(out.detailCloseups).toEqual([{ name: "eyes", url: "https://x/eyes.png" }])
  })

  it("coerces missing / non-array buckets to an empty array", () => {
    const out = characterVariantAssetArrays({ poses: "not-an-array" as unknown })
    expect(out.poses).toEqual([])
    expect(out.expressions).toEqual([])
    expect(out.outfitVariations).toEqual([])
  })

  it("tolerates null/undefined input", () => {
    expect(characterVariantAssetArrays(undefined).expressions).toEqual([])
    expect(characterVariantAssetArrays(null).motions).toEqual([])
  })
})

describe("characterSheetRefItems", () => {
  it("maps composite reference sheets to {name,url} items (type + skin label)", () => {
    const sheets = [
      { id: "s1", type: "turnaround", skin: "studio", url: "https://x/t.png", panelUrls: [] },
      { id: "s2", type: "variation-board", skin: "cinematic", url: "https://x/v.png", panelUrls: [] },
    ]
    expect(characterSheetRefItems(sheets)).toEqual([
      { name: "turnaround studio", url: "https://x/t.png" },
      { name: "variation-board cinematic", url: "https://x/v.png" },
    ])
  })

  it("drops sheets with no composite url, tolerates non-arrays", () => {
    expect(characterSheetRefItems([{ type: "detail", url: "" }])).toEqual([])
    expect(characterSheetRefItems(undefined)).toEqual([])
    expect(characterSheetRefItems("nope")).toEqual([])
  })
})

describe("characterBoardItems", () => {
  it("returns the boards column", () => {
    expect(characterBoardItems({ boards: [{ name: "turnaround", url: "https://x/t.png" }] })).toEqual([
      { name: "turnaround", url: "https://x/t.png" },
    ])
  })

  it("surfaces LEGACY shim boards from selectedAssetByVariant (studioBoard / studioBoard:<name>)", () => {
    const out = characterBoardItems({
      selectedAssetByVariant: {
        studioBoard: "https://x/legacy.png",
        "studioBoard:cinematic": "https://x/cine.png",
        "expressions:smile": "https://x/smile.png", // not a board key → ignored
      },
    })
    expect(out).toEqual(
      expect.arrayContaining([
        { name: "board", url: "https://x/legacy.png" },
        { name: "cinematic", url: "https://x/cine.png" },
      ]),
    )
    expect(out).toHaveLength(2)
  })

  it("merges column + shim, column wins on duplicate name", () => {
    const out = characterBoardItems({
      boards: [{ name: "cinematic", url: "https://col/cine.png" }],
      selectedAssetByVariant: {
        "studioBoard:cinematic": "https://shim/cine.png",
        "studioBoard:studio": "https://shim/studio.png",
      },
    })
    expect(out.find((b) => b.name === "cinematic")?.url).toBe("https://col/cine.png")
    expect(out.find((b) => b.name === "studio")?.url).toBe("https://shim/studio.png")
    expect(out).toHaveLength(2)
  })

  it("tolerates null/undefined / url-less", () => {
    expect(characterBoardItems(undefined)).toEqual([])
    expect(characterBoardItems({})).toEqual([])
    expect(characterBoardItems({ boards: [{ name: "x", url: "" }] })).toEqual([])
  })
})

describe("characterMentionableAssetArrays", () => {
  it("includes every variant bucket PLUS derived `sheets` and `boards` buckets", () => {
    const data = {
      expressions: [{ name: "smile", url: "https://x/s.png" }],
      sheets: [{ type: "turnaround", skin: "studio", url: "https://x/t.png" }],
      boards: [{ name: "ref", url: "https://x/b.png" }],
      selectedAssetByVariant: { "studioBoard:cinematic": "https://x/c.png" },
    }
    const out = characterMentionableAssetArrays(data)
    expect(out.expressions).toHaveLength(1)
    expect(out.sheets).toEqual([{ name: "turnaround studio", url: "https://x/t.png" }])
    // boards = column + shim → @-mentionable
    expect(out.boards).toEqual(
      expect.arrayContaining([
        { name: "ref", url: "https://x/b.png" },
        { name: "cinematic", url: "https://x/c.png" },
      ]),
    )
    for (const b of CHARACTER_VARIANT_ASSET_BUCKETS) expect(out[b]).toBeDefined()
  })
})
