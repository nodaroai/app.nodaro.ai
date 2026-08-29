import { describe, it, expect } from "vitest"
import {
  assembleAudioPrompt,
  assembleSunoPreview,
  formatSunoPreviewText,
  sunoPreviewFields,
} from "../audio-prompt-assembly"
import { collectAudioStyleHints } from "../audio-style-hints"
import { appendField } from "@nodaro/prompts"
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

  it("(c) suno-generate in custom mode now SHOWS the folded style field (Task 3 — was bare prompt)", () => {
    // customMode true → style hints fold into STYLE. The preview now renders the
    // full assembled result, so the prompt body AND the folded style are visible
    // (previously the style field was invisible — complaint 1).
    const node = consumer("suno-generate", { prompt: "a dreamy melody", customMode: true })
    const nodes = [node, genreSrc()]
    const edges = [audioStyleEdge]

    const styleText = collectAudioStyleHints(node, "suno-generate", nodes, edges).text
    expect(styleText).not.toBe("")

    const out = assembleAudioPrompt("suno-generate", { node, nodes, edges, refMap: NO_REFS })
    expect(out).toContain("a dreamy melody")
    expect(out).toContain("Style:")
    expect(out).toContain(styleText)
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

  it("(e3) text-to-speech prefers directText, and falls back to it when nothing is wired", () => {
    // CONTRACT CHANGED 2026-08-14. This used to assert that a non-"direct"
    // textSource returns "" even with text present. That is what shipped, and
    // it produced: text visible in the node, run fails with "no text found"
    // (founder hit it live). textSource defaults to "connected" on every new
    // node, so any writer that saved text without flipping it — and every
    // import / MCP write / template — landed in that state.
    //
    // The gate is now a PREFERENCE: "connected" still wins when something IS
    // wired (asserted below and in prompt-gate.test.ts), but with nothing
    // connected the typed text is used rather than discarded.
    const direct = consumer("text-to-speech", { textSource: "direct", directText: "Hello world" })
    expect(assembleAudioPrompt("text-to-speech", { node: direct, nodes: [direct], edges: [], refMap: NO_REFS })).toBe("Hello world")

    const notWired = consumer("text-to-speech", { textSource: "connected", directText: "typed earlier" })
    expect(assembleAudioPrompt("text-to-speech", { node: notWired, nodes: [notWired], edges: [], refMap: NO_REFS })).toBe("typed earlier")
  })

  it("resolves {Var} refs in the typed prompt via refMap", () => {
    const node = consumer("generate-music", { prompt: "a song about {Topic}" })
    const refMap = new Map<string, string>([["Topic", "the ocean"]])
    const out = assembleAudioPrompt("generate-music", { node, nodes: [node], edges: [], refMap })
    expect(out).toBe("a song about the ocean")
  })
})

// ── Task 3: the suno preview is a pass-through of the shared assembleSunoInput,
// exposing the FULL field set (prompt + style + lyrics + title + negativeStyle)
// so the Final preview shows every field (fixes complaints 1 + 4). ──
describe("assembleSunoPreview / sunoPreviewFields / formatSunoPreviewText", () => {
  it("(suno-1) complaint 1: typed style + lyrics + title, EMPTY prompt → result carries every field", () => {
    const node = consumer("suno-generate", { prompt: "", style: "lo-fi", lyrics: "[verse] hi", title: "My Song" })
    const result = assembleSunoPreview({ node, nodes: [node], edges: [], refMap: NO_REFS })
    // customMode auto-engages because style/title/lyrics are set.
    expect(result.customMode).toBe(true)
    expect(result.style).toBe("lo-fi")
    expect(result.lyrics).toBe("[verse] hi")
    expect(result.title).toBe("My Song")

    const fields = sunoPreviewFields(result)
    const keys = fields.map((f) => f.key)
    expect(keys).toContain("style")
    expect(keys).toContain("lyrics")
    expect(keys).toContain("title")

    const text = formatSunoPreviewText(result)
    expect(text).toContain("lo-fi")
    expect(text).toContain("[verse] hi")
    expect(text).toContain("My Song")
  })

  it("(suno-2) complaint 4: a connected picker with EMPTY typed fields → non-empty (folded hint)", () => {
    const node = consumer("suno-generate", { prompt: "", style: "", title: "", lyrics: "" })
    const nodes = [node, genreSrc()]
    const edges = [audioStyleEdge]
    const hint = collectAudioStyleHints(node, "suno-generate", nodes, edges).text
    expect(hint).not.toBe("")

    const result = assembleSunoPreview({ node, nodes, edges, refMap: NO_REFS })
    // Non-custom (no typed style/title/lyrics) → the picker folds into the prompt.
    expect(result.customMode).toBe(false)
    expect(result.prompt).toBe(hint)

    const text = formatSunoPreviewText(result)
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain(hint)
  })

  it("(suno-3) negativeStyle is surfaced as a labeled field", () => {
    const node = consumer("suno-generate", { prompt: "a song", negativeStyle: "heavy metal, screaming" })
    const result = assembleSunoPreview({ node, nodes: [node], edges: [], refMap: NO_REFS })
    expect(result.negativeStyle).toBe("heavy metal, screaming")
    const text = formatSunoPreviewText(result)
    expect(text).toContain("a song")
    expect(text).toContain("heavy metal, screaming")
  })

  it("(suno-4) empty fields are omitted (no stray labels) and order is prompt → style → lyrics → title → negative", () => {
    const node = consumer("suno-generate", { prompt: "just a prompt" })
    const result = assembleSunoPreview({ node, nodes: [node], edges: [], refMap: NO_REFS })
    expect(sunoPreviewFields(result).map((f) => f.key)).toEqual(["prompt"])
    expect(formatSunoPreviewText(result)).toBe("just a prompt")
  })

  it("(suno-5) resolves {Var} refs in the typed prompt + lyrics via refMap", () => {
    const node = consumer("suno-generate", { prompt: "a song about {Topic}", lyrics: "[verse] {Topic}" })
    const refMap = new Map<string, string>([["Topic", "the ocean"]])
    const result = assembleSunoPreview({ node, nodes: [node], edges: [], refMap })
    expect(result.prompt).toContain("a song about the ocean")
    expect(result.lyrics).toBe("[verse] the ocean")
  })
})

