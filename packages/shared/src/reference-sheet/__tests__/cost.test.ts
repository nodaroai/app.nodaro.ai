import { describe, it, expect } from "vitest"
import { estimateSheetCost } from "../cost.js"
import { SHEET_PRESETS } from "../presets.js"
import type { SheetFlavour, SheetSection } from "../types.js"

const fl: SheetFlavour = { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" }
const main = SHEET_PRESETS.find((p) => p.id === "studio-main")!

describe("estimateSheetCost", () => {
  it("all panels missing → prepareCost = missing × perPanel, total += assembly", () => {
    const e = estimateSheetCost("character", main.baseSections, fl, {}, "Kaia", 1, 4)
    expect(e.missing).toHaveLength(7)
    expect(e.present).toBe(0)
    expect(e.prepareCost).toBe(7)
    expect(e.total).toBe(11)
    expect(e.overflow).toBe(false)
  })
  it("present panels are not re-charged", () => {
    const buckets = { angles: [{ name: "front", url: "u/f" }], body_angles: [{ name: "front", url: "u/bf" }] }
    const e = estimateSheetCost("character", main.baseSections, fl, buckets, "Kaia", 1, 4)
    expect(e.present).toBe(2)
    expect(e.prepareCost).toBe(5)
    expect(e.total).toBe(9)
  })
  it("overflow (> MAX_PANELS) returns overflow:true instead of throwing", () => {
    // 25 explicit entries > MAX_PANELS_PER_SHEET (24) → planSheetPanels throws;
    // estimateSheetCost must catch it. (panelCount would clamp to the board
    // length and never overflow, so use entries to force it.)
    const huge: SheetSection[] = [{
      kind: "head-turnaround",
      entries: Array.from({ length: 25 }, (_, i) => ({ kind: "preset" as const, variant: `v${i}` })),
    }]
    const e = estimateSheetCost("character", huge, fl, {}, "Kaia", 1, 4)
    expect(e.overflow).toBe(true)
    expect(e.missing).toHaveLength(0)
    expect(e.total).toBe(4) // assembly only
  })
})
