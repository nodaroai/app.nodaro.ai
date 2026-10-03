/**
 * Structural validation for the Impossible Materials template.
 *
 * The template only works while a handful of wiring invariants hold, and none of
 * them is visible from the canvas once it is cloned:
 * - both directors are told to separate their six blocks with `===NEXT===`, so
 *   each Split Text must cut on exactly that separator;
 * - the six selectors of a lane pick items 1..6, one each;
 * - morph k animates from material k (start frame) to material k+1 (end frame),
 *   and morph 6 returns to material 1, which is what makes the reel loop;
 * - Combine Videos orders clips by edge order, so the reel's edges must run
 *   morph 1..6;
 * - the LLM prompts reference upstream nodes by label (`{Direction}`,
 *   `{Material Director}`), so a renamed node silently empties the prompt.
 */
import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { TEMPLATE_CATEGORIES, canonicalVarName, extractReferencedLabels } from "@nodaro/shared"
import { NODE_HANDLES } from "../../mcp/generated/node-handles.js"
import type { TutorialTemplateDoc } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = join(HERE, "..", "templates", "impossible-materials.json")
const SEPARATOR = "===NEXT==="
const LANES = [1, 2, 3, 4, 5, 6] as const

type Node = { id: string; type: string; data: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

async function load(): Promise<{ doc: TutorialTemplateDoc; nodes: Node[]; edges: Edge[] }> {
  const doc = JSON.parse(await readFile(TEMPLATE_PATH, "utf8")) as TutorialTemplateDoc
  return { doc, nodes: doc.nodes as Node[], edges: doc.edges as Edge[] }
}

function incoming(edges: Edge[], target: string, handle: string): Edge[] {
  return edges.filter((e) => e.target === target && e.targetHandle === handle)
}

describe("Impossible Materials template", () => {
  it("declares the card metadata for the campaign-concepts use case", async () => {
    const { doc } = await load()
    expect(doc.slug).toBe("impossible-materials")
    expect(TEMPLATE_CATEGORIES).toContain(doc.category)
    expect(doc.category).toBe("campaign-concepts")
    expect(doc.outputTypes).toEqual(["image", "video"])
    expect(doc.previewMediaUrl).toMatch(/^https:\/\//)
    expect(Number.isInteger(doc.estimatedCredits)).toBe(true)
    expect(doc.estimatedCredits).toBeGreaterThan(0)
  })

  it("uses only registered node types and wires every edge to a real handle", async () => {
    const { nodes, edges } = await load()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const node of nodes) {
      expect(NODE_HANDLES[node.type], `node type "${node.type}" (${node.id}) is registered`).toBeDefined()
    }
    for (const edge of edges) {
      const src = byId.get(edge.source)
      const tgt = byId.get(edge.target)
      expect(src, `edge ${edge.id} source exists`).toBeDefined()
      expect(tgt, `edge ${edge.id} target exists`).toBeDefined()
      expect(NODE_HANDLES[src!.type].outputs, `edge ${edge.id} source handle`).toContain(edge.sourceHandle)
      expect(NODE_HANDLES[tgt!.type].inputs, `edge ${edge.id} target handle`).toContain(edge.targetHandle)
    }
  })

  it("splits both directors' answers on the separator their prompts ask for", async () => {
    const { nodes } = await load()
    for (const id of ["director", "morph_director"]) {
      const director = nodes.find((n) => n.id === id)!
      expect(String(director.data.systemPrompt)).toContain(SEPARATOR)
    }
    for (const id of ["split_materials", "split_morphs"]) {
      const split = nodes.find((n) => n.id === id)!
      expect(split.data.separator).toBe("custom")
      expect(split.data.customSeparator).toBe(SEPARATOR)
    }
  })

  it("picks items 1..6 exactly once in each lane", async () => {
    const { nodes } = await load()
    for (const prefix of ["pick_m", "pick_t"]) {
      const indexes = LANES.map((k) => {
        const selector = nodes.find((n) => n.id === `${prefix}${k}`)!
        return (selector.data.config as { itemIndex: string }).itemIndex
      })
      expect(indexes).toEqual(["1", "2", "3", "4", "5", "6"])
    }
  })

  it("animates each morph from material k to material k+1 and loops 6 back to 1", async () => {
    const { edges } = await load()
    for (const k of LANES) {
      const next = (k % 6) + 1
      const start = incoming(edges, `morph_${k}`, "startFrame")
      const end = incoming(edges, `morph_${k}`, "endFrame")
      expect(start.map((e) => e.source), `morph_${k} start frame`).toEqual([`mat_${k}`])
      expect(end.map((e) => e.source), `morph_${k} end frame`).toEqual([`mat_${next}`])
    }
  })

  it("feeds the reel morph 1..6 in order and the poster all six materials", async () => {
    const { edges } = await load()
    expect(incoming(edges, "reel", "in").map((e) => e.source)).toEqual(LANES.map((k) => `morph_${k}`))
    expect(incoming(edges, "poster", "in").map((e) => e.source).sort()).toEqual(LANES.map((k) => `mat_${k}`))
  })

  it("references upstream nodes by labels that exist", async () => {
    const { nodes } = await load()
    const labels = new Set(nodes.map((n) => canonicalVarName(String(n.data.label))))
    for (const id of ["director", "morph_director"]) {
      const refs = extractReferencedLabels(String(nodes.find((n) => n.id === id)!.data.userInput))
      expect(refs.size, `${id} references an upstream node`).toBeGreaterThan(0)
      for (const ref of refs) expect(labels, `${id} references {${ref}}`).toContain(ref)
    }
  })

  it("gives the optional Direction a fallback so an empty one never reaches the model as a literal token", async () => {
    const { nodes } = await load()
    const userInput = String(nodes.find((n) => n.id === "director")!.data.userInput)
    expect(userInput).toMatch(/\{Direction\s*\|\|\s*[^}]+\}/)
  })

  it("ships clean: no run results baked into any node", async () => {
    const { nodes } = await load()
    const runKeys = ["generatedResults", "generatedImageUrl", "generatedText", "currentJobId", "executionStatus"]
    for (const node of nodes) {
      for (const key of runKeys) {
        const value = node.data[key]
        const empty = value === undefined || (Array.isArray(value) && value.length === 0) || value === "idle"
        expect(empty, `${node.id}.data.${key} is empty`).toBe(true)
      }
    }
  })
})
