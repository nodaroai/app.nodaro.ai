/**
 * A published app's exposed TEXT inputs, "<nodeId>:<field>" → the input's
 * character limit, or null when it has none — the map the workflow estimate
 * prices an exposed speech text with (lib/speech-estimate.ts). Built from the
 * one input classifier (`extractAppInputSchema`), so a Text node exposed whole
 * (the common published-app shape) and a Text to Speech node's exposed
 * `directText` both reach the estimator's one-hop rule. An absent key means
 * "not exposed"; the null half is what keeps every existing app (no limit yet)
 * from being priced on its author's placeholder text.
 */
import { describe, it, expect } from "vitest"
import { exposedTextCaps } from "../exposed-text-caps.js"
import { extractAppInputSchema } from "../mcp/extract-app-inputs.js"

const nodes = [
  { id: "s", type: "text-prompt", data: { label: "Script", text: "a".repeat(500) } },
  { id: "t", type: "text-to-speech", data: { label: "Voice", textSource: "direct", directText: "hello" } },
  { id: "i", type: "generate-image", data: { label: "Image", aspectRatio: "1:1" } },
]

describe("exposedTextCaps", () => {
  it("a Text node exposed whole → null; a field with a limit → the limit; a select is not a text input", () => {
    const settings = {
      presentationSettings: {
        inputItems: [
          { type: "node", nodeId: "s" },
          { type: "field", id: "f1", nodeId: "t", field: "directText", maxLength: 1200 },
          { type: "field", id: "f2", nodeId: "i", field: "aspectRatio", allowedValues: ["1:1", "16:9"] },
        ],
      },
    }
    expect(exposedTextCaps(settings, nodes)).toEqual({ "s:text": null, "t:directText": 1200 })
  })

  it("an exposed text field with no limit is null — exposed, unbounded", () => {
    const settings = { presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "t", field: "directText" }] } }
    expect(exposedTextCaps(settings, nodes)).toEqual({ "t:directText": null })
  })

  it("items inside a group count; no presentation at all → the implicit source inputs, unbounded", () => {
    const grouped = {
      presentationSettings: {
        inputItems: [{ type: "group", id: "g", title: "Inputs", items: [{ type: "field", id: "f1", nodeId: "t", field: "directText", maxLength: 300 }] }],
      },
    }
    expect(exposedTextCaps(grouped, nodes)).toEqual({ "t:directText": 300 })
    // The extractor's deepest fallback: every source node is an implicit input.
    expect(exposedTextCaps(null, nodes)).toEqual({ "s:text": null })
  })

  it("a Text node exposed whole may carry the limit itself — the published-app shape the speech estimate reads through the one-hop rule", () => {
    const settings = { presentationSettings: { inputItems: [{ type: "node", nodeId: "s", maxLength: 800 }] } }
    expect(exposedTextCaps(settings, nodes)).toEqual({ "s:text": 800 })
    const schema = extractAppInputSchema({ snapshotSettings: settings, snapshotNodes: nodes })
    expect(schema.fields[0]).toMatchObject({ type: "text", maxLength: 800 })
    // not a limit: zero, a fraction, or a negative number
    for (const bad of [0, 1.5, -3]) {
      const s = { presentationSettings: { inputItems: [{ type: "node", nodeId: "s", maxLength: bad }] } }
      expect(exposedTextCaps(s, nodes)).toEqual({ "s:text": null })
    }
    // a node that is not a text input takes no limit
    const image = { presentationSettings: { inputItems: [{ type: "node", nodeId: "u", maxLength: 50 }] } }
    const upload = [{ id: "u", type: "upload-image", data: {} }]
    expect("maxLength" in extractAppInputSchema({ snapshotSettings: image, snapshotNodes: upload }).fields[0]!).toBe(false)
  })

  it("the extractor carries a text field's limit so get_app_inputs serves it", () => {
    const schema = extractAppInputSchema({
      snapshotSettings: { presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "t", field: "directText", maxLength: 1200 }] } },
      snapshotNodes: nodes,
    })
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0]).toMatchObject({ type: "text", maxLength: 1200 })
    // A non-positive or non-integer limit is not a limit.
    const bad = extractAppInputSchema({
      snapshotSettings: { presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "t", field: "directText", maxLength: 0 }] } },
      snapshotNodes: nodes,
    })
    expect("maxLength" in bad.fields[0]!).toBe(false)
  })

  describe("an LLM node's exposed output budget (a generated voice's script is bounded by it)", () => {
    const llmNodes = [
      { id: "l", type: "llm-chat", data: { label: "Writer", maxTokens: 200, llmModel: "claude-sonnet-4.6" } },
      { id: "w", type: "ai-writer", data: { label: "Writer 2" } },
      { id: "i", type: "generate-image", data: { label: "Image", maxTokens: 5 } },
    ]
    const exposing = (...items: Array<Record<string, unknown>>) => ({ presentationSettings: { inputItems: items } })

    it("a maxTokens slider is keyed with its largest value; model, effort and advanced mode are keyed null", () => {
      const settings = exposing(
        { type: "field", id: "a", nodeId: "l", field: "maxTokens" },
        { type: "field", id: "b", nodeId: "l", field: "llmModel", allowedValues: ["claude-sonnet-4.6", "claude-opus-5"] },
        { type: "field", id: "c", nodeId: "w", field: "reasoningEffort", allowedValues: ["low", "max"] },
      )
      expect(exposedTextCaps(settings, llmNodes)).toEqual({ "l:maxTokens": 16384, "l:llmModel": null, "w:reasoningEffort": null })
    })

    it("any other LLM field is not keyed", () => {
      const settings = exposing({ type: "field", id: "b", nodeId: "l", field: "temperature" })
      expect(exposedTextCaps(settings, llmNodes)).toEqual({})
    })
  })
})

describe("exposedVideoLinkNodeIds", () => {
  const nodes = [
    { id: "ep", type: "youtube-video", data: {} },
    { id: "ref", type: "youtube-video", data: {} },
    { id: "up", type: "upload-video", data: {} },
  ]
  const settings = (ids: string[]) => ({ presentationSettings: { inputItems: ids.map((nodeId) => ({ type: "node", nodeId })) } })

  it("is the Video URL nodes the app lists as inputs, and no other node", async () => {
    const { exposedVideoLinkNodeIds } = await import("../exposed-text-caps.js")
    expect([...exposedVideoLinkNodeIds(settings(["ep", "up"]), nodes)]).toEqual(["ep"])
  })
  it("an app that exposes none of them has none", async () => {
    const { exposedVideoLinkNodeIds } = await import("../exposed-text-caps.js")
    expect(exposedVideoLinkNodeIds(settings(["up"]), nodes).size).toBe(0)
    expect(exposedVideoLinkNodeIds(null, null).size).toBe(0)
  })
})
