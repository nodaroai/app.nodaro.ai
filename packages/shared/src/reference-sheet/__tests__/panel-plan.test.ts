import { describe, it, expect } from "vitest"
import { planSheetPanels } from "../panel-plan.js"
import { DEFAULT_SECTIONS } from "../catalog.js"
import type { SheetFlavour } from "../types.js"

const flavour = (sections?: SheetFlavour["sections"]): SheetFlavour => ({
  outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey", sections,
})

describe("planSheetPanels", () => {
  it("turnaround default = 4 head angles for a character", () => {
    const panels = planSheetPanels("character", DEFAULT_SECTIONS.character.turnaround, flavour())
    expect(panels).toHaveLength(4)
    expect(panels.map((p) => p.variant)).toEqual(["front", "3/4 left", "left profile", "right profile"])
    expect(panels.every((p) => p.board === "headAngles")).toBe(true)
  })
  it("structural sections (header/palette/notes) yield no panels", () => {
    const panels = planSheetPanels("character", [{ kind: "header" }, { kind: "palette" }, { kind: "notes" }], flavour())
    expect(panels).toHaveLength(0)
  })
  it("custom entries become custom panels carrying their prompt", () => {
    const panels = planSheetPanels("character", [
      { kind: "expression-board", entries: [
        { kind: "custom", label: "Tired & Sweaty", prompt: "exhausted, sweaty, heavy eyes" },
        { kind: "preset", variant: "smile" },
      ] },
    ], flavour())
    expect(panels).toHaveLength(2)
    const custom = panels.find((p) => p.custom)!
    expect(custom.variant).toBe("Tired & Sweaty")
    expect(custom.prompt).toBe("exhausted, sweaty, heavy eyes")
    expect(panels.find((p) => !p.custom)!.variant).toBe("smile")
  })
  it("panelCount clamps to available variants (seasons has only 4)", () => {
    const panels = planSheetPanels("location",
      [{ kind: "environment-board", board: "seasons", panelCount: 9 }], flavour())
    expect(panels).toHaveLength(4)
    expect(panels.map((p) => p.variant)).toEqual(["spring", "summer", "autumn", "winter"])
  })
  it("clamps a non-positive panelCount to zero panels (never a negative slice)", () => {
    expect(planSheetPanels("character", [{ kind: "expression-board", panelCount: -3 }], flavour())).toHaveLength(0)
    expect(planSheetPanels("character", [{ kind: "expression-board", panelCount: 0 }], flavour())).toHaveLength(0)
  })
  it("throws when a board section has no resolvable board", () => {
    expect(() => planSheetPanels("location", [{ kind: "environment-board" }], flavour()))
      .toThrow(/environment-board/)
  })
  it("throws when total panels exceed MAX_PANELS_PER_SHEET", () => {
    // Spread 30 custom panels across 3 distinct boards (10 each) so no single
    // board trips MAX_CUSTOM_ENTRIES_PER_BOARD (12) — the sheet-total cap (24)
    // is what must fire here.
    const ten = (p: string) =>
      Array.from({ length: 10 }, (_, i) => ({ kind: "custom" as const, label: `${p}${i}`, prompt: "x" }))
    expect(() => planSheetPanels("character", [
      { kind: "expression-board", entries: ten("e") },
      { kind: "pose-board", entries: ten("p") },
      { kind: "detail-board", entries: ten("d") },
    ], flavour()))
      .toThrow(/too many panels|MAX_PANELS/i)
  })
})
