/**
 * The character-fx node's three timing parameters (position / duration /
 * intensity) are enumerable catalogs, not free values, so a consumer that can
 * only send ids — Studio, the SDK, MCP — can offer them without composing any
 * prompt text of its own. This is the character-fx twin of
 * `transition-timing-catalogs.test.ts`; the two nodes share ids and shape but
 * NOT wording, and nothing here may couple them.
 *
 * Three properties matter, and each is easy to lose silently:
 *
 *  1. The clause the composer INJECTS and the hint the catalog ADVERTISES are
 *     the same string. They are derived from one array in `character-fx.ts`,
 *     and these tests fail the moment someone re-introduces a second copy.
 *  2. The prompt text is exactly what shipped before it was enumerable. The
 *     parameter-hint golden covers only three of the twelve clauses, so the
 *     twelve literals are pinned here: a change is a deliberate diff, never a
 *     side effect.
 *  3. The dimensions survive the wire projection — `projectAllCatalogs()` is
 *     what an id-only client actually reads, and a green in-memory catalog
 *     proves nothing about it.
 */
import { describe, it, expect } from "vitest"
import {
  CHARACTER_FX_POSITIONS,
  CHARACTER_FX_DURATIONS,
  CHARACTER_FX_INTENSITIES,
  composeCharacterFxHintFromConnections,
} from "../character-fx.js"
import { TRANSITION_POSITIONS, TRANSITION_DURATIONS } from "../transitions.js"
import { PICKER_CATALOGS, projectPickerCatalog, projectAllCatalogs } from "../picker-catalogs.js"

const DIMENSIONS = [
  ["position", CHARACTER_FX_POSITIONS],
  ["duration", CHARACTER_FX_DURATIONS],
  ["intensity", CHARACTER_FX_INTENSITIES],
] as const

const characterFxCatalog = PICKER_CATALOGS.find((c) => c.nodeType === "character-fx")!

