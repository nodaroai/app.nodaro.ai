/**
 * Drift-guard: the public `@nodaro/shared` picker-catalog registry
 * (`PICKER_CATALOGS`) MUST stay in lockstep with the frontend picker registry
 * (`parameter-picker-registry.tsx`).
 *
 * `PICKER_CATALOGS` is the pure-data (no-React) mirror published for the
 * backend / SDK / docs. The frontend registry is the source of truth for the
 * editor UI. These tests assert structural parity so the two cannot silently
 * diverge — a new picker, a renamed valueField, a reordered category group,
 * or a dropped catalog entry on either side fails here.
 */

import { describe, it, expect } from "vitest"
import { PICKER_CATALOGS } from "@nodaro/shared"
import {
  SINGLE_PICKERS,
  MULTI_PICKERS,
} from "../parameter-picker-registry"

const sharedByNodeType = new Map(PICKER_CATALOGS.map((c) => [c.nodeType, c]))

const sharedSingles = PICKER_CATALOGS.filter((c) => c.kind === "single")
const sharedMultis = PICKER_CATALOGS.filter((c) => c.kind === "multi")

describe("PICKER_CATALOGS ↔ frontend picker registry parity", () => {
  // ---- Single-dim pickers ----
  describe.each(SINGLE_PICKERS.map((p) => [p.nodeType, p] as const))(
    "single picker: %s",
    (_nodeType, fe) => {
      const shared = sharedByNodeType.get(fe.nodeType)

      it("has a matching PICKER_CATALOGS entry", () => {
        expect(shared).toBeDefined()
        expect(shared?.kind).toBe("single")
        expect(shared?.catalogId).toBe(fe.catalogId)
        expect(shared?.valueField).toBe(fe.valueField)
        expect(shared?.defaultValue).toBe(fe.defaultValue)
        expect(shared?.label).toBe(fe.label)
      })

      it("mirrors categoryOrder / categoryLabels (groupOrder / groupLabels)", () => {
        // Normalize undefined vs absent — both registries omit when no grouping.
        expect(shared?.categoryOrder).toEqual(
          fe.groupOrder ? [...fe.groupOrder] : undefined,
        )
        expect(shared?.categoryLabels).toEqual(fe.groupLabels)
      })

      it("options ids deep-equal the frontend entries ids (same order)", () => {
        const sharedIds = (shared?.options ?? []).map((o) => o.id)
        const feIds = fe.entries.map((e) => e.id)
        expect(sharedIds).toEqual(feIds)
      })

      it("every option has a defined promptHint string", () => {
        // "" is valid for no-op options like "auto"/"none"; just never undefined.
        for (const opt of shared?.options ?? []) {
          expect(typeof opt.promptHint).toBe("string")
        }
      })
    },
  )

  // ---- Multi-dim pickers ----
  describe.each(MULTI_PICKERS.map((p) => [p.nodeType, p] as const))(
    "multi picker: %s",
    (_nodeType, fe) => {
      const shared = sharedByNodeType.get(fe.nodeType)

      it("has a matching PICKER_CATALOGS entry", () => {
        expect(shared).toBeDefined()
        expect(shared?.kind).toBe("multi")
        expect(shared?.catalogId).toBe(fe.catalogId)
        expect(shared?.label).toBe(fe.label)
      })

      it("mirrors fields exactly", () => {
        expect(shared?.fields).toEqual([...fe.fields])
      })

      it("does not expose flattened single-dim options", () => {
        expect(shared?.options).toBeUndefined()
      })

      it("exposes a `dimensions` array mirroring the frontend `fields` (same order)", () => {
        expect(shared?.dimensions).toBeDefined()
        expect((shared?.dimensions ?? []).map((d) => d.field)).toEqual([...fe.fields])
      })

      it("every dimension has at least one option, all with a defined promptHint string", () => {
        for (const dim of shared?.dimensions ?? []) {
          expect(dim.options.length).toBeGreaterThan(0)
          for (const opt of dim.options) {
            // "" is valid for no-op options; just never undefined.
            expect(typeof opt.promptHint).toBe("string")
          }
        }
      })
    },
  )

  // ---- Counts / no extra-or-missing in either direction ----
  it("single picker counts match (no extra/missing entries)", () => {
    expect(sharedSingles.length).toBe(SINGLE_PICKERS.length)
  })

  it("multi picker counts match (no extra/missing entries)", () => {
    expect(sharedMultis.length).toBe(MULTI_PICKERS.length)
  })

  it("total counts match", () => {
    expect(PICKER_CATALOGS.length).toBe(
      SINGLE_PICKERS.length + MULTI_PICKERS.length,
    )
  })

  it("every PICKER_CATALOGS nodeType exists in the frontend registry", () => {
    const feNodeTypes = new Set([
      ...SINGLE_PICKERS.map((p) => p.nodeType),
      ...MULTI_PICKERS.map((p) => p.nodeType),
    ])
    for (const c of PICKER_CATALOGS) {
      expect(feNodeTypes.has(c.nodeType)).toBe(true)
    }
  })

  it("nodeTypes are unique within PICKER_CATALOGS", () => {
    const seen = new Set<string>()
    for (const c of PICKER_CATALOGS) {
      expect(seen.has(c.nodeType)).toBe(false)
      seen.add(c.nodeType)
    }
  })
})
