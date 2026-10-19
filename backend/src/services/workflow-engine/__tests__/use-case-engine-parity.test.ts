// @test-watches tools/units/__fixtures__/use-case-engine-parity.json tools/units/__fixtures__/use-case-output-shapes.json backend/src/nodes/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"
import { extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import { executeExtractField, executeFilterList, executeJsonProcess } from "../inline-executor.js"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { seededFromSavedData } from "../saved-data.js"

/**
 * What a use-case node hands on from what it holds, on the server's engine —
 * its real readers, over tools/units/__fixtures__/use-case-engine-parity.json.
 * The editor's half, held to the same values, is
 * frontend/src/__tests__/use-case-engine-parity.test.ts. A node the run does
 * not run is read the way the orchestrator reads it: its saved output, seeded.
 */
const FIXTURES = path.resolve(__dirname, "../../../../../tools/units/__fixtures__")
const SHAPES = JSON.parse(readFileSync(path.join(FIXTURES, "use-case-output-shapes.json"), "utf8")) as Record<string, Record<string, unknown>>
const PARITY = JSON.parse(readFileSync(path.join(FIXTURES, "use-case-engine-parity.json"), "utf8")) as {
  readonly handOn: ReadonlyArray<{ readonly type: string; readonly shape: string; readonly pip: string | null; readonly value: string | null }>
  readonly prompt: ReadonlyArray<{ readonly type: string; readonly shape: string; readonly target: string; readonly handle: string; readonly prompt: string | null }>
  readonly jsonReaders: ReadonlyArray<{
    readonly type: string
    readonly shape: string
    readonly consumer: "extract-field" | "json-process" | "filter-list"
    readonly data: Record<string, unknown>
    readonly text?: string
    readonly processedResult?: unknown
    readonly items?: readonly string[]
  }>
  readonly fanOut: ReadonlyArray<{ readonly type: string; readonly shape: string; readonly items: readonly string[] | null }>
  readonly listModes: ReadonlyArray<{ readonly type: string; readonly shape: string; readonly mode: string; readonly prompt: string | null }>
}

function source(type: string, shape: string): SimpleNode {
  const data = SHAPES[shape]
  if (!data) throw new Error(`no shape ${shape} in use-case-output-shapes.json`)
  return { id: "s", type, data: { label: type, ...data } }
}
const seeded = (src: SimpleNode): Record<string, NodeExecutionState> => ({ s: seededFromSavedData(extractSavedNodeOutput(src)) })

describe("a use-case node's hand-on — the server's engine", () => {
  it("covers the use-case nodes, the json pip, and a null plan (never vacuous)", () => {
    expect(new Set(PARITY.handOn.map((r) => r.type))).toEqual(new Set(["tighten-episode", "episode-chapters", "episode-trailer"]))
    expect(PARITY.handOn.some((r) => r.shape === "nullPlan" && r.pip === "json")).toBe(true)
    expect(PARITY.handOn.some((r) => r.shape === "chaptersReviewed" && r.pip === "json")).toBe(true)
  })

  for (const r of PARITY.handOn) {
    it(`${r.type} ${r.shape} → ${r.pip ?? "(no pip)"}`, () => {
      const output = extractSavedNodeOutput(source(r.type, r.shape))
      expect((output ? getPrimaryOutput(output, r.type, r.pip ?? undefined) : undefined) ?? null).toBe(r.value)
    })
  }
})

describe("a use-case node's json pip into a text or prompt input — the server's engine", () => {
  for (const r of PARITY.prompt) {
    it(`${r.type} ${r.shape} json → ${r.target}.${r.handle}`, () => {
      const src = source(r.type, r.shape)
      const node: SimpleNode = { id: "t", type: r.target, data: { label: r.target } }
      const edges: SimpleEdge[] = [{ id: "e", source: "s", target: "t", sourceHandle: "json", targetHandle: r.handle }]
      const inputs = resolveNodeInputs(node, edges, seeded(src), [src, node])
      expect(inputs.prompt ?? null).toBe(r.prompt)
      expect(inputs.videoUrl).toBeUndefined()
    })
  }
})

describe("the JSON consumers on a use-case node's json pip — the server's engine", () => {
  for (const c of PARITY.jsonReaders) {
    it(`${c.type} ${c.shape} json → ${c.consumer}`, () => {
      const src = source(c.type, c.shape)
      const node: SimpleNode = { id: "c", type: c.consumer, data: { label: c.consumer, ...c.data } }
      const edges: SimpleEdge[] = [{ id: "e", source: "s", target: "c", sourceHandle: "json", targetHandle: "in" }]
      const states = seeded(src)
      if (c.consumer === "extract-field") expect(executeExtractField(node, edges, [src, node], states).extractedText).toBe(c.text)
      else if (c.consumer === "json-process") expect(executeJsonProcess(node, edges, [src, node], states).processedResult).toEqual(c.processedResult)
      else expect(executeFilterList(node, edges, [src, node], states).listResults).toEqual(c.items)
    })
  }
})

describe("an Each wire from a use-case node's json pip — the server's engine", () => {
  for (const c of PARITY.fanOut) {
    it(`${c.type} ${c.shape}`, () => {
      const src = source(c.type, c.shape)
      const node: SimpleNode = { id: "c", type: "text-prompt", data: { label: "Prompt" } }
      const edges: SimpleEdge[] = [{ id: "e", source: "s", target: "c", sourceHandle: "json", targetHandle: "in", data: { outputMode: "each" } } as SimpleEdge]
      expect(getListFanOutForNode(node, edges, seeded(src), [src, node])?.items ?? null).toEqual(c.items)
    })
  }
})

describe("an item wire from a use-case node's json pip — the server's engine", () => {
  for (const c of PARITY.listModes) {
    it(`${c.type} ${c.shape} ${c.mode}`, () => {
      const src = source(c.type, c.shape)
      const node: SimpleNode = { id: "c", type: "text-prompt", data: { label: "Prompt" } }
      const edges: SimpleEdge[] = [{ id: "e", source: "s", target: "c", sourceHandle: "json", targetHandle: "in", data: { outputMode: c.mode } } as SimpleEdge]
      expect(resolveNodeInputs(node, edges, seeded(src), [src, node]).prompt ?? null).toBe(c.prompt)
    })
  }
})

/**
 * A social post reads `caption ?? prompt` (node-executor.ts). A use-case
 * node's plan lands as the prompt, so a caption wired from elsewhere (an RSS
 * feed's item lands as the caption) wins whatever the wire order — before, both
 * wires wrote the caption and the last one won. Server only: the editor's
 * social-post executor reads the prompt alone.
 */
describe("a social post with a caption wire and a use-case plan wire — the server's engine", () => {
  const plan = PARITY.handOn.find((r) => r.type === "tighten-episode" && r.shape === "videoTakes" && r.pip === "json")!.value
  for (const order of ["caption wire first", "plan wire first"] as const) {
    it(order, () => {
      const tighten = source("tighten-episode", "videoTakes")
      const rss: SimpleNode = { id: "r", type: "rss-feed", data: { label: "Feed" } }
      const post: SimpleNode = { id: "p", type: "instagram-post", data: { label: "Post" } }
      const captionEdge: SimpleEdge = { id: "e1", source: "r", target: "p", sourceHandle: null, targetHandle: "in" }
      const planEdge: SimpleEdge = { id: "e2", source: "s", target: "p", sourceHandle: "json", targetHandle: "in" }
      const edges = order === "caption wire first" ? [captionEdge, planEdge] : [planEdge, captionEdge]
      const states = { ...seeded(tighten), r: { status: "completed", output: { text: "My caption" } } as NodeExecutionState }
      const inputs = resolveNodeInputs(post, edges, states, [tighten, rss, post])
      expect(inputs.caption).toBe("My caption")
      expect(inputs.prompt).toBe(plan)
      expect(inputs.caption ?? inputs.prompt).toBe("My caption")
    })
  }
})

