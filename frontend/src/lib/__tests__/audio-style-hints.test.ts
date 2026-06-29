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

  // Regression: a voice-character picker dropped onto suno-generate's "Voice"
  // pip must fold in too — the short-circuit used to gate on `audio-style` alone
  // and returned empty before the aggregator ran, so the picker silently
  // vanished from BOTH the run and the Final preview.
  it("walks voice-pip edges too (voice-character on the Voice handle)", () => {
    const cons = consumer({ customMode: false })
    const src = { id: "vc", type: "voice-character", position: { x: 0, y: 0 }, data: { label: "V", timbre: "warm", gender: "female" } } as unknown as WorkflowNode
    const edge = { id: "e", source: "vc", target: "consumer", sourceHandle: "out", targetHandle: "voice" } as unknown as WorkflowEdge
    const out = collectAudioStyleHints(cons, "suno-generate", [cons, src], [edge])
    expect(out.text).toContain("warm")
    expect(out.fields.vocalGender).toBe("female")
  })
})
