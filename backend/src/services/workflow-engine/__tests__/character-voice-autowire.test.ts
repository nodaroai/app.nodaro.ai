import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}
function edge(source: string, target: string): SimpleEdge {
  return { id: `${source}-${target}`, source, target }
}
const VOICE = { voiceId: "vid_123", voiceName: "Rachel", traits: "", voiceType: "premade" as const, ttsProvider: "elevenlabs-turbo" }

describe("character voice auto-wire", () => {
  it("injects character.voice into a connected text-to-speech node (no portrait needed)", () => {
    const character = node("c1", "character", { voice: VOICE })
    const tts = node("t1", "text-to-speech")
    const inputs = resolveNodeInputs(tts, [edge("c1", "t1")], {}, [character, tts])
    expect(inputs.voice).toBe("vid_123")
    expect(inputs.voiceType).toBe("premade")
    expect(inputs.provider).toBe("elevenlabs-turbo")
  })

  it("does NOT inject a voice field into a lip-sync node, and keeps imageUrl routing", () => {
    const character = node("c1", "character", { voice: VOICE })
    const lip = node("l1", "lip-sync")
    // Seed a completed portrait so the existing entity→imageUrl routing resolves.
    // NodeExecutionState stores the node result under `output` (a NodeOutput), not
    // `output_data` (that's the DB jobs-row column) — see getNodeOutput / the
    // existing "routes entity to imageUrl for lip-sync target" test.
    const states: Record<string, NodeExecutionState> = {
      c1: { status: "completed", output: { imageUrl: "http://x/p.png" } },
    }
    const inputs = resolveNodeInputs(lip, [edge("c1", "l1")], states, [character, lip])
    expect(inputs.voice).toBeUndefined()
    expect(inputs.imageUrl).toBe("http://x/p.png")
  })
})
