import { describe, it, expect } from "vitest"

import {
  LOOK_PICKERS,
  RETIRED_LOOK_IDS,
  liveLookId,
  pickerByKey,
} from "../look-pickers"
import { directionHints, directionWireFields } from "../direction"
import { parseProduction } from "../shot-graph"
import type { Direction } from "../direction"
import type { Workflow } from "@nodaro/sdk"

/** A workflow whose stored settings already hold the retired id. */
const stored = (studio: Record<string, unknown>) =>
  parseProduction({
    id: "wf-1",
    projectId: "p",
    userId: "u",
    name: "n",
    nodes: [],
    edges: [],
    settings: { studio: { version: 3, shots: [], ...studio } },
    createdAt: "",
    updatedAt: "",
  } as unknown as Workflow)

/**
 * Retiring a duplicate option has TWO halves, and shipping only the first is a
 * silent bug: the fold reads `direction[key]` straight from the stored map and
 * never checks the catalog, so an id hidden from the menu would keep riding
 * into the prompt while the card showed "Default".
 */
describe("retired look options", () => {
  it("retires a duplicate to something the catalog still has", () => {
    for (const [gone, kept] of Object.entries(RETIRED_LOOK_IDS)) {
      const all = LOOK_PICKERS.flatMap((p) => p.catalog.map((e) => e.id))
      expect(all).not.toContain(gone)
      expect(all).toContain(kept)
    }
  })

  it("drops Head to Knees from the Shot Size menu", () => {
    const ids = pickerByKey("framingId")!.catalog.map((e) => e.id)
    expect(ids).not.toContain("head-to-knees")
    expect(ids).toContain("medium-wide-shot")
  })

  it("resolves a stored retired id instead of dropping it", () => {
    expect(liveLookId("head-to-knees")).toBe("medium-wide-shot")
    expect(liveLookId("cowboy-shot")).toBe("cowboy-shot")
  })

  it("a production saved with the retired id still frames the same shot", () => {
    // The half that matters. Hydration rewrites the id, so the UI, the fold and
    // the next save all agree — and the picture the user already had does not
    // change, which is the whole reason this retirement is allowed at all.
    const parsed = stored({ film: { framingId: "head-to-knees" } })
    expect(parsed.film).toEqual({ framingId: "medium-wide-shot" })

    // The half that must ALSO hold now the fold is server-side: the migration
    // has to apply on the WIRE, or a run would carry the retired id verbatim and
    // the route (which knows nothing of studio's retirements) would fold nothing.
    const wire = directionWireFields(parsed.film as Direction, "image")
    expect(wire).toEqual({ shotSize: "medium-wide-shot" })
    const hints = directionHints(wire, "image")
    expect(hints.some((h: string) => /knees up/i.test(h))).toBe(true)
  })

  it("the cross-key duplicate is resolved upstream — Layout keeps it, Composition FX no longer has it", () => {
    // `3x3-grid-collage` was the same id AND label in two catalogs; studio hid
    // the effects copy. @nodaro/prompts 1.9.0 removed it there for good.
    const fx = pickerByKey("compositionEffectId")!.catalog.map((e) => e.id)
    expect(fx).not.toContain("3x3-grid-collage")

    const composition = pickerByKey("framingCompositionId")!.catalog.map((e) => e.id)
    expect(composition).toContain("3x3-grid-collage")
  })

  it("a pick stored under the removed effects copy is kept, and folds what the catalog says — nothing", () => {
    // The twin lives on a DIFFERENT key, so the pick cannot migrate; it is left
    // in place (never rewritten) and the catalog, which no longer knows it,
    // contributes no hint for it.
    expect(liveLookId("3x3-grid-collage")).toBe("3x3-grid-collage")

    const parsed = stored({ film: { compositionEffectId: "3x3-grid-collage" } })
    expect(parsed.film).toEqual({ compositionEffectId: "3x3-grid-collage" })
    // Its fragment is "" (the catalog no longer knows the id), so the projection
    // drops it and the wire carries nothing at all.
    expect(directionWireFields(parsed.film as Direction, "image")).toBeUndefined()
  })

  it("keeps the catalog's no-op `none` row out of the Composition FX menu", () => {
    // Studio's tile picker clears with Default; a None tile would be the same
    // action twice. The row is the catalog's default for canvas nodes.
    const fx = pickerByKey("compositionEffectId")!.catalog.map((e) => e.id)
    expect(fx).not.toContain("none")
  })

  it("rewrites the id inside a multi-pick array too", () => {
    const parsed = stored({
      film: { framingId: ["head-to-knees"] },
    })
    expect(parsed.film).toEqual({ framingId: ["medium-wide-shot"] })
  })
})
