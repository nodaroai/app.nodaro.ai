import { describe, expect, it } from "vitest"
import { buildBoardImageGroups, uniqueBoardName, MAX_BOARD_IMAGES, MIN_BOARD_IMAGES, MAX_CHARACTER_BOARDS } from "../board-constants"
import type { CharacterNodeData } from "@/types/nodes"

describe("uniqueBoardName", () => {
  it("returns the desired name when free", () => {
    expect(uniqueBoardName("Evening gown", ["Other"])).toBe("Evening gown")
  })
  it("suffixes on collision, case-insensitively", () => {
    expect(uniqueBoardName("evening GOWN", ["Evening gown"])).toBe("evening GOWN 2")
    expect(uniqueBoardName("Look", ["Look", "Look 2"])).toBe("Look 3")
  })
  it("falls back for an empty name", () => {
    expect(uniqueBoardName("  ", [])).toBe("Board 2")
  })
})

describe("buildBoardImageGroups", () => {
  const d = {
    sourceImageUrl: "https://r2/portrait.png",
    expressions: [
      { name: "smile", url: "https://r2/smile.png" },
      { name: "dup-of-portrait", url: "https://r2/portrait.png" },
    ],
    poses: [{ name: "run", url: "https://r2/run.png" }],
    angles: [],
    bodyAngles: [],
    lightingVariations: [],
    outfitVariations: [{ name: "gown", url: "https://r2/gown.png" }],
    detailCloseups: [],
    sheets: [{ type: "turnaround", skin: "studio", url: "https://r2/sheet.png" }],
    referencePhotos: [{ url: "https://r2/photo.png", kind: "front" }],
  } as unknown as CharacterNodeData

  it("groups in the fixed order, hides empty groups, dedups by URL (first wins)", () => {
    const groups = buildBoardImageGroups(d)
    expect(groups.map((g) => g.id)).toEqual([
      "portrait", "expressions", "poses", "wardrobe", "sheets", "referencePhotos",
    ])
    const expressionUrls = groups.find((g) => g.id === "expressions")!.items.map((i) => i.url)
    expect(expressionUrls).toEqual(["https://r2/smile.png"]) // portrait dup dropped
  })

  it("returns [] for an empty character", () => {
    expect(buildBoardImageGroups({} as CharacterNodeData)).toEqual([])
  })
})

describe("caps", () => {
  it("mirror the studio + backend policy", () => {
    expect(MAX_CHARACTER_BOARDS).toBe(12)
    expect(MIN_BOARD_IMAGES).toBe(2)
    expect(MAX_BOARD_IMAGES).toBe(12)
  })
})
