import { describe, it, expect } from "vitest"
import { assembleSunoInput } from "../assemble-suno-input.js"
import { composeSoundHintFromConnections, appendField, truncateForField } from "../index.js"
import type { HintNodeLike, HintEdgeLike } from "../parameter-prompt-hint.js"

/**
 * `assembleSunoInput` is the keystone of the Suno preview==run refactor: the
 * FE run (`execute-node.ts`), the BE run (`payload-builder.ts`), and the editor
 * Final preview all route their `suno-generate` assembly through it. The FE
 * inline block (`execute-node.ts` ~3016–3076) is the designated source of
 * truth; these tests pin that the shared fn reproduces it field-by-field and
 * reconciles the 5 FE↔BE divergences toward the FE.
 *
 * The hint TEXT itself is computed by `composeSoundHintFromConnections` (tested
 * in `sound-aggregator.test.ts`); here we use it (plus `appendField` /
 * `truncateForField`) as ORACLES — the risk these tests guard is the FOLD
 * WIRING (which branch, which budget, skip-when-empty, the normalizations), not
 * the helper internals. Mirrors how `assemble-image-input.test.ts` uses
 * `buildImagePrompt` / `getFramingPromptHint` as oracles.
 */

const CONSUMER_ID = "s1"

const node = (data: Record<string, unknown>): HintNodeLike => ({
  id: CONSUMER_ID,
  type: "suno-generate",
  data,
})

const emptyGraph: { nodes: HintNodeLike[]; edges: HintEdgeLike[] } = {
  nodes: [],
  edges: [],
}

function audioStyleEdge(sourceId: string): HintEdgeLike {
  return { source: sourceId, target: CONSUMER_ID, sourceHandle: "out", targetHandle: "audio-style" }
}

/** A connected music-genre picker → a non-empty audio-style hint. */
function graphWithHint(): { nodes: HintNodeLike[]; edges: HintEdgeLike[] } {
  return {
    nodes: [{ id: "g", type: "music-genre", data: { genre: "electronic", subgenre: "synthwave" } }],
    edges: [audioStyleEdge("g")],
  }
}

/** A connected voice-character picker → populates `fields.vocalGender`. */
function graphWithVocalGender(gender: "male" | "female"): { nodes: HintNodeLike[]; edges: HintEdgeLike[] } {
  return {
    nodes: [{ id: "v", type: "voice-character", data: { gender, timbre: "warm" } }],
    edges: [audioStyleEdge("v")],
  }
}

describe("assembleSunoInput — custom mode (style fold @500)", () => {
  it("custom mode: leaves prompt = userPrompt, keeps user style + model", () => {
    const r = assembleSunoInput({
      node: node({ customMode: true, style: "lo-fi", model: "V5" }),
      graph: emptyGraph,
      userPrompt: "ignored-in-custom",
    })
    expect(r.customMode).toBe(true)
    expect(r.style).toBe("lo-fi")
    expect(r.model).toBe("V5")
    // Custom mode folds the hint into `style`; the prompt is the user prompt verbatim.
    expect(r.prompt).toBe("ignored-in-custom")
  })

  it("custom + non-empty style + hint: folds hint into style via appendField(truncateForField(@500))", () => {
    const g = graphWithHint()
    const consumer = node({ customMode: true, style: "lo-fi" })
    const hint = composeSoundHintFromConnections(consumer, "suno-generate", g).text
    expect(hint).not.toBe("") // fixture sanity
    const r = assembleSunoInput({ node: consumer, graph: g, userPrompt: "ignored" })
    expect(r.style).toBe(appendField("lo-fi", truncateForField(hint, "lo-fi", 500)))
    expect(r.prompt).toBe("ignored") // prompt untouched in custom mode
  })

  it("custom + EMPTY style + hint: bare hint, NOT truncated (divergence B — skip-when-empty)", () => {
    const g = graphWithHint()
    const consumer = node({ customMode: true, style: "" })
    const hint = composeSoundHintFromConnections(consumer, "suno-generate", g).text
    const r = assembleSunoInput({ node: consumer, graph: g, userPrompt: "ignored" })
    expect(r.style).toBe(hint) // no appendField / no truncateForField when the user field is empty
  })
})

