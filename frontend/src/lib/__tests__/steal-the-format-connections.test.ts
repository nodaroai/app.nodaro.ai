/**
 * Canvas-legality guard for the "Steal the Format" template.
 *
 * The backend test (backend/.../tutorial-seed/__tests__/steal-the-format.test.ts)
 * proves the template's edges reference REAL handles. This proves every edge is
 * a connection the canvas would ACCEPT — `isValidWorkflowConnection`, the same
 * predicate `<ReactFlow isValidConnection>` runs — so a clone opens with no
 * rejected wire (the Video URL into Content Recipe's `link`, the brand Text into
 * `field-brand`, Content Ideas into Generate Script).
 *
 * The template is seeded from the backend, so this reads it from there.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { isValidWorkflowConnection, buildAdjacency, type EdgeShape } from "../connection-validation"
import { NODE_DEF_MAP } from "@/types/nodes"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, "../../../../backend/src/lib/tutorial-seed/templates/steal-the-format.json")

type Node = { id: string; type: string }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const { nodes, edges } = JSON.parse(readFileSync(TEMPLATE, "utf8")) as { nodes: Node[]; edges: Edge[] }

describe("steal-the-format template — canvas legality", () => {
  it("uses only node types the editor defines", () => {
    for (const node of nodes) expect(NODE_DEF_MAP.has(node.type), node.type).toBe(true)
  })

  it("every edge is a legal canvas connection", () => {
    const typeById = new Map(nodes.map((n) => [n.id, n.type]))
    const getNodeType = (id: string): string | undefined => typeById.get(id)
    expect(edges.length).toBeGreaterThan(0)
    for (const edge of edges) {
      // Probe as a NEW connection against the OTHER existing edges — how the
      // canvas validates a drag or a re-wire.
      const others: EdgeShape[] = edges.filter((e) => e.id !== edge.id).map((e) => ({ source: e.source, target: e.target }))
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
})
