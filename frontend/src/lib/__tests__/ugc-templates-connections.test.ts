// @test-watches backend/src/lib/tutorial-seed/templates/ugc-{website-video,product-in-hand,app-demo}.json
/**
 * Canvas-legality guard for the four UGC video templates ("UGC Video From Your Site", its Hebrew
 * twin, the product-in-hand and the app-demo templates), and the app each publishes.
 *
 * The backend test (backend/.../tutorial-seed/__tests__/ugc-templates.test.ts) proves the
 * templates' edges reference REAL handles. This proves every edge is a connection the canvas would
 * ACCEPT — `isValidWorkflowConnection`, the same predicate `<ReactFlow isValidConnection>` runs — so
 * a clone opens with no rejected wire (the UGC wires, the creator look's four pickers on one pip,
 * the cards' plans into Video Overlay and Add Captions). It also reads the published app the way
 * the app surfaces do: every input card has what it renders from, a creator set to My photo has a
 * photo input, and the outputs are a video and the Notes text.
 *
 * The templates are seeded from the backend, so this reads them from there.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { flattenItems, getOutputType } from "@nodaro/shared/apps"
import type { PresentationItem } from "@nodaro/shared/types"
import { isValidWorkflowConnection, buildAdjacency, type EdgeShape } from "../connection-validation"
import { ugcComposedOf } from "@nodaro/render-rules"
import { appInputNodeIds, ugcCreatorsWithoutPhotoInput } from "../ugc-publish-photo"
import { findExposableField } from "@/components/presentation/helpers"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import { NODE_DEF_MAP, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import type { PresentationSettings } from "@/hooks/use-workflow-store"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = ["ugc-website-video", "ugc-product-in-hand", "ugc-app-demo", "ugc-website-video-he"] as const

type Node = { id: string; type: string; data: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

describe.each(TEMPLATES)("%s template", (slug) => {
  const TEMPLATE = join(HERE, `../../../../backend/src/lib/tutorial-seed/templates/${slug}.json`)
  const { nodes, edges, settings } = JSON.parse(readFileSync(TEMPLATE, "utf8")) as {
    nodes: Node[]
    edges: Edge[]
    settings: { presentationSettings: PresentationSettings }
  }
  const presentation = settings.presentationSettings
  const asWorkflow = (list: Node[]) => list as unknown as WorkflowNode[]
  /** The template as one composed graph: it references no sub-workflow. */
  const composedOf = (workflowNodes: WorkflowNode[]) => ugcComposedOf(workflowNodes as never, edges as never)

  describe("canvas legality", () => {
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

  describe("the app it publishes", () => {
    it("every input card has what it renders from: each node exists, each field is described", () => {
      const items = flattenItems(presentation.inputItems as PresentationItem[])
      const byId = new Map(nodes.map((n) => [n.id, n]))
      for (const item of items) {
        if (item.type === "richtext") continue
        expect(item.type === "node" || item.type === "field", item.type).toBe(true)
        const node = byId.get((item as { nodeId: string }).nodeId)
        expect(node, (item as { nodeId: string }).nodeId).toBeDefined()
        if (item.type === "field") {
          // Both app surfaces skip a field item whose node definition does not describe it.
          expect(findExposableField(node as unknown as WorkflowNode, item.field), `${item.nodeId}.${item.field}`).toBeDefined()
        }
      }
    })

    it("a creator set to My photo still has a photo input: the Creator card takes it", () => {
      const inputs = appInputNodeIds(asWorkflow(nodes), presentation)
      expect(inputs.has("creator")).toBe(true)
      expect(ugcCreatorsWithoutPhotoInput(composedOf(asWorkflow(nodes)), inputs)).toEqual([])
      const myPhoto = nodes.map((n) => (n.id === "creator" ? { ...n, data: { ...n.data, source: "photo" } } : n))
      expect(ugcCreatorsWithoutPhotoInput(composedOf(asWorkflow(myPhoto)), appInputNodeIds(asWorkflow(myPhoto), presentation))).toEqual([])
    })

    it("in the author's own editor, their photo in \"Your photo\" still feeds the creator", () => {
      const AUTHOR = "https://cdn.example/author.png"
      const own = nodes.map((n) =>
        n.id === "creator" ? { ...n, data: { ...n.data, source: "photo" } }
          : n.id === "photo" ? { ...n, data: { ...n.data, url: AUTHOR, r2Url: AUTHOR } }
            : n,
      )
      const creator = asWorkflow(own).find((n) => n.id === "creator")!
      expect(resolveNodeInputs(creator, asWorkflow(own), edges as unknown as WorkflowEdge[]).ugc?.photo).toBe(AUTHOR)
    })

    it("published as a component, the author's photo in \"Your photo\" is no photo input: it ships empty", () => {
      const withAuthorsPhoto = nodes.map((n) =>
        n.id === "creator" ? { ...n, data: { ...n.data, source: "photo" } }
          : n.id === "photo" ? { ...n, data: { ...n.data, url: "https://cdn.example/author.png", r2Url: "https://cdn.example/author.png" } }
            : n,
      )
      const none = ugcCreatorsWithoutPhotoInput(composedOf(asWorkflow(withAuthorsPhoto)), new Set(), { creatorTakesPhoto: false })
      expect(none.map((x) => x.node.id)).toEqual(["creator"])
      // The same upload taken as one of the component's inputs is the caller's photo.
      expect(ugcCreatorsWithoutPhotoInput(composedOf(asWorkflow(withAuthorsPhoto)), new Set(["photo"]), { creatorTakesPhoto: false })).toEqual([])
    })

    it("its outputs are the captioned video and the Notes text", () => {
      const outputs = (presentation.outputOrder ?? []).map((id) => nodes.find((n) => n.id === id)!)
      expect(outputs.map((n) => [n.id, getOutputType(n.type)])).toEqual([
        ["captions", "video"],
        ["cards", "text"],
      ])
    })
  })
})
