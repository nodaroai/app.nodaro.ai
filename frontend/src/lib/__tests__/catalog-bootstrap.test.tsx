/**
 * The display half of catalog curation: the browser registers the server's
 * composed catalogs and the pickers show THOSE. What must hold:
 *   - a curated payload narrows what a picker lists and rewords what it kept;
 *   - `curated: false` registers nothing (mainline: pickers untouched, by identity);
 *   - the presentation registry — frozen at import — curates at read;
 *   - a picker mounted BEFORE the packs land re-renders when they do;
 *   - a catalog this bundle does not know is skipped, never thrown on.
 */
import { afterEach, describe, expect, it } from "vitest"
import { render, act } from "@testing-library/react"
import { SETTINGS, getPickerCatalog, resetCatalogPacks } from "@nodaro/prompts"
import { useCuratedEntries, getParameterPickerMeta } from "@/lib/picker-ui"
import { applyServerCatalogs, __resetCatalogBootstrapForTests } from "../catalog-bootstrap"

afterEach(() => __resetCatalogBootstrapForTests())

/** A server payload that keeps only the first two settings and rewords the first. */
function curatedSettingsPayload() {
  const base = getPickerCatalog("setting")!
  const kept = base.options!.slice(0, 2).map((o, i) => (i === 0 ? { ...o, label: "Curated First" } : o))
  return { curated: true, packs: 1, version: 7, data: [{ ...base, options: kept }] }
}

describe("applyServerCatalogs", () => {
  it("curated: false registers nothing — the picker keeps the bundled list by identity", () => {
    expect(applyServerCatalogs({ curated: false, data: [] })).toBe(0)
    let seen: readonly unknown[] = []
    function P() {
      seen = useCuratedEntries("setting", SETTINGS)
      return null
    }
    render(<P />)
    expect(seen).toBe(SETTINGS)
  })

  it("a curated payload narrows and rewords the picker's list", () => {
    expect(applyServerCatalogs(curatedSettingsPayload())).toBe(1)
    let seen: readonly { id: string; label: string }[] = []
    function P() {
      seen = useCuratedEntries("setting", SETTINGS)
      return null
    }
    render(<P />)
    expect(seen).toHaveLength(2)
    expect(seen[0].id).toBe(SETTINGS[0].id)
    expect(seen[0].label).toBe("Curated First")
    // A picker-only field the wire cannot carry survives from the base entry.
    expect(seen[0]).toHaveProperty("category", SETTINGS[0].category)
  })

  it("the presentation registry (frozen at import) is curated at read", () => {
    const before = getParameterPickerMeta("setting")!
    expect(before.kind).toBe("single")
    const stockCount = before.kind === "single" ? before.entries.length : 0
    applyServerCatalogs(curatedSettingsPayload())
    const after = getParameterPickerMeta("setting")!
    expect(after.kind === "single" && after.entries.length).toBe(2)
    expect(stockCount).toBeGreaterThan(2)
    expect(after.kind === "single" && after.entries[0].label).toBe("Curated First")
    // Other catalogs untouched by the payload stay by identity.
    expect(getParameterPickerMeta("pose")).toBe(getParameterPickerMeta("pose"))
  })

  it("a picker mounted before the packs land re-renders and narrows", () => {
    let renders = 0
    let seen: readonly unknown[] = []
    function P() {
      seen = useCuratedEntries("setting", SETTINGS)
      renders++
      return null
    }
    render(<P />)
    expect(seen).toBe(SETTINGS)
    const before = renders
    act(() => {
      applyServerCatalogs(curatedSettingsPayload())
    })
    expect(renders).toBeGreaterThan(before)
    expect(seen).toHaveLength(2)
  })

  it("a catalog this bundle does not know is skipped rather than thrown on", () => {
    const base = getPickerCatalog("setting")!
    const payload = { curated: true, packs: 2, version: 1, data: [{ ...base, catalogId: "from-the-future", nodeType: "future" }, base] }
    expect(() => applyServerCatalogs(payload)).not.toThrow()
    expect(applyServerCatalogs(payload)).toBe(1)
  })

  it("re-applying is idempotent (StrictMode / refetch cannot double-register)", () => {
    applyServerCatalogs(curatedSettingsPayload())
    expect(() => applyServerCatalogs(curatedSettingsPayload())).not.toThrow()
    resetCatalogPacks()
  })
})
