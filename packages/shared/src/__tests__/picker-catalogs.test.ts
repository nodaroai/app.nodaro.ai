import { describe, it, expect } from "vitest"
import { PICKER_CATALOGS, getPickerCatalog, listPickerCatalogs } from "../picker-catalogs.js"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"

describe("PICKER_CATALOGS", () => {
  const singles = PICKER_CATALOGS.filter((c) => c.kind === "single")
  const multis = PICKER_CATALOGS.filter((c) => c.kind === "multi")

  it("every single picker exposes options, each with a defined promptHint string", () => {
    // promptHint may be "" for no-op options like "auto"/"none"; it must never
    // be undefined (that would mean a catalog entry was missing the field).
    expect(singles.length).toBeGreaterThan(0)
    for (const c of singles) {
      expect(c.options, c.nodeType).toBeDefined()
      expect(c.options!.length, c.nodeType).toBeGreaterThan(0)
      for (const o of c.options!) {
        expect(typeof o.promptHint, `${c.nodeType}:${o.id}`).toBe("string")
      }
    }
  })

  it("every multi picker exposes fields and no flattened options", () => {
    expect(multis.length).toBeGreaterThan(0)
    for (const c of multis) {
      expect(c.fields, c.nodeType).toBeDefined()
      expect(c.fields!.length, c.nodeType).toBeGreaterThan(0)
      expect(c.options, c.nodeType).toBeUndefined()
    }
  })

  // The four Object-entity catalogs (animal/vehicle/weapon/furniture) carry no
  // `promptHint` field — the registry synthesizes it. Prove that synthesized text
  // is byte-identical to what getParameterPromptHint actually injects, so the
  // duplication cannot silently drift.
  it.each(["animal", "vehicle", "weapon", "furniture"])(
    "%s: option.promptHint matches getParameterPromptHint output",
    (nodeType) => {
      const c = getPickerCatalog(nodeType)
      expect(c?.options?.length, nodeType).toBeGreaterThan(0)
      for (const o of c!.options!) {
        const hint = getParameterPromptHint({ type: nodeType, data: { [c!.valueField!]: o.id } })
        expect(hint, `${nodeType}:${o.id}`).toBe(o.promptHint)
      }
    },
  )

  it("lookups resolve by nodeType and catalogId", () => {
    expect(getPickerCatalog("mood")?.nodeType).toBe("mood")
    expect(getPickerCatalog("setting")?.catalogId).toBe("setting")
    expect(getPickerCatalog("does-not-exist")).toBeUndefined()
    expect(listPickerCatalogs().length).toBe(PICKER_CATALOGS.length)
  })
})
