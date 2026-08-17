import { describe, it, expect } from "vitest"
// The seeded template itself, imported so the path is resolved at build time
// rather than against whatever directory the runner happens to start in.
import seed from "../../../../../backend/src/lib/tutorial-seed/templates/one-character-any-scene.json"
import { deriveOneCharacterGraph, parseImageTokens, recipeKey } from "../bodies/one-character-recipes"
import { CROPS, RECIPE_COPY, RECIPE_ORDER, copyFor, cropFor } from "../bodies/one-character-content"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}, y = 0) =>
  ({ id, type, position: { x: 0, y }, data }) as unknown as WorkflowNode

const edge = (source: string, target: string, sourceHandle = "image", targetHandle = "references") =>
  ({ id: `${source}-${target}`, source, target, sourceHandle, targetHandle }) as unknown as WorkflowEdge

describe("parseImageTokens / recipeKey", () => {
  it("splits plain runs from bare and qualified tokens and round-trips the prompt", () => {
    const prompt = "{image:1:person} wearing {image:2:jacket}  on top ,at{image:2:settings} "
    const parts = parseImageTokens(prompt)
    expect(parts.map((p) => p.text).join("")).toBe(prompt)
    expect(parts.filter((p) => p.n !== null).map((p) => [p.n, p.qualifier])).toEqual([[1, "person"], [2, "jacket"], [2, "settings"]])
    expect(parseImageTokens("{image:3} plain").map((p) => [p.n, p.qualifier])).toEqual([[3, null], [null, null]])
  })
  it("keys a recipe by which parts of which numbers it names — not by the words between", () => {
    expect(recipeKey("{image:1:person} with {image:2:face}")).toBe("1:person 2:face")
    expect(recipeKey("{image:1:person}  WITH   {image:2:face} !")).toBe("1:person 2:face")
    expect(recipeKey("{image:1} and {image:1:person}")).toBe("1: 1:person") // bare stays distinct
    expect(recipeKey("no tokens here")).toBe("")
  })
})

