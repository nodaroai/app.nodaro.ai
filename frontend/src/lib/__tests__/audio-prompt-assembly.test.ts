import { describe, it, expect } from "vitest"
import { assembleAudioPrompt } from "../audio-prompt-assembly"
import { collectAudioStyleHints } from "../audio-style-hints"
import { appendField } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/** Build an audio consumer node of a given type. */
const consumer = (type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({
    id: "consumer",
    type,
    position: { x: 0, y: 0 },
    data: { label: type, ...data },
  } as unknown as WorkflowNode)

/** A music-genre audio-style source that produces non-empty hint text. */
const genreSrc = (genre = "electronic"): WorkflowNode =>
  ({
    id: "genre",
    type: "music-genre",
    position: { x: 0, y: 0 },
    data: { label: "Genre", genre },
  } as unknown as WorkflowNode)

/** An audio-style edge from `genre` → `consumer`. */
const audioStyleEdge: WorkflowEdge = {
  id: "e",
  source: "genre",
  target: "consumer",
  sourceHandle: "out",
  targetHandle: "audio-style",
} as unknown as WorkflowEdge

const NO_REFS = new Map<string, string>()

describe("assembleAudioPrompt", () => {
  it("(a) generate-music with a connected genre node folds the style text after the typed prompt", () => {
    const node = consumer("generate-music", { prompt: "an upbeat track" })
    const nodes = [node, genreSrc()]
    const edges = [audioStyleEdge]

    // The style text the run would fold (computed with the SAME helper so the
    // test stays resilient to catalog string changes).
    const styleText = collectAudioStyleHints(node, "generate-music", nodes, edges).text
    expect(styleText).not.toBe("")

    const out = assembleAudioPrompt("generate-music", { node, nodes, edges, refMap: NO_REFS })
    // Typed prompt is preserved AND the folded style text is appended.
    expect(out).toContain("an upbeat track")
    expect(out).toContain(styleText)
    expect(out).toBe(appendField("an upbeat track", styleText))
  })

  it("(b) generate-music with NO typed prompt but a style node returns the style text alone", () => {
    const node = consumer("generate-music", { prompt: "" })
    const nodes = [node, genreSrc()]
    const edges = [audioStyleEdge]

    const styleText = collectAudioStyleHints(node, "generate-music", nodes, edges).text
    expect(styleText).not.toBe("")

    const out = assembleAudioPrompt("generate-music", { node, nodes, edges, refMap: NO_REFS })
    expect(out).toBe(styleText)
  })

  it("(c) suno-generate in custom mode returns the bare typed prompt — style is NOT folded into the prompt field", () => {
    // customMode true → style hints fold into STYLE, not the prompt.
    const node = consumer("suno-generate", { prompt: "a dreamy melody", customMode: true })
    const nodes = [node, genreSrc()]
    const edges = [audioStyleEdge]

    const styleText = collectAudioStyleHints(node, "suno-generate", nodes, edges).text
    expect(styleText).not.toBe("")

    const out = assembleAudioPrompt("suno-generate", { node, nodes, edges, refMap: NO_REFS })
    expect(out).toBe("a dreamy melody")
    expect(out).not.toContain(styleText)
  })

  it("(c2) suno-generate in NON-custom mode folds the style text into the prompt", () => {
    const node = consumer("suno-generate", { prompt: "a dreamy melody", customMode: false })
    const nodes = [node, genreSrc()]
    const edges = [audioStyleEdge]

    const styleText = collectAudioStyleHints(node, "suno-generate", nodes, edges).text
    const out = assembleAudioPrompt("suno-generate", { node, nodes, edges, refMap: NO_REFS })
    expect(out).toBe(appendField("a dreamy melody", styleText))
    expect(out).toContain(styleText)
  })

  it("(d) voice-design folds the style text after the voiceDescription", () => {
    const node = consumer("voice-design", { voiceDescription: "warm and calm" })
    // voice-design accepts voice nodes; use a voice-character source for a valid hint.
    const voiceSrc = {
      id: "genre",
      type: "voice-character",
      position: { x: 0, y: 0 },
      data: { label: "Voice", gender: "female", age: "young-adult" },
    } as unknown as WorkflowNode
    const nodes = [node, voiceSrc]
    const edges = [audioStyleEdge]

    const styleText = collectAudioStyleHints(node, "voice-design", nodes, edges).text
    expect(styleText).not.toBe("")

    const out = assembleAudioPrompt("voice-design", { node, nodes, edges, refMap: NO_REFS })
    expect(out).toContain("warm and calm")
    expect(out).toContain(styleText)
    expect(out).toBe(appendField("warm and calm", styleText))
  })

  it("(e) a pass-through type (suno-cover) returns the bare resolved prompt — no style folding", () => {
    // Even with a connected audio-style node, pass-through types never fold.
    const node = consumer("suno-cover", { prompt: "make it jazzy" })
    const nodes = [node, genreSrc()]
    const edges = [audioStyleEdge]

    const out = assembleAudioPrompt("suno-cover", { node, nodes, edges, refMap: NO_REFS })
    expect(out).toBe("make it jazzy")
  })

  it("(e2) suno-style-boost reads its `content` field, not `prompt`", () => {
    const node = consumer("suno-style-boost", { content: "lofi chill", prompt: "WRONG" })
    const out = assembleAudioPrompt("suno-style-boost", { node, nodes: [node], edges: [], refMap: NO_REFS })
    expect(out).toBe("lofi chill")
  })

  it("(e3) text-to-speech returns directText only when textSource is 'direct'", () => {
    const direct = consumer("text-to-speech", { textSource: "direct", directText: "Hello world" })
    expect(assembleAudioPrompt("text-to-speech", { node: direct, nodes: [direct], edges: [], refMap: NO_REFS })).toBe("Hello world")

    const wired = consumer("text-to-speech", { textSource: "input", directText: "ignored" })
    expect(assembleAudioPrompt("text-to-speech", { node: wired, nodes: [wired], edges: [], refMap: NO_REFS })).toBe("")
  })

  it("resolves {Var} refs in the typed prompt via refMap", () => {
    const node = consumer("generate-music", { prompt: "a song about {Topic}" })
    const refMap = new Map<string, string>([["Topic", "the ocean"]])
    const out = assembleAudioPrompt("generate-music", { node, nodes: [node], edges: [], refMap })
    expect(out).toBe("a song about the ocean")
  })
})