/**
 * Prompt affixes (pre/post text) for the FOUR audio types that BYPASS
 * `computeNodePrompt`. The spec's §5.3 assumed the whole audio preview path was
 * "Category A, free" — true only for the types that route through
 * `computeNodePrompt` (which applies the affixes itself: generate-music,
 * text-to-audio, and every pass-through default case). These four read their
 * core field directly, so the preview would drop the affixes the RUN sends:
 *   - voice-design / voice-remix → `(applyPromptAffixes(d.voiceDescription, …) ?? "").trim()`
 *   - suno-style-boost          → `applyPromptAffixes(inputs.prompt ?? d.content?.trim(), …)`
 *   - suno-generate             → `applyPromptAffixes(… d.prompt?.trim() …, …)` fed to `assembleSunoInput`
 * (run expressions: `execute-node.ts` ~3220 / ~3258 / ~4038 / ~3681).
 *
 * Each type gets both halves of the contract: affixes present ⇒ "PRE CORE POST"
 * appears EXACTLY once; affixes absent ⇒ byte-identical to the pre-change output
 * (the no-op guarantee of `applyPromptAffixes`).
 */
describe("assembleAudioPrompt — prompt affixes on the four computeNodePrompt-bypassing types", () => {
  const AFFIXES = { promptPrefix: "PRE", promptSuffix: "POST" } as const
  /** Occurrences of `needle` in `hay` — the affix must wrap the core ONCE. */
  const countOf = (hay: string, needle: string) => hay.split(needle).length - 1

  const solo = (type: string, data: Record<string, unknown>) => {
    const node = consumer(type, data)
    return assembleAudioPrompt(type, { node, nodes: [node], edges: [], refMap: NO_REFS })
  }

  it("(f) voice-design wraps voiceDescription with the pre/post text exactly once", () => {
    const out = solo("voice-design", { voiceDescription: "CORE", ...AFFIXES })
    expect(countOf(out, "PRE CORE POST")).toBe(1)
  })

  it("(f2) voice-design with NO affixes is byte-identical to the pre-change output", () => {
    expect(solo("voice-design", { voiceDescription: "CORE" })).toBe("CORE")
  })

  it("(g) voice-remix wraps voiceDescription with the pre/post text exactly once", () => {
    const out = solo("voice-remix", { voiceDescription: "CORE", ...AFFIXES })
    expect(countOf(out, "PRE CORE POST")).toBe(1)
  })

  it("(g2) voice-remix with NO affixes is byte-identical to the pre-change output", () => {
    expect(solo("voice-remix", { voiceDescription: "CORE" })).toBe("CORE")
  })

  it("(h) suno-style-boost wraps its `content` field with the pre/post text exactly once", () => {
    const out = solo("suno-style-boost", { content: "CORE", ...AFFIXES })
    expect(countOf(out, "PRE CORE POST")).toBe(1)
  })

  it("(h2) suno-style-boost with NO affixes is byte-identical to the pre-change output", () => {
    expect(solo("suno-style-boost", { content: "CORE" })).toBe("CORE")
  })

  it("(i) suno-generate wraps the typed prompt with the pre/post text exactly once", () => {
    const out = solo("suno-generate", { prompt: "CORE", ...AFFIXES })
    expect(countOf(out, "PRE CORE POST")).toBe(1)
  })

  it("(i2) suno-generate with NO affixes is byte-identical to the pre-change output", () => {
    expect(solo("suno-generate", { prompt: "CORE" })).toBe("CORE")
  })

  it("(i3) suno-generate's affixed prompt reaches the assembled RESULT field (what the run sends)", () => {
    const node = consumer("suno-generate", { prompt: "CORE", ...AFFIXES })
    const result = assembleSunoPreview({ node, nodes: [node], edges: [], refMap: NO_REFS })
    expect(countOf(result.prompt, "PRE CORE POST")).toBe(1)
  })
})
