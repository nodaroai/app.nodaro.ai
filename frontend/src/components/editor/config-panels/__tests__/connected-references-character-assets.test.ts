import { describe, it, expect } from "vitest"
import { buildImageConnectedReferences } from "../connected-references"
import type { SourceNodeInfo } from "../types"

// Regression (studio-asset parity): a wired character must expand EVERY
// {name,url}[] variant bucket into the connected-reference list that powers both
// the reference picker and the @-mention autocomplete — including wardrobe
// (outfitVariations) and detail close-ups, which studio.nodaro.ai writes but the
// old hardcoded 6-bucket expansion silently dropped.

function wiredCharacter(nodeData: Record<string, unknown>): SourceNodeInfo {
  return { id: "char-1", type: "character", label: "Kira", value: "", nodeData }
}

function build(nodeData: Record<string, unknown>) {
  return buildImageConnectedReferences({
    data: {},
    sources: [wiredCharacter(nodeData)],
    nodes: [],
    attachedChars: [],
  })
}

describe("buildImageConnectedReferences — character variant buckets", () => {
  const nodeData = {
    characterName: "Kira",
    sourceImageUrl: "https://x/main.png",
    expressions: [{ name: "smile", url: "https://x/smile.png" }],
    outfitVariations: [{ name: "red dress", url: "https://x/red.png" }],
    detailCloseups: [{ name: "eyes", url: "https://x/eyes.png" }],
    sheets: [{ id: "s1", type: "turnaround", skin: "studio", url: "https://x/sheet.png", panelUrls: [] }],
    boards: [{ name: "ref board", url: "https://x/board.png" }],
    selectedAssetByVariant: { "studioBoard:cinematic": "https://x/shimboard.png" },
  }

  it("surfaces wardrobe (outfitVariations) variants in the @-mention list", () => {
    const refs = build(nodeData)
    const wardrobe = refs.find((r) => r.variantDisplayName === "red dress")
    expect(wardrobe, "wardrobe variant missing from connected references").toBeTruthy()
    expect(wardrobe!.source).toBe("wired-character")
    expect(wardrobe!.characterSlug).toBe("kira")
    expect(wardrobe!.url).toBe("https://x/red.png")
    expect(wardrobe!.variantSlug).toBeTruthy()
  })

  it("surfaces detail close-up variants in the @-mention list", () => {
    const refs = build(nodeData)
    const closeup = refs.find((r) => r.variantDisplayName === "eyes")
    expect(closeup, "detail close-up missing from connected references").toBeTruthy()
    expect(closeup!.url).toBe("https://x/eyes.png")
  })

  it("still surfaces the canonical + the original six buckets", () => {
    const refs = build(nodeData)
    expect(refs.some((r) => r.variantDisplayName === "canonical")).toBe(true)
    expect(refs.some((r) => r.variantDisplayName === "smile")).toBe(true)
  })

  it("surfaces composite reference sheets as @-mentionable refs", () => {
    const refs = build(nodeData)
    const sheet = refs.find((r) => r.variantDisplayName === "turnaround studio")
    expect(sheet, "reference sheet missing from connected references").toBeTruthy()
    expect(sheet!.url).toBe("https://x/sheet.png")
    expect(sheet!.characterSlug).toBe("kira")
    expect(sheet!.variantSlug).toBe("turnaround-studio")
  })

  it("surfaces reference boards — from BOTH the column and the legacy shim — as @-mentionable refs", () => {
    const refs = build(nodeData)
    const column = refs.find((r) => r.variantDisplayName === "ref board")
    expect(column, "column board missing from connected references").toBeTruthy()
    expect(column!.url).toBe("https://x/board.png")
    // legacy selected_asset_by_variant shim board (studioBoard:cinematic)
    const shim = refs.find((r) => r.variantDisplayName === "cinematic")
    expect(shim, "legacy shim board missing from connected references").toBeTruthy()
    expect(shim!.url).toBe("https://x/shimboard.png")
  })
})
