import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { NodeExecutionState, SimpleNode } from "../types.js"

/**
 * Regression: a telegram-trigger wired to a References/prompt input must route
 * by the message's ACTUAL media kind — a photo message feeds referenceImageUrls
 * (a URL), a text message feeds prompt. The bug: the trigger's primary output
 * is the message TEXT, and the generic references-handle map pushed that text
 * into referenceImageUrls → "Invalid URL" at the llm-chat route.
 */

function trigger(output: Record<string, unknown>): { node: SimpleNode; state: NodeExecutionState } {
  const node: SimpleNode = { id: "trig", type: "telegram-trigger", data: {} }
  const state: NodeExecutionState = { status: "completed", output } as NodeExecutionState
  return { node, state }
}

const llmChat: SimpleNode = { id: "llm", type: "llm-chat", data: {} }

function resolve(
  target: SimpleNode,
  targetHandle: string,
  triggerOutput: Record<string, unknown>,
) {
  const { node, state } = trigger(triggerOutput)
  const nodes = [node, target]
  const edges = [{ id: "e", source: "trig", target: target.id, sourceHandle: "out", targetHandle }]
  const nodeStates: Record<string, NodeExecutionState> = { trig: state }
  return resolveNodeInputs(target, edges, nodeStates, nodes)
}

describe("telegram-trigger input routing", () => {
  it("photo message → References lands the IMAGE URL in referenceImageUrls (not the text)", () => {
    const inputs = resolve(llmChat, "references", {
      text: "check this out",
      imageUrl: "https://cdn.test/telegram/u1/9-photo.jpg",
    })
    expect(inputs.referenceImageUrls).toEqual(["https://cdn.test/telegram/u1/9-photo.jpg"])
    // The caption text must NOT be shoved into the image-ref array.
    expect(inputs.referenceImageUrls?.every((u) => u.startsWith("http"))).toBe(true)
  })

  it("text message → prompt (no image ref at all)", () => {
    const inputs = resolve(llmChat, "prompt", { text: "rewrite this in my voice" })
    expect(inputs.prompt).toBe("rewrite this in my voice")
    expect(inputs.referenceImageUrls ?? []).toEqual([])
  })

  it("empty trigger (manual Run, no message) never fabricates an invalid ref", () => {
    const inputs = resolve(llmChat, "references", {})
    expect(inputs.referenceImageUrls ?? []).toEqual([])
  })

  it("photo message → social post caption uses the text, image rides its lane", () => {
    const social: SimpleNode = { id: "tg", type: "telegram-post", data: { action: "send-photo" } }
    const inputs = resolve(social, "in", {
      text: "my caption",
      imageUrl: "https://cdn.test/p.jpg",
    })
    expect(inputs.imageUrl).toBe("https://cdn.test/p.jpg")
    expect(inputs.caption).toBe("my caption")
  })
})
