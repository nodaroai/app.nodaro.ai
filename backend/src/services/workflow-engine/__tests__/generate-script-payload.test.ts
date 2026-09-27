/**
 * Generate Script on a SERVER run: the topic and the settings go through the
 * same readers as the editor's single-node run (`computeScriptTopic`,
 * `readScriptSettings`), so what the panel shows is what the worker receives.
 *
 * Before this, a mapped Tone / Scene Count / Target length was dropped (they
 * were not in NODE_MAPPABLE_FIELDS), the style guide was never sent, and a
 * node with no topic at all billed a script written about nothing.
 */
import { describe, it, expect } from "vitest"
import { NODE_MAPPABLE_FIELDS } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import { resolveFieldMappings } from "../resolve-field-mappings.js"
import type { NodeExecutionState, SimpleNode, SimpleEdge } from "../types.js"

const JOB_ID = "job-1"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

describe("generate-script payload — topic", () => {
  it("takes the wired prompt over a saved `prompt`", () => {
    const n = node("s1", "generate-script", { prompt: "saved topic" })
    const result = buildPayload(n, JOB_ID, { prompt: "wired topic" })
    expect(result.payload.prompt).toBe("wired topic")
  })

  it("takes a list fan-out item over the wired prompt", () => {
    const n = node("s1", "generate-script", {})
    const result = buildPayload(n, JOB_ID, { prompt: "wired topic", overridePrompt: "row 3 topic" })
    expect(result.payload.prompt).toBe("row 3 topic")
  })

  it("falls back to a saved {Label} topic, resolved against the canvas", () => {
    // Older workflows carry `prompt: "{Story}"` from the connect-time auto-fill.
    const story: SimpleNode = { id: "t1", type: "text-prompt", data: { label: "Story", text: "a knight's last quest" } }
    const script = node("s1", "generate-script", { prompt: "{Story}" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "t1", target: "s1", sourceHandle: null, targetHandle: "prompt" }]
    const nodeStates: Record<string, NodeExecutionState> = {
      t1: { status: "completed", output: { text: "a knight's last quest" } },
    }
    const result = buildPayload(script, JOB_ID, {}, undefined, { nodes: [story, script], edges, nodeStates })
    expect(result.payload.prompt).toBe("a knight's last quest")
  })

  it("refuses a node with no topic before anything is billed", () => {
    const n = node("s1", "generate-script", { styleGuide: "noir" })
    expect(() => buildPayload(n, JOB_ID, {})).toThrow(/prompt_required/)
  })
})

describe("generate-script payload — settings", () => {
  it("sends the style guide, trimmed", () => {
    const n = node("s1", "generate-script", { prompt: "p", styleGuide: "  Noir, short lines  " })
    expect(buildPayload(n, JOB_ID, {}).payload.styleGuide).toBe("Noir, short lines")
  })

  it("coerces mapped text into the route's ranges instead of passing it raw", () => {
    const n = node("s1", "generate-script", {
      prompt: "p",
      sceneCount: "7",
      targetLength: "45",
      tone: "x".repeat(300),
    })
    const { payload } = buildPayload(n, JOB_ID, {})
    expect(payload.sceneCount).toBe(7)
    expect(payload.targetDuration).toBe(45)
    expect(payload.tone).toHaveLength(200)
  })

  it("clamps out-of-range numbers and drops unusable ones", () => {
    const high = buildPayload(node("s1", "generate-script", { prompt: "p", sceneCount: 99, targetLength: 5000 }), JOB_ID, {})
    expect(high.payload.sceneCount).toBe(20)
    expect(high.payload.targetDuration).toBe(600)
    const junk = buildPayload(node("s1", "generate-script", { prompt: "p", sceneCount: "many", targetLength: "short" }), JOB_ID, {})
    expect(junk.payload.sceneCount).toBeUndefined()
    expect(junk.payload.targetDuration).toBeUndefined()
  })

  it("still reads the older keys when the panel's field is absent", () => {
    const { payload } = buildPayload(node("s1", "generate-script", { prompt: "p", style: "somber", targetDuration: 90 }), JOB_ID, {})
    expect(payload.tone).toBe("somber")
    expect(payload.targetDuration).toBe(90)
  })

  it("prefers the panel's length over the route-named key", () => {
    const { payload } = buildPayload(node("s1", "generate-script", { prompt: "p", targetLength: 30, targetDuration: 90 }), JOB_ID, {})
    expect(payload.targetDuration).toBe(30)
  })
})

describe("generate-script payload — mapped sources reach the worker", () => {
  it("applies a Tone node and a Scene Count node mapped into the panel's fields", () => {
    const tone: SimpleNode = { id: "tone1", type: "tone", data: { label: "Tone", tone: "wry and warm" } }
    const count: SimpleNode = { id: "count1", type: "scene-count", data: { label: "Scenes", count: 6 } }
    const data = {
      label: "Script",
      prompt: "a lighthouse keeper",
      tone: "typed tone",
      sceneCount: 3,
      fieldMappings: { tone: { sourceNodeId: "tone1" }, sceneCount: { sourceNodeId: "count1" } },
    }
    // What node-executor does before buildPayload, with the registry's field list.
    const resolved = resolveFieldMappings(data, {}, [tone, count], undefined, NODE_MAPPABLE_FIELDS["generate-script"])
    const { payload } = buildPayload({ id: "s1", type: "generate-script", data: resolved }, JOB_ID, {})
    expect(payload.tone).toBe("wry and warm")
    expect(payload.sceneCount).toBe(6)
  })
})
