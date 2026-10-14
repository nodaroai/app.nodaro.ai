// @vitest-environment node
/**
 * A config panel shows what is wired into its node the way the run sees it: a
 * wire leaving a Teleport Receive carries exactly what entered its Send
 * (@nodaro/render-rules teleport-bypass.ts). A panel that reads the store's raw
 * edges judges the Receive by its own type — Merge Video & Audio listed no
 * audio track for audio sent through a pair while the run merged it. Panels read
 * the graph through `useCarriedEdges()` (hooks/use-carried-edges.ts) or
 * `getConnectedSources` (which bypasses itself); this census fails on any raw
 * read of the store's edges in `config-panels/` beyond the ones listed here,
 * each with its reason. Mirror of workflow-editor/__tests__/run-graph-census.test.ts.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const DIR = join(__dirname, "..")

/** Raw reads of the store's edges, per file, and why each must stay raw. */
const RAW_EDGE_READS: Record<string, { count: number; reason: string }> = {
  "image-overlay-config.tsx": { count: 1, reason: "deletes the wires leaving an unticked variant: WRITES the store, by the wires' own ids" },
  "schedule-trigger-config.tsx": {
    count: 1,
    reason: "asks whether the trigger feeds anything — its OUTGOING wires, which a bypass never re-points (a Send counts as fed)",
  },
}

/** `s.edges` / `state.edges` / `store.edges` (a store selector or snapshot), or `useWorkflowStore.getState().edges`. */
function rawEdgeReads(source: string): number {
  const selectors = (source.match(/\b(?:s|state|store)\.edges\b/g) ?? []).length
  const direct = (source.match(/useWorkflowStore\.getState\(\)\.edges\b/g) ?? []).length
  const destructures = [...source.matchAll(/const \{([^}]*)\} = useWorkflowStore\.getState\(\)/g)].filter((m) =>
    /(^|[\s,])edges\b/.test(m[1]),
  ).length
  return selectors + direct + destructures
}

describe("config panels read the graph as it carries", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))

  it("finds the config panel files", () => {
    expect(files).toContain("merge-audio-config.tsx")
    expect(files).toContain("helpers.ts")
  })

  it("the census counts a raw read", () => {
    expect(rawEdgeReads("const edges = useWorkflowStore((s) => s.edges)")).toBe(1)
    expect(rawEdgeReads("const { nodes, edges } = useWorkflowStore.getState()")).toBe(1)
    expect(rawEdgeReads("const e = useCarriedEdges()")).toBe(0)
  })

  for (const file of files) {
    it(`${file}: no raw store-edge read outside the reasoned list`, () => {
      const found = rawEdgeReads(readFileSync(join(DIR, file), "utf8"))
      expect(found, RAW_EDGE_READS[file]?.reason ?? "read the graph through useCarriedEdges() (hooks/use-carried-edges.ts)").toBe(
        RAW_EDGE_READS[file]?.count ?? 0,
      )
    })
  }
})

/**
 * The panels' edges are the carried ones, whose `source` is the node a wire
 * CARRIES — not the Teleport Receive it was drawn from. Every per-wire setting
 * (orders, track settings, field mappings, reference tiles) is keyed by the
 * drawn id, so a key derived from `edge.source`, or a deletion matched on it,
 * misses a teleported wire. Derive keys with `drawnSourceId(edge)`; reading
 * `edge.source` to LOOK UP the carried node (`n.id === edge.source`) is fine.
 * This census fails on any other `edge.source` read beyond the reasoned list.
 */
const EDGE_SOURCE_READS: Record<string, { count: number; reason: string }> = {
  "camera-switch-config.tsx": {
    count: 2,
    reason: "the camera id offered is the CARRIED node (the id Edit Plan's run mints into the EDL; keys use drawnSourceId), and an outgoing-wire filter",
  },
  "collect-config.tsx": { count: 1, reason: "maps each drawn id to the carried node it shows" },
  "image-overlay-config.tsx": { count: 1, reason: "deletes this node's OUTGOING wires from the raw store edges" },
  "prompt-helper-button.tsx": { count: 1, reason: "filters this node's OUTGOING wires; a carried wire leaving a pair it feeds counts" },
}

const EDGE_VAR = String.raw`\b(?:e|ed|edge|inEdge|edlEdge|legacyEdge|srcEdge|wire)\.source\b(?!Handle)`

function edgeSourceReads(source: string): number {
  const all = (source.match(new RegExp(EDGE_VAR, "g")) ?? []).length
  const nodeLookups = (source.match(new RegExp(String.raw`\.id === ` + EDGE_VAR, "g")) ?? []).length
  return all - nodeLookups
}

describe("config panels key per-wire settings by the drawn id", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))

  it("the census tells a key from a node lookup", () => {
    expect(edgeSourceReads("nodes.find((n) => n.id === edge.source)")).toBe(0)
    expect(edgeSourceReads("edges.filter((e) => e.source === id)")).toBe(1)
    expect(edgeSourceReads("edges.map((e) => drawnSourceId(e))")).toBe(0)
  })

  for (const file of files) {
    it(`${file}: no edge.source key outside the reasoned list`, () => {
      const found = edgeSourceReads(readFileSync(join(DIR, file), "utf8"))
      expect(found, EDGE_SOURCE_READS[file]?.reason ?? "key per-wire settings by drawnSourceId(edge) (@nodaro/render-rules)").toBe(
        EDGE_SOURCE_READS[file]?.count ?? 0,
      )
    })
  }
})
