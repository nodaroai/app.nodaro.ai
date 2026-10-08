/**
 * The editor's estimate and the listing a published app, component or
 * template stores count a node's runs with ONE rule (decided 2026-10-07):
 * `@nodaro/render-rules`' `nodeFanOut` — a Repeat count, a List's items, a
 * Content Ideas' ideas (5 when no count is set), a Social Search's posts and a
 * clips plan's clips. The listing's half is
 * backend/src/ee/billing/__tests__/listing-fan-outs.test.ts.
 *
 * The source scan fails the build when the editor declares a fan-out rule of
 * its own again: a copy can drift from what the listing counts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { nodeFanOut } from "@nodaro/render-rules"
import { getFanOutMultiplier } from "@/components/editor/workflow-editor/types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const e = (source: string, target: string, data?: Record<string, unknown>): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle: "prompt", ...(data ? { data } : {}) }) as WorkflowEdge

type Case = { name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; target: string; runs: number }
const CASES: Case[] = [
  { name: "a Repeat count", nodes: [n("img", "generate-image", { repeatCount: 4 })], edges: [], target: "img", runs: 4 },
  { name: "a List's items", nodes: [n("l", "list", { items: "a\nb\nc" }), n("img", "generate-image")], edges: [e("l", "img")], target: "img", runs: 3 },
  { name: "a List's items times a Repeat count", nodes: [n("l", "list", { items: "a\nb\nc" }), n("img", "generate-image", { repeatCount: 2 })], edges: [e("l", "img")], target: "img", runs: 6 },
  { name: "a List through a Text node", nodes: [n("l", "list", { items: "a\nb" }), n("t", "text-prompt"), n("img", "generate-image")], edges: [e("l", "t"), e("t", "img", { outputMode: "each" })], target: "img", runs: 2 },
  { name: "Content Ideas at its default count", nodes: [n("ci", "content-ideas"), n("s", "generate-script")], edges: [e("ci", "s")], target: "s", runs: 5 },
  { name: "Content Ideas at its count", nodes: [n("ci", "content-ideas", { count: 7 }), n("s", "generate-script")], edges: [e("ci", "s")], target: "s", runs: 7 },
  { name: "a fresh Social Search on an Each wire", nodes: [n("ss", "social-search"), n("llm", "llm-chat")], edges: [e("ss", "llm", { outputMode: "each" })], target: "llm", runs: 5 },
  { name: "a clips plan at its default count", nodes: [n("p", "edit-plan", { mode: "clips" }), n("r", "apply-edl")], edges: [e("p", "r")], target: "r", runs: 8 },
]

describe("the editor's estimate counts a node's runs with the listing's rule", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    // A whole-workflow run: every node re-runs, as the listing prices it.
    const reruns = new Set(c.nodes.map((x) => x.id))
    const node = c.nodes.find((x) => x.id === c.target)!
    expect(getFanOutMultiplier(node, c.nodes, c.edges, reruns)).toBe(c.runs)
    expect(nodeFanOut(node, c.nodes, c.edges, reruns)).toBe(c.runs)
  })
})

describe("the editor declares no fan-out rule of its own", () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(HERE, "../../components/editor/workflow-editor/types.ts"), "utf8")
  it.each(["function getBaseFanOut", "function contentIdeasFanOut", "function socialSearchFanOut", "function fanOutCount", ".split(\"\\n\")"])("%s", (decl) => {
    expect(src.includes(decl), decl).toBe(false)
  })
})