describe("assembleSunoInput — non-custom mode (prompt fold @3000)", () => {
  it("non-custom + userPrompt + hint: folds hint into prompt via appendField(truncateForField(@3000))", () => {
    const g = graphWithHint()
    const consumer = node({ customMode: false })
    const hint = composeSoundHintFromConnections(consumer, "suno-generate", g).text
    const r = assembleSunoInput({ node: consumer, graph: g, userPrompt: "a happy song" })
    expect(r.prompt).toBe(appendField("a happy song", truncateForField(hint, "a happy song", 3000)))
    expect(r.style).toBeUndefined() // empty user style → undefined
  })

  it("non-custom: empty style/title normalize to undefined; prompt is the bare user text", () => {
    const r = assembleSunoInput({
      node: node({ customMode: false, style: "", title: "" }),
      graph: emptyGraph,
      userPrompt: "a happy song",
    })
    expect(r.prompt).toBe("a happy song")
    expect(r.style).toBeUndefined()
    expect(r.title).toBeUndefined()
  })

  it("non-custom + EMPTY userPrompt + hint: bare hint into prompt, NOT truncated (divergence B)", () => {
    const g = graphWithHint()
    const consumer = node({ customMode: false })
    const hint = composeSoundHintFromConnections(consumer, "suno-generate", g).text
    const r = assembleSunoInput({ node: consumer, graph: g, userPrompt: "" })
    expect(r.prompt).toBe(hint)
  })
})

describe("assembleSunoInput — truncation when the hint exceeds the budget", () => {
  it("custom: a long user style shrinks the budget so the hint is truncated to fit 500", () => {
    const g = graphWithHint()
    const longStyle = "a".repeat(495) // budget = 500 - 495 - 2 = 3
    const consumer = node({ customMode: true, style: longStyle })
    const hint = composeSoundHintFromConnections(consumer, "suno-generate", g).text
    expect(hint.length).toBeGreaterThan(3) // fixture sanity — guarantees truncation actually happens
    const truncated = truncateForField(hint, longStyle, 500)
    expect(truncated.length).toBeLessThan(hint.length) // proves it truncated
    const r = assembleSunoInput({ node: consumer, graph: g, userPrompt: "x" })
    expect(r.style).toBe(appendField(longStyle, truncated))
    expect(r.style!.length).toBeLessThanOrEqual(500)
  })
})

describe("assembleSunoInput — vocalGender precedence (divergence D)", () => {
  it("data.vocalGender wins", () => {
    const r = assembleSunoInput({ node: node({ vocalGender: "male" }), graph: emptyGraph, userPrompt: "song" })
    expect(r.vocalGender).toBe("male")
  })

  it("data.vocalGender = '' falls through to the connected voice-character field", () => {
    const r = assembleSunoInput({
      node: node({ vocalGender: "" }),
      graph: graphWithVocalGender("female"),
      userPrompt: "song",
    })
    expect(r.vocalGender).toBe("female")
  })

  it("data.vocalGender beats the connected field when both are present", () => {
    const r = assembleSunoInput({
      node: node({ vocalGender: "male" }),
      graph: graphWithVocalGender("female"),
      userPrompt: "song",
    })
    expect(r.vocalGender).toBe("male")
  })

  it("neither present → undefined", () => {
    const r = assembleSunoInput({ node: node({}), graph: emptyGraph, userPrompt: "song" })
    expect(r.vocalGender).toBeUndefined()
  })
})

describe("assembleSunoInput — persona spread", () => {
  it("spreads personaId + personaModel onto the result", () => {
    const r = assembleSunoInput({
      node: node({}),
      graph: emptyGraph,
      userPrompt: "song",
      persona: { personaId: "p1", personaModel: "style_persona" },
    })
    expect(r.personaId).toBe("p1")
    expect(r.personaModel).toBe("style_persona")
  })

  it("no persona → both undefined", () => {
    const r = assembleSunoInput({ node: node({}), graph: emptyGraph, userPrompt: "song" })
    expect(r.personaId).toBeUndefined()
    expect(r.personaModel).toBeUndefined()
  })
})

