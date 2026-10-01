/**
 * Structural validation for the "Steal the Format" template: a post link and a
 * brand in, five content ideas with a script each out.
 *
 * Same guard as podcast-templates.test.ts — every node type is registered in
 * NODE_HANDLES and every edge lands on a real handle — plus the wiring this
 * template exists for: the Video URL feeds both the analysis and the recipe's
 * `link` (so every idea can cite the post), the brand reaches Content Ideas as
 * a field, and the script node runs once per idea on the economy model.
 * The frontend twin (frontend/src/lib/__tests__/steal-the-format-connections
 * .test.ts) proves every edge is a connection the canvas accepts.
 */
import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { FAN_OUT_EACH_TYPES, TEMPLATE_CATEGORIES, buildLlmCreditIdentifier } from "@nodaro/shared"
import { NODE_HANDLES } from "../../mcp/generated/node-handles.js"
import { CLOUD_ONLY_NODE_TYPES } from "../../cloud-only-nodes.js"
import type { TutorialTemplateDoc } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, "..", "templates", "steal-the-format.json")

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

async function load(): Promise<{ doc: TutorialTemplateDoc; nodes: Node[]; edges: Edge[] }> {
  const doc = JSON.parse(await readFile(TEMPLATE, "utf8")) as TutorialTemplateDoc
  return { doc, nodes: doc.nodes as Node[], edges: doc.edges as Edge[] }
}

function only(nodes: Node[], type: string): Node {
  const found = nodes.filter((n) => n.type === type)
  expect(found, `exactly one ${type} node`).toHaveLength(1)
  return found[0]!
}

function edgeBetween(edges: Edge[], source: Node, target: Node, targetHandle: string): Edge | undefined {
  return edges.find((e) => e.source === source.id && e.target === target.id && e.targetHandle === targetHandle)
}

describe("steal-the-format template", () => {
  it("declares the card metadata", async () => {
    const { doc } = await load()
    expect(doc.slug).toBe("steal-the-format")
    expect(doc.name.length).toBeGreaterThan(0)
    expect(TEMPLATE_CATEGORIES).toContain(doc.category)
    expect(doc.outputTypes).toEqual(["text"])
    expect(typeof doc.tutorialCategorySlug).toBe("string")
    expect(typeof doc.tutorialSortOrder).toBe("number")
    expect(doc.estimatedCredits).toBeGreaterThan(0)
  })

  it("is not listed in the marketplace yet", async () => {
    // Staging and production share one database: a marketplace-listed built-in
    // seeded by a staging boot would show in production's marketplace before
    // production runs these nodes. Listing it is a deliberate later step.
    const { doc } = await load()
    expect(doc.listedIn).toBeUndefined()
  })

  it("names every node type it uses, and each one is registered", async () => {
    const { doc, nodes } = await load()
    for (const node of nodes) {
      expect(node.id, `node ${JSON.stringify(node.id)} has an id`).toBeTruthy()
      expect(NODE_HANDLES[node.type], `node type "${node.type}" (${node.id}) is registered`).toBeDefined()
    }
    expect(new Set(doc.nodeTypesUsed)).toEqual(new Set(nodes.map((n) => n.type)))
  })

  it("wires every edge to a real handle on a real node", async () => {
    const { nodes, edges } = await load()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const edge of edges) {
      const src = byId.get(edge.source)
      const tgt = byId.get(edge.target)
      expect(src, `edge ${edge.id} source "${edge.source}" exists`).toBeDefined()
      expect(tgt, `edge ${edge.id} target "${edge.target}" exists`).toBeDefined()
      expect(NODE_HANDLES[src!.type]!.outputs, `edge ${edge.id}: output of ${src!.type}`).toContain(edge.sourceHandle)
      expect(NODE_HANDLES[tgt!.type]!.inputs, `edge ${edge.id}: input of ${tgt!.type}`).toContain(edge.targetHandle)
    }
  })

  it("runs on Cloud only — the seeder keeps it off editions without these nodes", async () => {
    const { nodes } = await load()
    expect(nodes.some((n) => CLOUD_ONLY_NODE_TYPES.has(n.type))).toBe(true)
  })

  it("the post link feeds the analysis AND the recipe's link, and the analysis is the recipe's material", async () => {
    const { nodes, edges } = await load()
    const post = only(nodes, "youtube-video")
    const analysis = only(nodes, "video-analysis")
    const recipe = only(nodes, "content-recipe")
    expect(edgeBetween(edges, post, analysis, "video")?.sourceHandle).toBe("video")
    expect(edgeBetween(edges, post, recipe, "link")?.sourceHandle).toBe("video")
    expect(edgeBetween(edges, analysis, recipe, "in")?.sourceHandle).toBe("json")
  })

  it("the recipe and the brand reach Content Ideas on their own handles", async () => {
    const { nodes, edges } = await load()
    const recipe = only(nodes, "content-recipe")
    const ideas = only(nodes, "content-ideas")
    const brand = only(nodes, "text-prompt")
    expect(edgeBetween(edges, recipe, ideas, "recipes")?.sourceHandle).toBe("text")
    expect(edgeBetween(edges, brand, ideas, "field-brand")?.sourceHandle).toBe("prompt")
    expect(String(brand.data?.text ?? "").trim().length).toBeGreaterThan(0)
    expect(ideas.data?.count).toBe(5)
  })

  it("the script node runs once per idea, on the economy model", async () => {
    const { nodes, edges } = await load()
    const ideas = only(nodes, "content-ideas")
    const script = only(nodes, "generate-script")
    const wire = edgeBetween(edges, ideas, script, "prompt")
    expect(wire?.sourceHandle).toBe("ideas")
    // Content Ideas fans out by type; an explicit "selected" mode on the wire
    // would hand the script every idea as one text.
    expect(FAN_OUT_EACH_TYPES.has("content-ideas")).toBe(true)
    expect(wire?.data?.outputMode).toBeUndefined()
    // Pinned: without llmModel the run bills the standard script price.
    expect(buildLlmCreditIdentifier("generate-script", script.data?.llmModel as string | undefined)).toBe("generate-script:economy")
  })

  it("ends at the scripts — nothing downstream of the script node", async () => {
    const { nodes, edges } = await load()
    const script = only(nodes, "generate-script")
    expect(edges.filter((e) => e.source === script.id)).toEqual([])
  })
})
