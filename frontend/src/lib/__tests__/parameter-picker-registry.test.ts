/**
 * Frontend parameter-picker registry sync tests.
 *
 * Per CLAUDE.md "Parameter Picker Node Registration", the frontend owns 2 of
 * the 5 picker registries:
 *
 *   - PARAMETER_PICKER_NODE_TYPES (set, in parameter-picker-types.ts)
 *     Loaded by published-app input-card.tsx — intentionally lightweight so
 *     the runtime bundle doesn't drag in every preview component.
 *
 *   - parameter-picker-registry.tsx (ALL_PARAMETER_PICKERS list)
 *     Heavy registry with previews/icons/pickers, loaded on demand.
 *
 * "Steps 20 and 21 MUST stay in sync. The lightweight set in step 20 is what
 *  input-card.tsx (the published-app runtime) imports — it intentionally
 *  avoids the heavy registry to keep the bundle small. A node listed in step 20
 *  but missing from step 21 will render `null` in apps; a node in step 21 but
 *  missing from step 20 won't be detected as a picker and will render as a
 *  generic text input bound to the wrong field."
 *
 * Plus these tests cross-check that the frontend picker set ⊆ the shared
 * PARAMETER_NODE_TYPES set — a picker that isn't a parameter node would
 * cause the orchestrator to treat the node as executable and crash.
 */

import { describe, it, expect } from "vitest"
import {
  PARAMETER_PICKER_NODE_TYPES,
  isParameterPickerNode,
} from "../parameter-picker-types"
import {
  ALL_PARAMETER_PICKERS,
  getParameterPickerMeta,
} from "../parameter-picker-registry"
import {
  PARAMETER_NODE_TYPES,
  getParameterValue,
} from "@nodaro/shared"

// =============================================================================
// Test 1 — the lightweight set and the heavy registry agree exactly.
// =============================================================================

describe("PARAMETER_PICKER_NODE_TYPES ↔ parameter-picker-registry", () => {
  it("every nodeType in the lightweight set has a registry entry", () => {
    const registryTypes = new Set(ALL_PARAMETER_PICKERS.map((p) => p.nodeType))
    const orphans: string[] = []
    for (const t of PARAMETER_PICKER_NODE_TYPES) {
      if (!registryTypes.has(t)) orphans.push(t)
    }
    expect(orphans, `Lightweight set declares pickers without a registry entry. PickerInputCard would render null for these in published apps. Add a meta entry to parameter-picker-registry.tsx: ${orphans.join(", ")}`).toEqual([])
  })

  it("every registry entry has a matching nodeType in the lightweight set", () => {
    const orphans: string[] = []
    for (const meta of ALL_PARAMETER_PICKERS) {
      if (!PARAMETER_PICKER_NODE_TYPES.has(meta.nodeType)) {
        orphans.push(meta.nodeType)
      }
    }
    expect(orphans, `Registry entries missing from PARAMETER_PICKER_NODE_TYPES. input-card.tsx wouldn't recognize these as pickers and would render a generic text input bound to the wrong field. Add to parameter-picker-types.ts: ${orphans.join(", ")}`).toEqual([])
  })

  it("registry has no duplicate nodeType entries", () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const meta of ALL_PARAMETER_PICKERS) {
      if (seen.has(meta.nodeType)) dupes.push(meta.nodeType)
      seen.add(meta.nodeType)
    }
    expect(dupes).toEqual([])
  })
})

// =============================================================================
// Test 2 — every picker is a parameter node on the shared side.
// Catches: someone adds a picker in the frontend but forgets to add the type
// to PARAMETER_NODE_TYPES, which causes the orchestrator to treat the node as
// executable and crash.
// =============================================================================

describe("PARAMETER_PICKER_NODE_TYPES ⊆ PARAMETER_NODE_TYPES", () => {
  for (const t of PARAMETER_PICKER_NODE_TYPES) {
    it(`picker "${t}" is registered as a parameter node in @nodaro/shared`, () => {
      expect(
        PARAMETER_NODE_TYPES.has(t),
        `Picker "${t}" is missing from shared PARAMETER_NODE_TYPES. The orchestrator would treat the node as executable, create a stale "pending" jobs row, and throw "Unknown node type" at buildPayload — breaking the workflow. Add it to packages/shared/src/parameter-node-value.ts.`,
      ).toBe(true)
    })
  }
})

// =============================================================================
// Test 3 — single-dim picker valueField round-trips through getParameterValue.
// Catches: registry meta declares valueField="foo" but getParameterValue's
// switch case reads `data.bar` — the user picks a value, the picker writes
// data.foo, getParameterValue reads data.bar, returns undefined → unresolved
// {NodeLabel} placeholder in downstream prompts.
// =============================================================================

describe("single-dim valueField ↔ getParameterValue", () => {
  for (const meta of ALL_PARAMETER_PICKERS) {
    if (meta.kind !== "single") continue
    it(`"${meta.nodeType}" valueField "${meta.valueField}" round-trips`, () => {
      const sampleId = meta.entries[0]?.id ?? "sample-id"
      const data = { [meta.valueField]: sampleId }
      const value = getParameterValue(data, meta.nodeType)
      expect(
        value,
        `Picker "${meta.nodeType}" writes data.${meta.valueField} but getParameterValue doesn't read it. Either fix the valueField in parameter-picker-registry.tsx or fix the case in packages/shared/src/parameter-node-value.ts.`,
      ).toBe(sampleId)
    })
  }
})

// =============================================================================
// Test 4 — registry catalog has at least one entry per single-dim picker
// (catches empty catalogs that would render an empty grid).
// =============================================================================

describe("single-dim catalog non-empty", () => {
  for (const meta of ALL_PARAMETER_PICKERS) {
    if (meta.kind !== "single") continue
    it(`"${meta.nodeType}" catalog has at least one entry`, () => {
      expect(
        meta.entries.length,
        `Picker "${meta.nodeType}" has an empty entries array — the picker grid would render with no options. Check the mapCat() call in parameter-picker-registry.tsx.`,
      ).toBeGreaterThan(0)
    })
  }
})

// =============================================================================
// Test 5 — getParameterPickerMeta returns the right meta and isParameterPickerNode
// agrees with the registry.
// =============================================================================

describe("getParameterPickerMeta + isParameterPickerNode", () => {
  for (const meta of ALL_PARAMETER_PICKERS) {
    it(`"${meta.nodeType}" lookup is consistent`, () => {
      expect(getParameterPickerMeta(meta.nodeType)).toBe(meta)
      expect(isParameterPickerNode(meta.nodeType)).toBe(true)
    })
  }

  it("returns undefined for an unknown nodeType", () => {
    expect(getParameterPickerMeta("not-a-picker")).toBeUndefined()
    expect(isParameterPickerNode("not-a-picker")).toBe(false)
  })

  it("returns undefined for null/empty", () => {
    expect(getParameterPickerMeta(null)).toBeUndefined()
    expect(getParameterPickerMeta(undefined)).toBeUndefined()
    expect(getParameterPickerMeta("")).toBeUndefined()
  })
})
