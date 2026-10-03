/**
 * Content Recipe and Content Ideas into the prompt of the node after them, on
 * the editor's own run path (a node's Run button). The server routes every text
 * source into `inputs.prompt`; the editor's resolver used to have no branch for
 * these two, so a Prompt node fed by Content Ideas ran with no prompt ("no user
 * prompt provided") — the Steal the Format template's last step.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, "../../../../../../backend/src/lib/tutorial-seed/templates/steal-the-format.json")

const BRIEFS = ["IDEA 1 of 3: one", "IDEA 2 of 3: two", "IDEA 3 of 3: three"]
const DIGEST = "CONTENT IDEAS (3)\n1. one\n2. two\n3. three"
const RECIPE_TEXT = "CONTENT RECIPE\nHook: a question"
const RECIPE_JSON = { version: 1, hook: { line: "a question" } }

function node(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as unknown as WorkflowNode
}

function wire(source: string, sourceHandle: string, data?: Record<string, unknown>): WorkflowEdge {
  return { id: `e-${source}`, source, target: "S", sourceHandle, targetHandle: "prompt", data } as unknown as WorkflowEdge
}

const ideas = node("I", "content-ideas", { ideaBriefs: BRIEFS, generatedText: DIGEST, generatedJson: [{}, {}, {}] })
const recipe = node("R", "content-recipe", { generatedText: RECIPE_TEXT, generatedJson: RECIPE_JSON })
const prompt = node("S", "llm-chat", { userInput: "", systemPrompt: "Write a script." })

function promptFrom(source: WorkflowNode, edge: WorkflowEdge, row?: number): unknown {
  return resolveNodeInputs(prompt, [source, prompt], [edge], row).prompt
}

describe("Content Ideas → the prompt of the node after it", () => {
  it("an item wire hands over the idea it names", () => {
    expect(promptFrom(ideas, wire("I", "ideas", { outputMode: "item", itemIndex: "1" }))).toBe(BRIEFS[0])
    expect(promptFrom(ideas, wire("I", "ideas", { outputMode: "item", itemIndex: "3" }))).toBe(BRIEFS[2])
  })

  it("a run once per idea hands over that row's idea", () => {
    expect(promptFrom(ideas, wire("I", "ideas"), 1)).toBe(BRIEFS[1])
  })

  it("Selected hands over the digest of every idea, as the server does", () => {
    expect(promptFrom(ideas, wire("I", "ideas", { outputMode: "last" }))).toBe(DIGEST)
  })

  it("Bundle hands over every idea in one prompt", () => {
    expect(promptFrom(ideas, wire("I", "ideas", { outputMode: "all" }))).toBe(BRIEFS.join(", "))
  })
})

describe("Content Recipe → the prompt of the node after it", () => {
  it("the text handle hands over the readable recipe", () => {
    expect(promptFrom(recipe, wire("R", "text"))).toBe(RECIPE_TEXT)
  })

  it("the json handle hands over the recipe object as JSON", () => {
    expect(promptFrom(recipe, wire("R", "json"))).toBe(JSON.stringify(RECIPE_JSON))
  })
})

describe("the Steal the Format template", () => {
  it("its Script node gets the idea its wire picks once Content Ideas has run", () => {
    const doc = JSON.parse(readFileSync(TEMPLATE, "utf8")) as { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
    const ran = doc.nodes.map((n) =>
      n.type === "content-ideas" ? { ...n, data: { ...n.data, ideaBriefs: BRIEFS, generatedText: DIGEST } } : n,
    ) as WorkflowNode[]
    const script = ran.find((n) => (n.data as { label?: string }).label === "Script")!
    expect(resolveNodeInputs(script, ran, doc.edges).prompt).toBe(BRIEFS[0])
  })
})