describe("deriveOneCharacterGraph — structural, never by id or label", () => {
  const graph = () => ({
    nodes: [
      node("gen", "generate-image", { label: "Star", generatedImageUrl: "https://cdn/star.png" }, 100),
      node("up", "upload-image", { label: "Ref", url: "https://cdn/ref.png" }, 200),
      // authored order is 1:person 2:face first — put it LAST on the canvas to prove sorting
      node("r-swap", "generate-image", { label: "Swap", prompt: "{image:2:person} with {image:1:face}", provider: "gpt-image-2", resolution: "2K", aspectRatio: "16:9", generatedImageUrl: "https://cdn/swap.png" }, 10),
      node("r-base", "generate-image", { label: "Base", prompt: "{image:1:person} with {image:2:face}", provider: "gpt-image-2", generatedImageUrl: "https://cdn/base.png" }, 900),
      node("r-new", "generate-image", { label: "New idea", prompt: "{image:2:hair} on {image:1:person}", provider: "nano-banana-pro" }, 500),
      node("plain", "generate-image", { label: "No refs", prompt: "a cat" }, 50),
    ],
    edges: [
      edge("gen", "r-swap"), edge("up", "r-swap"),
      edge("gen", "r-base"), edge("up", "r-base"),
      edge("gen", "r-new"), edge("up", "r-new"),
    ],
  })

  it("finds recipes by shape (qualified tokens + wired references), sorts them into the authored lesson order, then canvas order", () => {
    const g = deriveOneCharacterGraph(graph().nodes, graph().edges, RECIPE_ORDER)
    expect(g.recipes.map((r) => [r.index, r.nodeId])).toEqual([[1, "r-base"], [2, "r-swap"], [3, "r-new"]])
    expect(g.sharedSources).toBe(true)
  })

  it("resolves {image:N} through the recipe's own References wiring, in edge order", () => {
    const g = deriveOneCharacterGraph(graph().nodes, graph().edges, RECIPE_ORDER)
    expect(g.sources.map((s) => [s.position, s.nodeId, s.kind])).toEqual([[1, "gen", "generated"], [2, "up", "uploaded"]])
    const swap = g.recipes[1]
    expect(swap.borrows.map((b) => [b.token, b.source?.nodeId])).toEqual([["{image:2:person}", "up"], ["{image:1:face}", "gen"]])
    expect(swap.resultUrl).toBe("https://cdn/swap.png")
    expect([swap.provider, swap.resolution, swap.aspectRatio]).toEqual(["gpt-image-2", "2K", "16:9"])
  })

  it("a recipe the content file does not know still renders — with honest fallback prose and crops", () => {
    const g = deriveOneCharacterGraph(graph().nodes, graph().edges, RECIPE_ORDER)
    const novel = g.recipes[2]
    expect(novel.key).toBe("2:hair 1:person")
    expect(copyFor(novel.key, novel.index).lessonKind).toBe("ANOTHER COMBINATION")
    expect(cropFor("hair").caption).toBe("the hair")
    expect(cropFor("settings").blank).toBe(true)
  })

  it("flags sources that differ between recipes", () => {
    const { nodes, edges } = graph()
    const other = node("up2", "upload-image", { url: "https://cdn/other.png" })
    const g = deriveOneCharacterGraph([...nodes, other], [...edges.filter((e) => e.target !== "r-new"), edge("gen", "r-new"), edge("up2", "r-new")], RECIPE_ORDER)
    expect(g.sharedSources).toBe(false)
  })

  it("has no recipes when nothing is wired", () => {
    const g = deriveOneCharacterGraph([node("x", "generate-image", { prompt: "{image:1:face}" })], [], RECIPE_ORDER)
    expect(g.recipes).toEqual([])
    expect(g.sources).toEqual([])
  })
})

describe("the seeded template", () => {
  const nodes = seed.nodes as unknown as WorkflowNode[]
  const edges = seed.edges as unknown as WorkflowEdge[]

  it("reads two shared sources and the five recipes in the authored order, every one with a result", () => {
    const g = deriveOneCharacterGraph(nodes, edges, RECIPE_ORDER)
    expect(g.sources.map((s) => s.kind)).toEqual(["generated", "uploaded"])
    expect(g.sharedSources).toBe(true)
    expect(g.recipes.map((r) => r.key)).toEqual(RECIPE_ORDER)
    for (const r of g.recipes) {
      expect(r.resultUrl).toMatch(/^https:\/\/cdn\.nodaro\.ai\//)
      expect(r.borrows.every((b) => b.source !== null)).toBe(true)
    }
    // the group frames and the sources are not recipes
    expect(g.recipes).toHaveLength(5)
  })

  it("every authored note and crop is reachable from the seed — no orphaned copy", () => {
    const g = deriveOneCharacterGraph(nodes, edges, RECIPE_ORDER)
    for (const [signature, copy] of RECIPE_COPY) {
      const recipe = g.recipes.find((r) => r.key === signature)
      expect(recipe, signature).toBeDefined()
      const borrowed = new Set(recipe!.borrows.map((b) => `${b.n}:${b.qualifier}`))
      for (const noteKey of Object.keys(copy.notes)) expect(borrowed.has(noteKey), `${signature} note ${noteKey}`).toBe(true)
      for (const b of recipe!.borrows) expect(Object.hasOwn(CROPS, b.qualifier), `crop for ${b.qualifier}`).toBe(true)
    }
  })

  it("carries no transient run-state (stale errors would surface in Canvas mode)", () => {
    for (const n of seed.nodes as Array<{ data?: Record<string, unknown> }>) {
      expect(n.data ?? {}).not.toHaveProperty("errorMessage")
      expect(n.data ?? {}).not.toHaveProperty("executionStatus")
    }
  })
})
