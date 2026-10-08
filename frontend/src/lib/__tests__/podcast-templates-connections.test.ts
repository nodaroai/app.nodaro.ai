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
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { isValidWorkflowConnection, buildAdjacency, type EdgeShape } from "../connection-validation"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(HERE, "../../../../backend/src/lib/tutorial-seed/templates")

const SLUGS = ["podcast-tighten-episode", "podcast-clip-pack", "podcast-multicam-cut", "podcast-trailer-formats"] as const

type Node = { id: string; type: string }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

function loadTemplate(slug: string): { nodes: Node[]; edges: Edge[] } {
  return JSON.parse(readFileSync(join(TEMPLATES_DIR, `${slug}.json`), "utf8")) as { nodes: Node[]; edges: Edge[] }
}

describe("podcast templates — every edge is a legal canvas connection", () => {
  for (const slug of SLUGS) {
    it(slug, () => {
      const { nodes, edges } = loadTemplate(slug)
      const typeById = new Map(nodes.map((n) => [n.id, n.type]))
      const getNodeType = (id: string): string | undefined => typeById.get(id)

      for (const edge of edges) {
        // Probe as a NEW connection against the OTHER existing edges — exactly
        // how the canvas validates a drag/re-wire (so the DAG cycle check sees
        // the graph without the edge under test).
        const others: EdgeShape[] = edges
          .filter((e) => e.id !== edge.id)
          .map((e) => ({ source: e.source, target: e.target }))
        const ok = isValidWorkflowConnection(
          { source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle },
          getNodeType,
          buildAdjacency(others),
        )
        expect(
          ok,
          `edge ${edge.id}: ${getNodeType(edge.source)}:${edge.sourceHandle} -> ${getNodeType(edge.target)}:${edge.targetHandle} must be a legal connection`,
        ).toBe(true)
      }
    })
  }
})
