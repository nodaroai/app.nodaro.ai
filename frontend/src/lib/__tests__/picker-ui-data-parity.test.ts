import { describe, it, expect } from "vitest"
import { ALL_PICKER_WIRING } from "@nodaro/prompts/picker-catalogs"
import { ALL_PARAMETER_PICKERS, PICKER_UI_MODE } from "@/lib/picker-ui"

/**
 * Data-parity guard: whichever lane is active, the registry the app renders
 * from must carry EXACTLY the wiring vocabulary (`picker-wiring.ts` in
 * @nodaro/prompts — the single source of truth).
 *
 * - Stub lane: trivially true (the stub builds from the wiring) — still run,
 *   it guards the stub's assembly.
 * - Rich lane: the REAL guard — the private package's registry is currently a
 *   self-contained copy (it migrates to consuming the wiring once
 *   @nodaro/prompts ships it on npm); until then this test is what makes
 *   drift between the package registry and the wiring impossible to miss.
 */
describe(`picker registry ≡ picker wiring (${PICKER_UI_MODE} lane)`, () => {
  const byType = new Map(ALL_PARAMETER_PICKERS.map((p) => [p.nodeType, p]))

  it("covers exactly the wiring's node types", () => {
    expect([...byType.keys()].sort()).toEqual(ALL_PICKER_WIRING.map((w) => w.nodeType).sort())
  })

  for (const wiring of ALL_PICKER_WIRING) {
    it(`${wiring.nodeType}: kind/fields/catalog match the wiring`, () => {
      const meta = byType.get(wiring.nodeType)
      expect(meta, `registry is missing ${wiring.nodeType}`).toBeDefined()
      if (!meta) return
      expect(meta.kind).toBe(wiring.kind)
      expect(meta.catalogId).toBe(wiring.catalogId)
      if (wiring.kind === "single" && meta.kind === "single") {
        expect(meta.valueField).toBe(wiring.valueField)
        expect(meta.defaultValue).toBe(wiring.defaultValue)
        expect(meta.entries.map((e) => e.id)).toEqual(wiring.entries.map((e) => e.id))
        expect(meta.groupOrder ?? []).toEqual(wiring.groupOrder ?? [])
      } else if (wiring.kind === "multi" && meta.kind === "multi") {
        expect([...meta.fields]).toEqual([...wiring.fields])
        expect(meta.catalogEntries.map((e) => e.id)).toEqual(wiring.catalogEntries.map((e) => e.id))
      }
    })
  }
})
