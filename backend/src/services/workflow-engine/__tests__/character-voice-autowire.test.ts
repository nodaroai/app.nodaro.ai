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
const CREATURE_VOICE = { voiceId: "vid_creature", voiceName: "Growler", traits: "", voiceType: "premade" as const, ttsProvider: "elevenlabs-multilingual" }

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

describe("creature voice auto-wire", () => {
  it("injects creature.voice into a connected text-to-speech node (talking creature, migration 220)", () => {
    const creature = node("cr1", "creature", { voice: CREATURE_VOICE })
    const tts = node("t1", "text-to-speech")
    const inputs = resolveNodeInputs(tts, [edge("cr1", "t1")], {}, [creature, tts])
    expect(inputs.voice).toBe("vid_creature")
    expect(inputs.voiceType).toBe("premade")
    expect(inputs.provider).toBe("elevenlabs-multilingual")
  })

  it("does NOT clobber a voice already resolved from another edge (override-safe)", () => {
    // A character upstream resolves first (edge order), then a creature edge —
    // the creature must NOT overwrite the already-set voice.
    const character = node("c1", "character", { voice: VOICE })
    const creature = node("cr1", "creature", { voice: CREATURE_VOICE })
    const tts = node("t1", "text-to-speech")
    const inputs = resolveNodeInputs(
      tts,
      [edge("c1", "t1"), edge("cr1", "t1")],
      {},
      [character, creature, tts],
    )
    // First incoming edge (character) wins; creature's voice is skipped.
    expect(inputs.voice).toBe("vid_123")
    expect(inputs.provider).toBe("elevenlabs-turbo")
  })

  it("a creature WITHOUT a voice injects nothing (no voiceId → skipped)", () => {
    const creature = node("cr1", "creature", {})
    const tts = node("t1", "text-to-speech")
    const inputs = resolveNodeInputs(tts, [edge("cr1", "t1")], {}, [creature, tts])
    expect(inputs.voice).toBeUndefined()
  })

  it("does NOT inject a creature voice field into a lip-sync node, and keeps imageUrl routing", () => {
    const creature = node("cr1", "creature", { voice: CREATURE_VOICE })
    const lip = node("l1", "lip-sync")
    const states: Record<string, NodeExecutionState> = {
      cr1: { status: "completed", output: { imageUrl: "http://x/creature.png" } },
    }
    const inputs = resolveNodeInputs(lip, [edge("cr1", "l1")], states, [creature, lip])
    expect(inputs.voice).toBeUndefined()
    expect(inputs.imageUrl).toBe("http://x/creature.png")
  })
})
