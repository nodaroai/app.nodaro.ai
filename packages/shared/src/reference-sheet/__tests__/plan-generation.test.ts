import { describe, it, expect } from "vitest"
import { planSheetGeneration, resolveSheetSections } from "../plan-generation.js"
import { BOARD_TO_ASSET_TYPE, DEFAULT_SECTIONS } from "../catalog.js"
import { SHEET_TYPES } from "../types.js"
import type { SheetFlavour, EntityKind, SheetType } from "../types.js"
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

describe("resolveSheetSections", () => {
  it("falls back to the default stack for (entityKind, type) when no sections are passed", () => {
    // The canvas node / workflow / API callers send only `type`. Without this
    // fallback the worker composes with zero bands → a blank sheet (the bug).
    const r = resolveSheetSections("character", "full-reference")
    expect(r.length).toBeGreaterThan(0)
    expect(r.map((s) => s.kind)).toEqual(DEFAULT_SECTIONS.character["full-reference"].map((s) => s.kind))
  })
  it("uses the explicit section stack when provided (Studio tab path)", () => {
    const r = resolveSheetSections("object", "full-reference", [{ kind: "header" }, { kind: "palette" }])
    expect(r.map((s) => s.kind)).toEqual(["header", "palette"])
  })
  it("treats an empty sections array as 'not provided' and falls back to the default", () => {
    expect(resolveSheetSections("location", "turnaround", []).length).toBeGreaterThan(0)
  })
  it("returns a fresh clone — mutating the result never mutates DEFAULT_SECTIONS", () => {
    const before = DEFAULT_SECTIONS.character.turnaround.length
    const r = resolveSheetSections("character", "turnaround")
    r.push({ kind: "notes" })
    ;(r[0] as { subtitle?: string }).subtitle = "mutated"
    expect(DEFAULT_SECTIONS.character.turnaround.length).toBe(before)
    expect(DEFAULT_SECTIONS.character.turnaround[0]).not.toHaveProperty("subtitle")
  })
  it("INVARIANT: every (entityKind, type) yields a non-empty default stack", () => {
    // Root-cause guard: a type with no default stack would make a node sheet
    // compose zero bands (blank). If a future edit empties one, this fails loudly.
    for (const kind of Object.keys(DEFAULT_SECTIONS) as EntityKind[]) {
      for (const type of SHEET_TYPES as readonly SheetType[]) {
        expect(resolveSheetSections(kind, type).length, `${kind}/${type}`).toBeGreaterThan(0)
      }
    }
  })
})
