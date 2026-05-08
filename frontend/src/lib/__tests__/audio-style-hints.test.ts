import { describe, it, expect } from "vitest"
import { collectAudioStyleHints } from "../audio-style-hints"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const consumer = (data: Record<string, unknown> = {}): WorkflowNode => ({
  id: "consumer", type: "suno-generate", position: { x: 0, y: 0 },
  data: { label: "Suno", ...data },
} as unknown as WorkflowNode)

describe("collectAudioStyleHints", () => {
  it("returns empty composition with no audio-style edges", () => {
    const out = collectAudioStyleHints(consumer(), "suno-generate", [], [])
    expect(out.text).toBe("")
  })

  it("walks audio-style edges and composes hints", () => {
    const cons = consumer({ customMode: true })
    const src = { id: "src", type: "music-genre", position: { x: 0, y: 0 }, data: { label: "G", genre: "electronic" } } as unknown as WorkflowNode
    const edge = { id: "e", source: "src", target: "consumer", sourceHandle: "out", targetHandle: "audio-style" } as unknown as WorkflowEdge
    const out = collectAudioStyleHints(cons, "suno-generate", [cons, src], [edge])
    expect(out.text).toContain("electronic")
  })
})
