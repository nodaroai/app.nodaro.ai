/**
 * Every text producer reaches the prompt of the node it is wired into, on the
 * editor's own run path. TEXT_PRODUCER_TYPES is what the connection validator
 * lets a person wire into a prompt; the resolver routes by a chain of per-type
 * branches, and a type with no branch used to be dropped without a word (a
 * Prompt node fed by Content Ideas ran with "no user prompt provided"; Telegram's
 * three nodes fed nothing). Here each type's output is a fixed marker, so the
 * test asks only the routing question, whatever the type's own data looks like.
 */
import { describe, it, expect, vi } from "vitest"

const MARKER = "TEXT-FROM-THE-SOURCE"

vi.mock("../execution-graph", async (orig) => ({
  ...(await orig<typeof import("../execution-graph")>()),
  extractNodeOutput: () => MARKER,
}))

import { resolveNodeInputs } from "../node-input-resolver"
import { TEXT_PRODUCER_TYPES } from "@/lib/generate-image-handles"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as unknown as WorkflowNode
}

describe("text producers → a Prompt node's prompt", () => {
  it.each([...TEXT_PRODUCER_TYPES])("%s hands its text over", (type) => {
    const source = node("SRC", type)
    const consumer = node("DST", "llm-chat", { userInput: "", systemPrompt: "" })
    const edge = { id: "e", source: "SRC", target: "DST", targetHandle: "prompt" } as unknown as WorkflowEdge
    expect(resolveNodeInputs(consumer, [source, consumer], [edge]).prompt).toContain(MARKER)
  })
})