describe("character-fx timing catalogs", () => {
  // The `CharacterFxPosition` / `Duration` / `Intensity` unions are DERIVED
  // from these arrays, so nothing at the type level can pin the values
  // themselves. These are the values the editor dropdowns, the node data, and
  // every stored workflow already use: changing one is a data migration, not a
  // rename.
  it("spells exactly the ids every stored workflow already uses", () => {
    expect(CHARACTER_FX_POSITIONS.map((o) => o.id)).toEqual([
      "auto", "start", "middle", "end", "full",
    ])
    expect(CHARACTER_FX_DURATIONS.map((o) => o.id)).toEqual([
      "auto", "instant", "short", "medium", "long",
    ])
    expect(CHARACTER_FX_INTENSITIES.map((o) => o.id)).toEqual([
      "auto", "subtle", "natural", "dynamic", "crazy",
    ])
  })

  it("injects exactly the clauses that shipped before the scales were enumerable", () => {
    // Byte-for-byte the literals the hand-written clause tables carried. This
    // task was exposure, not authoring: if any of these move, that is a prompt
    // change for real users and must be its own deliberate diff.
    expect(CHARACTER_FX_POSITIONS.map((o) => o.promptHint)).toEqual([
      "",
      "the effect occurs at the opening of the clip",
      "the effect occurs in the middle of the clip",
      "the effect occurs at the end of the clip",
      "the effect persists for the entire clip",
    ])
    expect(CHARACTER_FX_DURATIONS.map((o) => o.promptHint)).toEqual([
      "",
      "manifesting instantaneously",
      "manifesting over approximately 1 second",
      "manifesting over approximately 2 seconds",
      "manifesting over approximately 3 seconds",
    ])
    expect(CHARACTER_FX_INTENSITIES.map((o) => o.promptHint)).toEqual([
      "",
      "with subtle restrained energy and minimal flourish",
      "with natural unhurried timing",
      "with dynamic energy and assertive flourish",
      "with extreme exaggerated energy, wild flourishes, and dramatic distortion",
    ])
  })

  it("keeps its own wording — an effect manifests and persists, a transition occurs and spans", () => {
    // The one constraint that matters most: these scales must never be unified
    // with the transition ones. Position and duration are worded differently
    // on purpose, so pointing character-fx at the transition rows fails here.
    // Intensity is deliberately NOT compared: its three clauses happen to be
    // identical today, and that is a coincidence, not a shared definition.
    expect(CHARACTER_FX_POSITIONS.map((o) => o.promptHint)).not.toEqual(
      TRANSITION_POSITIONS.map((o) => o.promptHint),
    )
    expect(CHARACTER_FX_DURATIONS.map((o) => o.promptHint)).not.toEqual(
      TRANSITION_DURATIONS.map((o) => o.promptHint),
    )
  })

  it("carries the timing precision users read off the dropdown", () => {
    // The editor renders straight from here (its own catalogs, not the
    // transition ones), so this is the one place the numbers live.
    expect(CHARACTER_FX_DURATIONS.map((o) => o.label)).toEqual([
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
    // ", " on a prompt that shipped to the provider. Walks the ARRAYS, not a
    // hardcoded id list, so a step added to a catalog is exercised here too.
    for (const [field, options] of DIMENSIONS) {
      for (const o of options.slice(1)) {
        const composed = composeCharacterFxHintFromConnections("werewolf", [], {
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
    for (const o of CHARACTER_FX_POSITIONS.slice(1)) {
      const composed = composeCharacterFxHintFromConnections("werewolf", [], { position: o.id as never })
      expect(composed, `position/${o.id}`).toContain(o.promptHint)
    }
    for (const o of CHARACTER_FX_DURATIONS.slice(1)) {
      const composed = composeCharacterFxHintFromConnections("werewolf", [], { duration: o.id as never })
      expect(composed, `duration/${o.id}`).toContain(o.promptHint)
    }
    for (const o of CHARACTER_FX_INTENSITIES.slice(1)) {
      const composed = composeCharacterFxHintFromConnections("werewolf", [], { intensity: o.id as never })
      expect(composed, `intensity/${o.id}`).toContain(o.promptHint)
    }
  })

  it("the clauses are emitted identically in compact hint mode", () => {
    // Timing is composed from `promptHint` in BOTH modes — only the effect's
    // base fragment swaps to its term. Pinned so a compact-mode refactor cannot
    // quietly start reading `term` for the timing rows.
    for (const [field, options] of DIMENSIONS) {
      for (const o of options.slice(1)) {
        const compact = composeCharacterFxHintFromConnections("werewolf", [], {
          [field]: o.id,
        } as never, "compact")
        expect(compact, `${field}/${o.id} in compact mode`).toContain(o.promptHint)
      }
    }
  })

  it("`auto` adds nothing to the composed sentence", () => {
    const bare = composeCharacterFxHintFromConnections("werewolf", [])
    const allAuto = composeCharacterFxHintFromConnections("werewolf", [], { position: "auto", duration: "auto", intensity: "auto" })
    expect(allAuto).toBe(bare)
  })

  it("exposes the three dimensions on the character-fx catalog", () => {
    expect(characterFxCatalog.kind).toBe("single")
    expect(characterFxCatalog.dimensions?.map((d) => d.field)).toEqual([
      "position",
      "duration",
      "intensity",
    ])
  })

  it("keeps the dimensions through the wire projection", () => {
    const wire = projectPickerCatalog(characterFxCatalog, { detail: "full" })

    // The 57-option effect list is untouched by the addition.
    expect(wire.options?.length).toBe(characterFxCatalog.options?.length)

    expect(wire.dimensions).toHaveLength(3)
    for (const [field, options] of DIMENSIONS) {
      const dim = wire.dimensions?.find((d) => d.field === field)
      expect(dim, `${field} must reach the wire`).toBeDefined()
      expect(dim!.options.map((o) => o.id)).toEqual(options.map((o) => o.id))
      expect(dim!.options.map((o) => o.promptHint)).toEqual(options.map((o) => o.promptHint))
    }
  })

  it("field filter narrows a single-dim catalog to one secondary dimension", () => {
    const wire = projectPickerCatalog(characterFxCatalog, { field: "duration" })
    expect(wire.options?.length).toBe(characterFxCatalog.options?.length)
    expect(wire.dimensions?.map((d) => d.field)).toEqual(["duration"])
  })

  describe("projectAllCatalogs — what an id-only client actually reads", () => {
    // `GET /v1/catalogs` is built from this call. Both detail levels must carry
    // the three dimensions with ids and labels; `full` must also carry the
    // clause, and `compact` must carry the term so a thin client can inject
    // without a second fetch.
    for (const detail of ["compact", "full"] as const) {
      it(`detail=${detail}: three dimensions with ids, labels${detail === "full" ? " and hints" : " and terms"}`, () => {
        const wire = projectAllCatalogs({ detail }).find((c) => c.nodeType === "character-fx")!
        expect(wire.detail).toBe(detail)
        expect(wire.kind).toBe("single")
        expect(wire.dimensions?.map((d) => d.field)).toEqual(["position", "duration", "intensity"])

        for (const [field, options] of DIMENSIONS) {
          const dim = wire.dimensions!.find((d) => d.field === field)!
          expect(dim.label, `${field} label`).toBeTruthy()
          expect(dim.options.map((o) => o.id)).toEqual(options.map((o) => o.id))
          expect(dim.options.map((o) => o.label)).toEqual(options.map((o) => o.label))
          expect(dim.options.map((o) => o.term)).toEqual(options.map((o) => o.term))
          if (detail === "full") {
            expect(dim.options.map((o) => o.promptHint)).toEqual(options.map((o) => o.promptHint))
          } else {
            for (const o of dim.options) expect(o, `${field}/${o.id} compact`).not.toHaveProperty("promptHint")
          }
        }
      })
    }
  })
})
