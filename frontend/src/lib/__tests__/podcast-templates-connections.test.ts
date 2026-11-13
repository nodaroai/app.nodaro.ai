/**
 * Canvas-legality guard for the podcast editing templates (PR #12).
 *
 * The backend test (backend/.../tutorial-seed/__tests__/podcast-templates.test.ts)
 * proves each template's edges reference REAL handles. This proves the stronger
 * property a user hits when they re-wire a clone: every edge is a connection the
 * canvas would ACCEPT — `isValidWorkflowConnection`, the same predicate
 * `<ReactFlow isValidConnection>` runs. It catches type-incompatible wiring the
 * handle-existence check can't (e.g. a json output into a media-only input, or a
 * source node type a target's `ACCEPTS_*` predicate rejects).
 *
 * The templates are seeded from the backend, so this reads them from there.
 *
 * Probed as a viewer who may use Speaker Map: the one-node Multicam Cut's
 * Master audio input is offered only then (target-handle-availability.ts), and
 * no other template wires an input that follows it. The last describe pins
 * what a viewer from whom Speaker Map is withheld gets: that one wire is
 * refused as a new connection, and the saved one still draws its pip.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { isValidWorkflowConnection, buildAdjacency, type EdgeShape } from "../connection-validation"
import { targetHandleShown } from "../target-handle-availability"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(HERE, "../../../../backend/src/lib/tutorial-seed/templates")

const SLUGS = ["podcast-tighten-episode", "podcast-clip-pack", "podcast-multicam-cut", "podcast-trailer-formats", "podcast-tighten-episode-one-node", "podcast-clip-pack-one-node", "podcast-trailer-formats-one-node", "podcast-multicam-cut-one-node", "podcast-vertical-speaker-clip"] as const

type Node = { id: string; type: string }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

function loadTemplate(slug: string): { nodes: Node[]; edges: Edge[] } {
  return JSON.parse(readFileSync(join(TEMPLATES_DIR, `${slug}.json`), "utf8")) as { nodes: Node[]; edges: Edge[] }
}

// The availability answer is module state, and this file shares its worker
// with others (src/test/no-isolate-files.json): leave it unloaded, as found.
afterEach(() => __resetSurfaceAvailabilityForTests())

/** Whether the canvas accepts `edge` as a NEW connection against the template's
 *  OTHER edges — exactly how it validates a drag/re-wire (so the DAG cycle
 *  check sees the graph without the edge under test). */
function legalAsNewConnection({ nodes, edges }: { nodes: Node[]; edges: Edge[] }, edge: Edge): boolean {
  const typeById = new Map(nodes.map((n) => [n.id, n.type]))
  const others: EdgeShape[] = edges.filter((e) => e.id !== edge.id).map((e) => ({ source: e.source, target: e.target }))
  return isValidWorkflowConnection(
    { source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle },
    (id) => typeById.get(id),
    buildAdjacency(others),
  )
}

describe("podcast templates — every edge is a legal canvas connection", () => {
  // A viewer who may use Speaker Map: availability loaded, nothing withheld.
  beforeEach(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: [] }))
  for (const slug of SLUGS) {
    it(slug, () => {
      const graph = loadTemplate(slug)
      const typeById = new Map(graph.nodes.map((n) => [n.id, n.type]))
      for (const edge of graph.edges) {
        expect(
          legalAsNewConnection(graph, edge),
          `edge ${edge.id}: ${typeById.get(edge.source)}:${edge.sourceHandle} -> ${typeById.get(edge.target)}:${edge.targetHandle} must be a legal connection`,
        ).toBe(true)
      }
    })
  }
})

describe("the one-node Multicam Cut for a viewer from whom Speaker Map is withheld", () => {
  beforeEach(() => __resetSurfaceAvailabilityForTests({ nodes: ["speaker-map"], models: [] }))
  it("refuses only its Master audio wire as a new connection, and still draws the saved wire's pip", () => {
    const graph = loadTemplate("podcast-multicam-cut-one-node")
    const refused = graph.edges.filter((e) => !legalAsNewConnection(graph, e))
    expect(refused.map((e) => e.targetHandle)).toEqual(["masterAudio"])
    const wire = refused[0]!
    expect(targetHandleShown(wire.target, "tighten-episode", "masterAudio", graph.edges)).toBe(true)
  })
})