describe("assembleSunoInput — || undefined normalization (divergence E)", () => {
  it("empty model/style/title/negativeStyle normalize to undefined", () => {
    const r = assembleSunoInput({
      node: node({ model: "", style: "", title: "", negativeStyle: "" }),
      graph: emptyGraph,
      userPrompt: "song",
    })
    expect(r.model).toBeUndefined()
    expect(r.style).toBeUndefined()
    expect(r.title).toBeUndefined()
    expect(r.negativeStyle).toBeUndefined()
  })

  it("passes non-empty model/title/negativeStyle through verbatim", () => {
    const r = assembleSunoInput({
      node: node({ model: "V5", title: "My Song", negativeStyle: "heavy metal" }),
      graph: emptyGraph,
      userPrompt: "song",
    })
    expect(r.model).toBe("V5")
    expect(r.title).toBe("My Song")
    expect(r.negativeStyle).toBe("heavy metal")
  })
})

describe("assembleSunoInput — lyrics is caller-pre-resolved (divergence C)", () => {
  it("lyrics comes from input.lyrics, NOT data.lyrics", () => {
    const r = assembleSunoInput({
      node: node({ lyrics: "from-data-should-be-ignored" }),
      graph: emptyGraph,
      userPrompt: "song",
    })
    // The fn never reads data.lyrics for the VALUE — only the caller's input.lyrics.
    expect(r.lyrics).toBeUndefined()
    // …but custom-mode auto-detect (getEffectiveSunoCustomMode) DOES read data.lyrics.
    expect(r.customMode).toBe(true)
  })

  it("passes a caller-resolved lyrics string through; empty → undefined", () => {
    expect(
      assembleSunoInput({ node: node({}), graph: emptyGraph, userPrompt: "song", lyrics: "[Verse] hi" }).lyrics,
    ).toBe("[Verse] hi")
    expect(
      assembleSunoInput({ node: node({}), graph: emptyGraph, userPrompt: "song", lyrics: "" }).lyrics,
    ).toBeUndefined()
  })
})

describe("assembleSunoInput — pass-through fields + customMode auto-detect", () => {
  it("instrumental defaults to false and passes true through", () => {
    expect(assembleSunoInput({ node: node({}), graph: emptyGraph, userPrompt: "x" }).instrumental).toBe(false)
    expect(
      assembleSunoInput({ node: node({ instrumental: true }), graph: emptyGraph, userPrompt: "x" }).instrumental,
    ).toBe(true)
  })

  it("forwards the three weights verbatim", () => {
    const r = assembleSunoInput({
      node: node({ styleWeight: 0.6, weirdnessConstraint: 0.3, audioWeight: 0.8 }),
      graph: emptyGraph,
      userPrompt: "x",
    })
    expect(r.styleWeight).toBe(0.6)
    expect(r.weirdnessConstraint).toBe(0.3)
    expect(r.audioWeight).toBe(0.8)
  })

  it("auto-detects custom mode from a typed title when customMode is unset", () => {
    expect(
      assembleSunoInput({ node: node({ title: "My Song" }), graph: emptyGraph, userPrompt: "x" }).customMode,
    ).toBe(true)
  })
})

describe("assembleSunoInput — throwOnEmpty (divergence A)", () => {
  it("throws when throwOnEmpty AND no userPrompt AND no hint", () => {
    expect(() =>
      assembleSunoInput({ node: node({}), graph: emptyGraph, userPrompt: "", throwOnEmpty: true }),
    ).toThrow()
  })

  it("does NOT throw (returns bare empty prompt) when throwOnEmpty is false", () => {
    expect(
      assembleSunoInput({ node: node({}), graph: emptyGraph, userPrompt: "", throwOnEmpty: false }).prompt,
    ).toBe("")
  })

  it("does NOT throw when throwOnEmpty is omitted (defaults to false — BE/preview parity)", () => {
    expect(assembleSunoInput({ node: node({}), graph: emptyGraph, userPrompt: "" }).prompt).toBe("")
  })

  it("does NOT throw when the prompt is empty but a connected hint fills it", () => {
    const g = graphWithHint()
    const consumer = node({})
    const hint = composeSoundHintFromConnections(consumer, "suno-generate", g).text
    expect(() =>
      assembleSunoInput({ node: consumer, graph: g, userPrompt: "", throwOnEmpty: true }),
    ).not.toThrow()
    const r = assembleSunoInput({ node: consumer, graph: g, userPrompt: "", throwOnEmpty: true })
    expect(r.prompt).toBe(hint)
  })
})
