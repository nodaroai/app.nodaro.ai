/**
 * The app runner's live estimate asks for a speech node's unit row beside the
 * flat ids: until the row is cached, getModelIdentifier quotes the flat row, so
 * without this the runner could never learn that the server prices speech by
 * length. A row the server has reported priced nowhere is not asked again.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/components/editor/config-panels/helpers", () => ({
  getModelIdentifier: (n: { type?: string }) => n.type ?? "",
}))

import { computeLiveRunEstimate } from "../use-live-run-estimate"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const e = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle }) as WorkflowEdge

const tts = n("t", "text-to-speech", { provider: "elevenlabs-v3", textSource: "direct", directText: "a".repeat(1000) })
const connected = n("c", "text-to-speech", { textSource: "connected" })
const text = n("s", "text-prompt", { text: "a".repeat(12_000) })
const dialogue = n("d", "text-to-dialogue", { dialogue: [{ text: "hi", voice: "R" }] })

describe("computeLiveRunEstimate — the speech unit rows", () => {
  it("asks for each speech node's unit row (on the model its estimate runs as) beside the flat ids", () => {
    const out = computeLiveRunEstimate({ nodes: [tts, connected, text, dialogue], edges: [e("s", "c", "prompt")] }, () => undefined)
    // (The Text node is not executable, so it is not priced.)
    expect(out.uncachedModelIds.sort()).toEqual(
      [
        "elevenlabs-dialogue:per-100-chars",
        // the omitted-model node reads its upstream literal's 12,000 characters: turbo
        "elevenlabs-turbo:per-100-chars",
        "elevenlabs-v3:per-100-chars",
        "text-to-dialogue",
        "text-to-speech",
      ].sort(),
    )
  })

  it("an id the server has reported priced nowhere is not asked again", () => {
    const out = computeLiveRunEstimate({ nodes: [tts], edges: [] }, () => undefined, (id) => id.endsWith(":per-100-chars"))
    expect(out.uncachedModelIds).toEqual(["text-to-speech"])
  })

  it("a cached unit row is not asked for", () => {
    const out = computeLiveRunEstimate({ nodes: [tts], edges: [] }, (id) => (id === "elevenlabs-v3:per-100-chars" ? 4 : undefined))
    expect(out.uncachedModelIds).toEqual(["text-to-speech"])
  })
})
