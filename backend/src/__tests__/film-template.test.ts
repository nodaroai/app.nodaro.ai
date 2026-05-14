/**
 * Tests for `backend/src/lib/film-template.ts` — the canonical Film
 * Director template constant + jsonb comparison helpers used by the
 * `seed-film-template-workflow.ts` script.
 *
 * Three concerns:
 *
 *   1. **Snapshot the canonical template** — `stableStringify(TEMPLATE_NODES)`
 *      is the value the Film Director skill depends on (Stage 0 fetches this
 *      workflow via MCP and uses its node shapes as ground truth). An
 *      accidental reshuffle, key rename, or value drift in `TEMPLATE_NODES`
 *      breaks the skill silently — Claude reads a different shape than what
 *      it then writes back. The snapshot test makes that change require an
 *      explicit `vitest -u` to acknowledge.
 *
 *   2. **`graphIsUnchanged()` jsonb-roundtrip safety** — the helper claims
 *      that `stableStringify` is robust to the object-key reordering that
 *      Postgres jsonb columns do silently. The unit tests verify this by
 *      constructing rows that match the template semantically but with
 *      reshuffled keys, and asserting `graphIsUnchanged() === true`.
 *      Conversely, real changes (different value, different array order,
 *      dropped field, drifted description) must produce `false`.
 *
 *   3. **`diffWorkflow()` field-precision** — the script's "selective
 *      update" path depends on `diffWorkflow` returning the exact set of
 *      changed fields. If it over-reports, hand-edits get clobbered. If it
 *      under-reports, real changes don't propagate.
 *
 *   4. **`UUID_REGEX` validation** — the env-var validation path. A
 *      malformed paste of `NODARO_SYSTEM_USER_ID` (no hyphens, wrong
 *      length, leading whitespace, etc.) used to produce an opaque pg
 *      error. The regex catches it up front.
 */

import { describe, it, expect } from "vitest"

import {
  TEMPLATE_NODES,
  TEMPLATE_EDGES,
  TEMPLATE_SETTINGS,
  WORKFLOW_DESCRIPTION,
  UUID_REGEX,
  stableStringify,
  graphIsUnchanged,
  diffWorkflow,
} from "../lib/film-template.js"

// ---------------------------------------------------------------------------
// 1. Canonical-template snapshot
// ---------------------------------------------------------------------------

