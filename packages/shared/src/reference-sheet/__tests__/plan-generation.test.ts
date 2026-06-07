import { describe, it, expect } from "vitest"
import { planSheetGeneration } from "../plan-generation.js"
import { BOARD_TO_ASSET_TYPE } from "../catalog.js"
import type { SheetFlavour } from "../types.js"
const fl: SheetFlavour = { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" }

describe("BOARD_TO_ASSET_TYPE", () => {
  it("maps standard boards to their assetType and detail/wardrobe to custom", () => {
    expect(BOARD_TO_ASSET_TYPE.character.headAngles).toBe("headAngles")
    expect(BOARD_TO_ASSET_TYPE.character.detail).toBe("custom")
    expect(BOARD_TO_ASSET_TYPE.character.wardrobe).toBe("custom")
    expect(BOARD_TO_ASSET_TYPE.object.materials).toBe("materials")
    expect(BOARD_TO_ASSET_TYPE.location.timeOfDay).toBe("timeOfDay")
  })
})

describe("planSheetGeneration", () => {
  it("splits present vs missing and builds generate requests for missing", () => {
    const buckets = { angles: [{ name: "front", url: "u/front" }] } // head-turnaround maps to 'angles' column
    const r = planSheetGeneration("character",
      [{ kind: "head-turnaround", entries: [{ kind: "preset", variant: "front" }, { kind: "preset", variant: "3/4 left" }] }],
      fl, buckets, "Kaia")
    expect(r.presentUrls).toEqual(["u/front"])
    expect(r.missing).toHaveLength(1)
    expect(r.missing[0]).toMatchObject({ assetType: "headAngles", variant: "3/4 left", attachToColumn: "angles", attachName: "3/4 left" })
    expect(r.missing[0].userPrompt).toBeUndefined() // standard board, no custom prompt
  })
  it("detail board missing panels use assetType 'custom' + a built userPrompt", () => {
    const r = planSheetGeneration("character", [{ kind: "detail-board", entries: [{ kind: "preset", variant: "eyes" }] }], fl, {}, "Kaia")
    expect(r.missing[0]).toMatchObject({ assetType: "custom", attachToColumn: "detail_closeups", variant: "eyes" })
    expect(r.missing[0].userPrompt).toContain("eyes")
  })
  it("custom entries carry their own prompt", () => {
    const r = planSheetGeneration("character", [{ kind: "expression-board", entries: [{ kind: "custom", label: "Tired", prompt: "exhausted" }] }], fl, {}, "Kaia")
    expect(r.missing[0]).toMatchObject({ assetType: "expressions", attachToColumn: "expressions", variant: "Tired", userPrompt: "exhausted" })
  })
})
