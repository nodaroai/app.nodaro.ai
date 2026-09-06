import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"

import { parseProduction, serializeProduction } from "../shot-graph"
import type { Cast } from "../cast"
import type { Shot } from "../shot"

/**
 * The cast's GRAPH hop (spec 2026-08-31-project-cast-registry, C1): the registry
 * lives in `settings.studio.cast`, round-trips through
 * `serializeProduction`/`parseProduction`, and — the backcompat rule — an ABSENT
 * cast leaves the persisted blob byte-identical to today's.
 */
const shot: Shot = {
  id: "shot-a",
  still: {
    nodeId: "generate-image-1",
    url: "https://r2.example/a.png",
    provider: "nano-banana",
    prompt: "a harbour",
  },
}

const cast: Cast = {
  abi: { kind: "character", assetId: "c1", displayName: "Abi" },
  "abi-2": { kind: "character", assetId: "c2", displayName: "Abi 2" },
  park: {
    kind: "location",
    assetId: "l1",
    displayName: "Park",
    defaultLook: { url: "https://r2.example/night.png", label: "Night" },
  },
  town: { kind: "image", assetId: "i1", displayName: "Town" },
  panda: {
    kind: "creature",
    assetId: "cr1",
    displayName: "Panda",
    defaultRole: "panda",
  },
}

function workflowFrom(graph: ReturnType<typeof serializeProduction>): Workflow {
  return {
    id: "wf-1",
    projectId: "p-1",
    userId: "u-1",
    name: "Production",
    nodes: graph.nodes,
    edges: graph.edges,
    settings: graph.settings,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  } as unknown as Workflow
}

describe("settings.studio.cast — the graph round-trip", () => {
  it("serializes the cast and reads it back unchanged", () => {
    const graph = serializeProduction(
      [shot],
      "shot-a",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      cast,
    )
    expect(graph.settings.studio.cast).toEqual(cast)
    expect(parseProduction(workflowFrom(graph)).cast).toEqual(cast)
  })

  it("the persisted blob never ALIASES store state", () => {
    const graph = serializeProduction(
      [shot],
      "shot-a",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      cast,
    )
    expect(graph.settings.studio.cast).not.toBe(cast)
    expect(graph.settings.studio.cast?.park.defaultLook).not.toBe(
      cast.park.defaultLook,
    )
  })

  it("BACKCOMPAT — an absent (or empty) cast is byte-identical to today", () => {
    const today = serializeProduction([shot], "shot-a")
    const withEmpty = serializeProduction(
      [shot],
      "shot-a",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
    )
    // `cast: {}` must NEVER ride (the omit-when-empty rule).
    expect("cast" in today.settings.studio).toBe(false)
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(today))
    expect(parseProduction(workflowFrom(today)).cast).toBeUndefined()
  })

  it("the ROLE WORD round-trips, and a role-less row keeps no key (D6p)", () => {
    const graph = serializeProduction(
      [shot],
      "shot-a",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      cast,
    )
    const persisted = graph.settings.studio.cast!
    expect(persisted.panda.defaultRole).toBe("panda")
    // Omit-when-empty on the field too: a row that never named a role must
    // serialize exactly as it did before `defaultRole` existed.
    expect("defaultRole" in persisted.abi).toBe(false)
    expect(parseProduction(workflowFrom(graph)).cast!.panda.defaultRole).toBe(
      "panda",
    )
  })

  it("a legacy production with no cast key parses as today (no registry)", () => {
    const graph = serializeProduction([shot], "shot-a")
    const wf = workflowFrom(graph)
    const studio = { ...(wf.settings as { studio: object }).studio }
    delete (studio as { cast?: unknown }).cast
    const parsed = parseProduction({
      ...wf,
      settings: { studio },
    } as unknown as Workflow)
    expect(parsed.cast).toBeUndefined()
    expect(parsed.shots).toHaveLength(1)
  })

  it("a canvas-mangled cast blob degrades instead of throwing", () => {
    const graph = serializeProduction([shot], "shot-a")
    const wf = workflowFrom(graph)
    const studio = {
      ...(wf.settings as { studio: object }).studio,
      cast: { ok: { kind: "character", assetId: "c1", displayName: "Abi" }, bad: 7 },
    }
    const parsed = parseProduction({
      ...wf,
      settings: { studio },
    } as unknown as Workflow)
    expect(parsed.cast).toEqual({
      abi: { kind: "character", assetId: "c1", displayName: "Abi" },
    })
  })
})

/**
 * The SCENE LOOK OVERLAY's graph hop (C3/C4, D6f) — a per-shot map beside the
 * scene look, with the same omit-when-empty rule: an un-pinned scene must
 * serialize byte-identically to one that never heard of the registry.
 */
describe("Shot.castLook — the scene overlay's round-trip", () => {
  const pinned: Shot = {
    ...shot,
    castLook: {
      abi: { url: "https://r2.example/back.png", variantSlug: "angles:back", label: "back" },
      park: { url: "https://r2.example/dusk.png" },
    },
  }

  it("round-trips the pins verbatim", () => {
    const parsed = parseProduction(workflowFrom(serializeProduction([pinned], "shot-a")))
    expect(parsed.shots[0].castLook).toEqual(pinned.castLook)
  })

  it("the persisted blob never aliases the store's own object", () => {
    const graph = serializeProduction([pinned], "shot-a")
    const entry = (graph.settings.studio as unknown as { shots: Array<{ castLook?: object }> }).shots[0]
    expect(entry.castLook).toEqual(pinned.castLook)
    expect(entry.castLook).not.toBe(pinned.castLook)
  })

  it("an UN-pinned scene is byte-identical to today (no `castLook` key at all)", () => {
    const plain = serializeProduction([shot], "shot-a")
    const entry = (plain.settings.studio as unknown as { shots: Array<Record<string, unknown>> }).shots[0]
    expect("castLook" in entry).toBe(false)
    // …and an empty map is treated as absent, never persisted as `{}`.
    const empty = serializeProduction([{ ...shot, castLook: {} }], "shot-a")
    expect(JSON.stringify(empty)).toBe(JSON.stringify(plain))
  })

  it("a canvas-mangled pin blob degrades to the cast default instead of throwing", () => {
    const graph = serializeProduction([shot], "shot-a")
    const wf = workflowFrom(graph)
    const studio = (wf.settings as unknown as { studio: { shots: Array<Record<string, unknown>> } }).studio
    const shots = [{ ...studio.shots[0], castLook: { abi: { url: "https://r2.example/b.png" }, park: 7 } }]
    const parsed = parseProduction({
      ...wf,
      settings: { studio: { ...studio, shots } },
    } as unknown as Workflow)
    expect(parsed.shots[0].castLook).toEqual({ abi: { url: "https://r2.example/b.png" } })
  })
})
