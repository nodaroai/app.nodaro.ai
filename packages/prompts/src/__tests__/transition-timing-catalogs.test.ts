/**
 * The transition node's three timing parameters (position / duration /
 * intensity) are enumerable catalogs, not free values, so a consumer that can
 * only send ids — Studio, the SDK, MCP — can offer them without composing any
 * prompt text of its own.
 *
 * Two properties matter, and both are easy to lose silently:
 *
 *  1. The clause the composer INJECTS and the hint the catalog ADVERTISES are
 *     the same string. They are derived from one array in `transitions.ts`, and
 *     these tests fail the moment someone re-introduces a second copy.
 *  2. The dimensions survive the wire projection. `projectPickerCatalog` used
 *     to return `options` only for a `kind: "single"` catalog, which silently
 *     dropped them — green unit tests on the in-memory catalog would not have
 *     caught it.
 */
import { describe, it, expect } from "vitest"
import {
  TRANSITION_POSITIONS,
  TRANSITION_DURATIONS,
  TRANSITION_INTENSITIES,
  composeTransitionHintFromConnections,
} from "../transitions.js"
import { PICKER_CATALOGS, projectPickerCatalog } from "../picker-catalogs.js"

const DIMENSIONS = [
  ["position", TRANSITION_POSITIONS],
  ["duration", TRANSITION_DURATIONS],
  ["intensity", TRANSITION_INTENSITIES],
] as const

const transitionCatalog = PICKER_CATALOGS.find((c) => c.nodeType === "transition")!

describe("transition timing catalogs", () => {
  // The `TransitionPosition` / `Duration` / `Intensity` unions are DERIVED from
  // these arrays, so nothing at the type level can pin the values themselves.
  // These are the values the editor dropdowns, the node data, and every stored
  // workflow already use: changing one is a data migration, not a rename.
  it("spells exactly the ids every stored workflow already uses", () => {
    expect(TRANSITION_POSITIONS.map((o) => o.id)).toEqual([
      "auto", "start", "middle", "end", "full",
    ])
    expect(TRANSITION_DURATIONS.map((o) => o.id)).toEqual([
      "auto", "instant", "short", "medium", "long",
    ])
    expect(TRANSITION_INTENSITIES.map((o) => o.id)).toEqual([
      "auto", "subtle", "natural", "dynamic", "crazy",
    ])
  })

  it("carries the timing precision users read off the dropdown", () => {
    // The editor used to hand-write these labels and had already drifted from
    // the catalog on all three rows. It now renders straight from here, so this
    // is the one place the numbers live.
    expect(TRANSITION_DURATIONS.map((o) => o.label)).toEqual([
      "Auto", "Instant", "Short (~1s)", "Medium (~2s)", "Long (~3s)",
    ])
  })

  it("gives every injecting step a compact term, so compact mode never drops it", () => {
    // `catalog-terms.test.ts` enforces this globally; pinned here too because
    // the platform composes timing from `promptHint` in BOTH hint modes, so a
    // broken `term` would only ever surface on an external compact client.
    for (const [field, options] of DIMENSIONS) {
      for (const o of options.slice(1)) {
        expect(o.term, `${field}/${o.id} needs a compact term`).toBeTruthy()
      }
      expect(options[0]!.term, `${field}/auto injects nothing`).toBe("")
    }
  })

  it("derives a clause for every non-auto step, so the composer can't index a hole", () => {
    // The regression this guards: a step present in the catalog but missing
    // from the clause table made `parts.push(undefined)` render as a dangling
    // ", " on a prompt that shipped to the provider.
    for (const [field, options] of DIMENSIONS) {
      for (const o of options.slice(1)) {
        const composed = composeTransitionHintFromConnections("cross-dissolve", [], [], {
          [field]: o.id,
        } as never)
        expect(composed, `${field}/${o.id} composed a dangling separator`).not.toMatch(/,\s*$/)
        expect(composed, `${field}/${o.id}`).not.toContain("undefined")
      }
    }
  })

  it("every scale leads with a no-op `auto` that injects nothing", () => {
    for (const [field, options] of DIMENSIONS) {
      expect(options[0]!.id, `${field} must lead with auto`).toBe("auto")
      expect(options[0]!.promptHint, `${field}/auto must inject nothing`).toBe("")
      // Every other step must actually carry a clause.
      for (const o of options.slice(1)) {
        expect(o.promptHint, `${field}/${o.id} needs a promptHint`).not.toBe("")
      }
    }
  })

  it("the composed clause is the catalog's own promptHint, verbatim", () => {
    // One source of truth: if the composer ever grows a private copy of these
    // strings, the composed sentence stops containing the advertised hint.
    for (const o of TRANSITION_POSITIONS.slice(1)) {
      const composed = composeTransitionHintFromConnections("cross-dissolve", [], [], { position: o.id as never })
      expect(composed, `position/${o.id}`).toContain(o.promptHint)
    }
    for (const o of TRANSITION_DURATIONS.slice(1)) {
      const composed = composeTransitionHintFromConnections("cross-dissolve", [], [], { duration: o.id as never })
      expect(composed, `duration/${o.id}`).toContain(o.promptHint)
    }
    for (const o of TRANSITION_INTENSITIES.slice(1)) {
      const composed = composeTransitionHintFromConnections("cross-dissolve", [], [], { intensity: o.id as never })
      expect(composed, `intensity/${o.id}`).toContain(o.promptHint)
    }
  })

  it("`auto` adds nothing to the composed sentence", () => {
    const bare = composeTransitionHintFromConnections("cross-dissolve", [], [])
    const allAuto = composeTransitionHintFromConnections("cross-dissolve", [], [], { position: "auto", duration: "auto", intensity: "auto" })
    expect(allAuto).toBe(bare)
  })

  it("exposes the three dimensions on the transition catalog", () => {
    expect(transitionCatalog.kind).toBe("single")
    expect(transitionCatalog.dimensions?.map((d) => d.field)).toEqual([
      "position",
      "duration",
      "intensity",
    ])
  })

  it("keeps the dimensions through the wire projection", () => {
    const wire = projectPickerCatalog(transitionCatalog, { detail: "full" })

    // The 82-option transition list is untouched by the addition.
    expect(wire.options?.length).toBe(transitionCatalog.options?.length)

    expect(wire.dimensions).toHaveLength(3)
    for (const [field, options] of DIMENSIONS) {
      const dim = wire.dimensions?.find((d) => d.field === field)
      expect(dim, `${field} must reach the wire`).toBeDefined()
      expect(dim!.options.map((o) => o.id)).toEqual(options.map((o) => o.id))
      expect(dim!.options.map((o) => o.promptHint)).toEqual(options.map((o) => o.promptHint))
    }
  })

  it("leaves every other single-dim catalog without dimensions", () => {
    const singlesWithDims = PICKER_CATALOGS.filter(
      (c) => c.kind === "single" && c.dimensions,
    ).map((c) => c.nodeType)
    expect(singlesWithDims).toEqual(["transition"])
  })
})
