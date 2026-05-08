import { describe, it, expect } from "vitest"
import {
  composeSoundHintFromConnections,
  type SoundComposition,
} from "../sound-aggregator.js"
import type { HintGraphContext, HintNodeLike, HintEdgeLike } from "../parameter-prompt-hint.js"

function ctx(nodes: HintNodeLike[], edges: HintEdgeLike[]): HintGraphContext {
  return { nodes, edges }
}

const sunoConsumer = (data: Record<string, unknown> = {}): HintNodeLike => ({
  id: "consumer", type: "suno-generate", data,
})

function audioStyleEdge(sourceId: string): HintEdgeLike {
  return { source: sourceId, target: "consumer", sourceHandle: "out", targetHandle: "audio-style" }
}

describe("composeSoundHintFromConnections — empty cases", () => {
  it("returns empty composition with no edges", () => {
    const out = composeSoundHintFromConnections(sunoConsumer(), "suno-generate", ctx([], []))
    expect(out.text).toBe("")
    expect(out.fields).toEqual({})
    expect(out.warnings).toEqual([])
  })

  it("ignores edges that don't target audio-style", () => {
    const out = composeSoundHintFromConnections(
      sunoConsumer(),
      "suno-generate",
      ctx(
        [{ id: "src", type: "music-genre", data: { genre: "electronic" } }],
        [{ source: "src", target: "consumer", targetHandle: "in" }],
      ),
    )
    expect(out.text).toBe("")
  })
})

describe("composeSoundHintFromConnections — Suno Generate", () => {
  it("composes music nodes into text", () => {
    const out = composeSoundHintFromConnections(
      sunoConsumer({ customMode: true }),
      "suno-generate",
      ctx(
        [
          { id: "g", type: "music-genre", data: { genre: "electronic", subgenre: "synthwave" } },
          { id: "m", type: "music-mood", data: { energy: "high", emotion: "triumphant" } },
        ],
        [audioStyleEdge("g"), audioStyleEdge("m")],
      ),
    )
    expect(out.text).toContain("synthwave")
    expect(out.text).toContain("triumphant")
    expect(out.warnings).toEqual([])
  })

  it("warns on voice nodes (Suno is music-only)", () => {
    const out = composeSoundHintFromConnections(
      sunoConsumer({ customMode: true }),
      "suno-generate",
      ctx(
        [{ id: "v", type: "voice-character", data: { timbre: "warm" } }],
        [audioStyleEdge("v")],
      ),
    )
    expect(out.text).toBe("")
    expect(out.warnings.length).toBeGreaterThan(0)
    expect(out.warnings[0].toLowerCase()).toContain("voice")
  })
})

describe("composeSoundHintFromConnections — Generate Music (MiniMax)", () => {
  const minimaxConsumer = (data: Record<string, unknown> = { provider: "minimax" }): HintNodeLike => ({
    id: "consumer", type: "generate-music", data,
  })

  it("populates typed fields when provider=minimax", () => {
    const out = composeSoundHintFromConnections(
      minimaxConsumer(),
      "generate-music",
      ctx(
        [
          { id: "g", type: "music-genre", data: { genre: "electronic" } },
          { id: "m", type: "music-mood", data: { emotion: "triumphant" } },
          { id: "i", type: "instrumentation", data: { vocalPresence: "instrumental" } },
        ],
        [audioStyleEdge("g"), audioStyleEdge("m"), audioStyleEdge("i")],
      ),
    )
    expect(out.fields?.genre).toBeTruthy()
    expect(out.fields?.mood).toBeTruthy()
    expect(out.fields?.instrumental).toBe(true)
  })

  it("falls back to prompt-only for non-minimax providers", () => {
    const out = composeSoundHintFromConnections(
      { id: "consumer", type: "generate-music", data: { provider: "musicgen" } },
      "generate-music",
      ctx(
        [{ id: "g", type: "music-genre", data: { genre: "electronic" } }],
        [audioStyleEdge("g")],
      ),
    )
    expect(out.fields?.genre).toBeUndefined()
    expect(out.text).toContain("electronic")
  })
})

describe("composeSoundHintFromConnections — Voice Design", () => {
  const voiceConsumer: HintNodeLike = { id: "consumer", type: "voice-design", data: {} }

  it("composes voice nodes into voiceDescription", () => {
    const out = composeSoundHintFromConnections(
      voiceConsumer,
      "voice-design",
      ctx(
        [
          { id: "vc", type: "voice-character", data: { age: "middle-aged", gender: "male", timbre: "warm" } },
          { id: "vd", type: "voice-delivery", data: { archetype: "documentary-narrator", emotion: "reassuring" } },
        ],
        [audioStyleEdge("vc"), audioStyleEdge("vd")],
      ),
    )
    expect(out.text).toContain("warm")
    expect(out.text).toContain("documentary narrator")
    expect(out.fields?.voiceDescription).toBe(out.text)
  })

  it("warns on music nodes", () => {
    const out = composeSoundHintFromConnections(
      voiceConsumer,
      "voice-design",
      ctx(
        [{ id: "g", type: "music-genre", data: { genre: "electronic" } }],
        [audioStyleEdge("g")],
      ),
    )
    expect(out.warnings.length).toBeGreaterThan(0)
  })
})

describe("composeSoundHintFromConnections — Text to Audio", () => {
  it("accepts music nodes, warns on voice nodes", () => {
    const out = composeSoundHintFromConnections(
      { id: "consumer", type: "text-to-audio", data: {} },
      "text-to-audio",
      ctx(
        [
          { id: "g", type: "music-genre", data: { genre: "electronic" } },
          { id: "v", type: "voice-character", data: { timbre: "warm" } },
        ],
        [audioStyleEdge("g"), audioStyleEdge("v")],
      ),
    )
    expect(out.text).toContain("electronic")
    expect(out.warnings.length).toBeGreaterThan(0)
  })
})
