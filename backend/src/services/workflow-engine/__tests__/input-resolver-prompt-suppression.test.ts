import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

// A connected `prompt`-handle source auto-injects into inputs.prompt by default,
// but is SUPPRESSED (so it's not double-injected) when the consumer references
// it as {label} in its prompt/negative, or when Inject Prompt is off. The
// suppression lives at the top of resolveNodeInputs; mirrored in the FE
// node-input-resolver. (Append of inputs.prompt onto the typed prompt happens
// later via computeNodePrompt(appendWired) — covered in resolve-prompt tests.)
function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}
function edge(source: string, target: string, targetHandle: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle }
}

const states: Record<string, NodeExecutionState> = {
  src: { status: "completed", output: { text: "wired prose" } },
}
const src = () => node("src", "text-prompt") // label === "src"

describe("input-resolver: prompt-handle variable/toggle suppression", () => {
  it("includes the wired prompt by default (not referenced, Inject Prompt on)", () => {
    const g = node("g1", "generate-image", { prompt: "a cat" })
    const r = resolveNodeInputs(g, [edge("src", "g1", "prompt")], states, [src(), g])
    expect(r.prompt).toBe("wired prose")
  })

  it("drops the wired prompt when referenced as {src} (placed by the ref, no double)", () => {
    const g = node("g1", "generate-image", { prompt: "a cat holding {src}" })
    const r = resolveNodeInputs(g, [edge("src", "g1", "prompt")], states, [src(), g])
    expect(r.prompt).toBeUndefined()
  })

  it("drops the wired prompt when referenced only in the negative field", () => {
    const g = node("g1", "generate-image", { prompt: "a cat", negativePrompt: "no {src}" })
    const r = resolveNodeInputs(g, [edge("src", "g1", "prompt")], states, [src(), g])
    expect(r.prompt).toBeUndefined()
  })

  it("drops the wired prompt when injectPrompt === false", () => {
    const g = node("g1", "generate-image", { prompt: "a cat", injectPrompt: false })
    const r = resolveNodeInputs(g, [edge("src", "g1", "prompt")], states, [src(), g])
    expect(r.prompt).toBeUndefined()
  })
})

describe("input-resolver: negative-handle variable/toggle suppression (generate-image/video only)", () => {
  it("includes the wired negative by default", () => {
    const g = node("g1", "generate-image", { prompt: "a cat" })
    const r = resolveNodeInputs(g, [edge("src", "g1", "negative")], states, [src(), g])
    expect(r.negativePrompt).toBe("wired prose")
  })
  it("drops the wired negative when referenced as {src} in the negative field", () => {
    const g = node("g1", "generate-image", { negativePrompt: "blurry {src}" })
    const r = resolveNodeInputs(g, [edge("src", "g1", "negative")], states, [src(), g])
    expect(r.negativePrompt).toBeUndefined()
  })
  it("drops the wired negative when injectNegative === false", () => {
    const g = node("g1", "generate-image", { injectNegative: false })
    const r = resolveNodeInputs(g, [edge("src", "g1", "negative")], states, [src(), g])
    expect(r.negativePrompt).toBeUndefined()
  })
  it("does NOT suppress negative for non-gen-image/video consumers (scope guard)", () => {
    const g = node("g1", "image-to-video", { negativePrompt: "blurry {src}", injectNegative: false })
    const r = resolveNodeInputs(g, [edge("src", "g1", "negative")], states, [src(), g])
    expect(r.negativePrompt).toBe("wired prose")
  })
})