describe("TEMPLATE_NODES — canonical shape", () => {
  it("matches the recorded snapshot (run `vitest -u` if this change is intentional)", () => {
    expect(stableStringify(TEMPLATE_NODES)).toMatchSnapshot()
  })

  it("matches the recorded TEMPLATE_EDGES snapshot", () => {
    expect(stableStringify(TEMPLATE_EDGES)).toMatchSnapshot()
  })

  it("matches the recorded TEMPLATE_SETTINGS snapshot", () => {
    expect(stableStringify(TEMPLATE_SETTINGS)).toMatchSnapshot()
  })

  // Soft structural checks — these catch the most common refactor mistakes
  // (e.g., dropping a node type, renaming the discriminator) before they
  // bite the skill.
  it("contains exactly one node per documented type, in canvas order", () => {
    const types = TEMPLATE_NODES.map((n) => n.type)
    expect(types).toEqual([
      "text-prompt",
      "list",
      "sticky-note",
      "combine-text",
      "split-text",
      "preview",
      "scene",
    ])
  })

  it("every node has a `data._description` field for the skill", () => {
    for (const n of TEMPLATE_NODES) {
      expect(
        (n.data as Record<string, unknown>)._description,
        `node ${n.id} (${n.type}) is missing data._description`,
      ).toMatch(/\S/)
    }
  })

  it("every node id starts with `tpl_`", () => {
    for (const n of TEMPLATE_NODES) {
      expect(n.id).toMatch(/^tpl_/)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. graphIsUnchanged — jsonb-roundtrip safety
// ---------------------------------------------------------------------------

describe("graphIsUnchanged()", () => {
  it("returns true when the existing row matches the template exactly", () => {
    const row = {
      id: "any-uuid",
      nodes: TEMPLATE_NODES,
      edges: TEMPLATE_EDGES,
      settings: TEMPLATE_SETTINGS,
      description: WORKFLOW_DESCRIPTION,
    }
    expect(graphIsUnchanged(row)).toBe(true)
  })

  it("returns true after a real jsonb round-trip (JSON.parse(JSON.stringify(…)))", () => {
    // This is what reading a jsonb column gives you — plain objects/
    // arrays/scalars, no class instances. Key order is preserved by V8
    // for plain objects, but Postgres jsonb does NOT guarantee key order,
    // hence why stableStringify exists.
    const row = {
      id: "any-uuid",
      nodes: JSON.parse(JSON.stringify(TEMPLATE_NODES)) as unknown,
      edges: JSON.parse(JSON.stringify(TEMPLATE_EDGES)) as unknown,
      settings: JSON.parse(JSON.stringify(TEMPLATE_SETTINGS)) as unknown,
      description: WORKFLOW_DESCRIPTION,
    }
    expect(graphIsUnchanged(row)).toBe(true)
  })

  it("returns true even when object keys are deliberately reshuffled (jsonb-key-order simulation)", () => {
    // Simulate Postgres reshuffling object keys: rebuild each node with
    // keys inserted in a *different* order. Stable-stringify must
    // normalize this away.
    function reshuffleKeys(value: unknown): unknown {
      if (value === null || typeof value !== "object") return value
      if (Array.isArray(value)) return value.map(reshuffleKeys)
      const entries = Object.entries(value as Record<string, unknown>).map(
        ([k, v]) => [k, reshuffleKeys(v)] as const,
      )
      // Reverse to maximize key-order divergence from source.
      entries.reverse()
      const out: Record<string, unknown> = {}
      for (const [k, v] of entries) out[k] = v
      return out
    }

    const row = {
      id: "any-uuid",
      nodes: reshuffleKeys(TEMPLATE_NODES),
      edges: reshuffleKeys(TEMPLATE_EDGES),
      settings: reshuffleKeys(TEMPLATE_SETTINGS),
      description: WORKFLOW_DESCRIPTION,
    }
    expect(graphIsUnchanged(row)).toBe(true)
  })

  it("returns false when the description differs (whitespace counts)", () => {
    const row = {
      id: "any-uuid",
      nodes: TEMPLATE_NODES,
      edges: TEMPLATE_EDGES,
      settings: TEMPLATE_SETTINGS,
      description: WORKFLOW_DESCRIPTION + " ", // trailing space
    }
    expect(graphIsUnchanged(row)).toBe(false)
  })

  it("returns false when the description is null (existing row was never seeded with a description)", () => {
    const row = {
      id: "any-uuid",
      nodes: TEMPLATE_NODES,
      edges: TEMPLATE_EDGES,
      settings: TEMPLATE_SETTINGS,
      description: null,
    }
    expect(graphIsUnchanged(row)).toBe(false)
  })

  it("returns false when a node value has drifted (e.g., label changed)", () => {
    const tampered = JSON.parse(JSON.stringify(TEMPLATE_NODES)) as Array<{
      data: { label?: string }
    }>
    tampered[0].data.label = "Changed Script Label"
    const row = {
      id: "any-uuid",
      nodes: tampered,
      edges: TEMPLATE_EDGES,
      settings: TEMPLATE_SETTINGS,
      description: WORKFLOW_DESCRIPTION,
    }
    expect(graphIsUnchanged(row)).toBe(false)
  })

  it("returns false when array order changes (arrays are NOT sorted)", () => {
    // Reverse node order. Stable-stringify must NOT mask this because
    // canvas position + ordering matters semantically.
    const reversed = [...TEMPLATE_NODES].reverse()
    const row = {
      id: "any-uuid",
      nodes: reversed,
      edges: TEMPLATE_EDGES,
      settings: TEMPLATE_SETTINGS,
      description: WORKFLOW_DESCRIPTION,
    }
    expect(graphIsUnchanged(row)).toBe(false)
  })

  it("returns false when a node is dropped", () => {
    const truncated = TEMPLATE_NODES.slice(0, -1)
    const row = {
      id: "any-uuid",
      nodes: truncated,
      edges: TEMPLATE_EDGES,
      settings: TEMPLATE_SETTINGS,
      description: WORKFLOW_DESCRIPTION,
    }
    expect(graphIsUnchanged(row)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. diffWorkflow — per-field precision
// ---------------------------------------------------------------------------

describe("diffWorkflow()", () => {
  const base = {
    id: "any-uuid",
    nodes: TEMPLATE_NODES,
    edges: TEMPLATE_EDGES,
    settings: TEMPLATE_SETTINGS,
    description: WORKFLOW_DESCRIPTION,
  }

  it("reports all-false when row matches template exactly", () => {
    expect(diffWorkflow(base)).toEqual({
      nodesChanged: false,
      edgesChanged: false,
      settingsChanged: false,
      descriptionChanged: false,
    })
  })

  it("reports only descriptionChanged when only the description differs", () => {
    expect(diffWorkflow({ ...base, description: "different" })).toEqual({
      nodesChanged: false,
      edgesChanged: false,
      settingsChanged: false,
      descriptionChanged: true,
    })
  })

  it("reports only nodesChanged when only nodes differ", () => {
    expect(diffWorkflow({ ...base, nodes: [] })).toEqual({
      nodesChanged: true,
      edgesChanged: false,
      settingsChanged: false,
      descriptionChanged: false,
    })
  })

  it("reports only edgesChanged when only edges differ", () => {
    expect(
      diffWorkflow({
        ...base,
        edges: [{ id: "e1", source: "a", target: "b" }],
      }),
    ).toEqual({
      nodesChanged: false,
      edgesChanged: true,
      settingsChanged: false,
      descriptionChanged: false,
    })
  })

  it("reports only settingsChanged when only settings differ", () => {
    expect(diffWorkflow({ ...base, settings: { _description: "different" } })).toEqual({
      nodesChanged: false,
      edgesChanged: false,
      settingsChanged: true,
      descriptionChanged: false,
    })
  })

  it("reports all changes when every field differs", () => {
    expect(
      diffWorkflow({
        id: "any-uuid",
        nodes: [],
        edges: [{ id: "e1", source: "a", target: "b" }],
        settings: { other: 1 },
        description: "different",
      }),
    ).toEqual({
      nodesChanged: true,
      edgesChanged: true,
      settingsChanged: true,
      descriptionChanged: true,
    })
  })

  it("ignores jsonb-style key reshuffling (must agree with graphIsUnchanged)", () => {
    function reshuffleKeys(value: unknown): unknown {
      if (value === null || typeof value !== "object") return value
      if (Array.isArray(value)) return value.map(reshuffleKeys)
      const entries = Object.entries(value as Record<string, unknown>).map(
        ([k, v]) => [k, reshuffleKeys(v)] as const,
      )
      entries.reverse()
      const out: Record<string, unknown> = {}
      for (const [k, v] of entries) out[k] = v
      return out
    }
    expect(
      diffWorkflow({
        ...base,
        nodes: reshuffleKeys(TEMPLATE_NODES),
        settings: reshuffleKeys(TEMPLATE_SETTINGS),
      }),
    ).toEqual({
      nodesChanged: false,
      edgesChanged: false,
      settingsChanged: false,
      descriptionChanged: false,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. UUID_REGEX — env-var sanity check
// ---------------------------------------------------------------------------

describe("UUID_REGEX", () => {
  const VALID: ReadonlyArray<string> = [
    "550e8400-e29b-41d4-a716-446655440000",
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", // uppercase
    "AbCdEf12-3456-7890-aBcD-eFAbCdEf1234", // mixed case
  ]

  const INVALID: ReadonlyArray<string> = [
    "",
    "not-a-uuid",
    "550e8400e29b41d4a716446655440000", // no hyphens
    "550e8400-e29b-41d4-a716-44665544000", // 1 char short
    "550e8400-e29b-41d4-a716-4466554400000", // 1 char long
    "550e8400-e29b-41d4-a716-44665544000g", // non-hex char
    " 550e8400-e29b-41d4-a716-446655440000", // leading whitespace
    "550e8400-e29b-41d4-a716-446655440000\n", // trailing newline
    "550e8400_e29b_41d4_a716_446655440000", // underscores instead
  ]

  it.each(VALID)("accepts %s", (s) => {
    expect(UUID_REGEX.test(s)).toBe(true)
  })

  it.each(INVALID)("rejects %s", (s) => {
    expect(UUID_REGEX.test(s)).toBe(false)
  })
})
