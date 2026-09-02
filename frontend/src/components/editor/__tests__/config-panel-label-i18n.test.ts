import { describe, it, expect } from "vitest"
import { nodeLabelFieldValue, nodeLabelFieldCommit, nodeTypeDefaultLabel } from "../config-panel-label"
import { NODE_DEFINITIONS } from "@/types/nodes"

// The config panel's Label field is bound to the node's persisted label — the
// English default for an untouched node. Under Hebrew it read "Generate Image"
// under a Hebrew heading. The field now SHOWS the localized default (same
// table as the canvas header) and persists what the user types; typing the
// localized default back (edit, then undo) restores the English default so a
// round-trip never persists the translation as a custom name.
describe("config panel Label field", () => {
  it("shows the localized default for an untouched node", () => {
    expect(nodeLabelFieldValue("Generate Image", "he")).toBe("יצירת תמונה")
    expect(nodeLabelFieldValue("Generate Image", "en")).toBe("Generate Image")
  })
  it("shows a custom name verbatim", () => {
    expect(nodeLabelFieldValue("My hero shot", "he")).toBe("My hero shot")
  })
  it("persists a typed custom name", () => {
    expect(nodeLabelFieldCommit("יצירת תמונה 2", "Generate Image", "he")).toBe("יצירת תמונה 2")
  })
  it("maps the localized default back to the English default", () => {
    expect(nodeLabelFieldCommit("יצירת תמונה", "Generate Image", "he")).toBe("Generate Image")
    expect(nodeLabelFieldCommit("Generate Image", "Generate Image", "en")).toBe("Generate Image")
  })
})

/**
 * The production wiring compares the typed value against the localized form
 * of `nodeTypeDefaultLabel(type)` — the node definition's own persisted label,
 * so the field's default and the stored default can never disagree. Pinned
 * for every definition: the field SHOWS Hebrew for the untouched default
 * (NODE_LABELS_HE knows the persisted string) and typing it back restores it.
 */
describe("Label field default ↔ persisted node label", () => {
  const defs = NODE_DEFINITIONS.filter((d) => typeof d.label === "string" && d.label.length > 0)
  it("covers the node palette", () => {
    expect(defs.length).toBeGreaterThan(150)
  })
  it("derives the default from the definition, not a second table", () => {
    for (const d of defs) expect(nodeTypeDefaultLabel(d.type), d.type).toBe(d.label)
  })
  it("shows Hebrew for every untouched default and round-trips it", () => {
    const stillEnglish: string[] = []
    for (const d of defs) {
      const shown = nodeLabelFieldValue(d.label, "he")
      if (shown === d.label) stillEnglish.push(d.label)
      expect(nodeLabelFieldCommit(shown, nodeTypeDefaultLabel(d.type), "he"), d.type).toBe(d.label)
    }
    expect(stillEnglish, `defaults with no Hebrew: ${stillEnglish.join(", ")}`).toEqual([])
  })
})
