/**
 * `{Label}` ref path graph context — which parameter pickers compose from the
 * graph when a prompt places them by label on the SERVER.
 *
 * Three sites turn a parameter node into `{Label}` text: the orchestrator's
 * pre-completion, the sub-workflow handler's pre-completion, and the
 * `buildNodeRefMap` fallback. They must agree, so all three ask the one helper.
 * The worker entry is not unit-drivable (BullMQ + Supabase), so the placement
 * is pinned by reading the source, like catalog-guard-wiring.test.ts. The
 * sub-workflow site also has a behavioral test in sub-workflow-handler.test.ts,
 * and the ref-map site in payload-builder-character-motion.test.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES, PARAMETER_NODE_TYPES } from "@nodaro/shared/catalogs"
import {
  getParameterPromptHint,
} from "@nodaro/prompts/picker-catalogs"
import {
  composeCameraMotionHintFromConnections,
  composeTransitionHintFromConnections,
  composeCharacterFxHintFromConnections,
} from "@nodaro/prompts/pickers"
import { LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES, labelRefHintContext } from "../label-ref-hint-context.js"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}
function edge(source: string, target: string, targetHandle: string): SimpleEdge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle: null, targetHandle }
}

describe("labelRefHintContext", () => {
  const nodes = [
    node("mira", "character", { characterName: "Mira" }),
    node("m", "character-motion", { characterMotion: ["wave-hello"] }),
  ]
  const edges = [edge("mira", "m", "target")]

  it("hands character-motion the graph it was given", () => {
    const ctx = labelRefHintContext(nodes[1], nodes, edges)
    expect(ctx?.nodes).toBe(nodes)
    expect(ctx?.edges).toBe(edges)
    expect(getParameterPromptHint(nodes[1], ctx)).toMatch(/^Mira /)
  })

  it("hands camera-motion the graph it was given", () => {
    const cam = node("cam", "camera-motion", { cameraMotion: "dolly-in" })
    const tone = node("tone", "tone", { tone: "warm golden morning light" })
    const camNodes = [cam, tone]
    const camEdges = [edge("tone", "cam", "startState")]

    const ctx = labelRefHintContext(cam, camNodes, camEdges)
    expect(ctx?.nodes).toBe(camNodes)
    expect(ctx?.edges).toBe(camEdges)
    // Not vacuous: the graph really does change camera-motion's text.
    expect(getParameterPromptHint(cam, ctx)).not.toBe(getParameterPromptHint(cam))
  })

  it.each(["mood", "character", "framing", ""])(
    "gives %s no graph (its server {Label} text stays context-free)",
    (type) => {
      expect(labelRefHintContext(node("x", type), nodes, edges)).toBeUndefined()
    },
  )

  it.each(["transition", "character-fx"])(
    "hands %s the graph too (it joined the set in the signed-off change)",
    (type) => {
      const ctx = labelRefHintContext(node("x", type), nodes, edges)
      expect(ctx?.nodes).toBe(nodes)
      expect(ctx?.edges).toBe(edges)
    },
  )

  it("tolerates a node with no type", () => {
    expect(labelRefHintContext({ id: "x" }, nodes, edges)).toBeUndefined()
    expect(labelRefHintContext(undefined, nodes, edges)).toBeUndefined()
  })

  it("is exactly {camera-motion, character-fx, character-motion, transition}: widening it changes existing workflows' prompts and needs sign-off", () => {
    // Transition and character-fx were admitted deliberately (signed off): they
    // already composed from the graph in the config-panel preview, on the canvas
    // card and on the frontend `{Label}` path, so the server was the last
    // surface dropping a wired startState / endState / target. The bound Tal
    // accepted — an UNWIRED picker is byte-identical either way — is proved
    // entry-by-entry in
    // packages/prompts/src/__tests__/graph-composed-unwired-identity.test.ts.
    expect([...LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES].sort()).toEqual(
      ["camera-motion", "character-fx", "character-motion", "transition"],
    )
  })

  it("is a subset of the execution-path graph-composed set and of the parameter types", () => {
    for (const t of LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES) {
      expect(EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES.has(t), t).toBe(true)
      expect(PARAMETER_NODE_TYPES.has(t), t).toBe(true)
    }
  })
})

describe("camera-motion server {Label} text composes from the graph", () => {
  it("resolves to the composed start/end-state hint, matching the editor", () => {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward, {Cam}",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const startTone = node("start", "tone", { label: "Start", tone: "warm golden morning light" })
    const endTone = node("end", "tone", { label: "End", tone: "cold blue dusk" })
    const cam = node("cam", "camera-motion", { label: "Cam", cameraMotion: "dolly-in" })
    const nodes = [s2v, startTone, endTone, cam]
    const edges = [
      edge("start", "cam", "startState"),
      edge("end", "cam", "endState"),
      edge("cam", "s2v", "cinematography"),
    ]

    const contextFree = getParameterPromptHint(cam)
    const composed = getParameterPromptHint(cam, { nodes, edges })
    // Not vacuous: the graph really does change camera-motion's text.
    expect(contextFree).not.toBe("")
    expect(composed).not.toBe(contextFree)

    // Derived from the real catalog composer, never a hand-written sentence:
    // this also cross-checks the walker in resolveParameterHint against it.
    const expected = composeCameraMotionHintFromConnections(
      "dolly-in",
      [getParameterPromptHint(startTone)],
      [getParameterPromptHint(endTone)],
    )
    expect(composed).toBe(expected)

    const prompt = buildPayload(s2v, "job-1", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    // `contextFree` is a PREFIX of `composed`, so asserting it discriminates
    // nothing — the composed clause is the assertion that flipped.
    expect(prompt).toContain(expected)
    // And say what was ADDED, still derived (the composer's own tail past the
    // bare motion hint), never a hand-written "beginning with …" sentence.
    const addedClause = expected.slice(contextFree.length)
    expect(addedClause.trim()).not.toBe("")
    expect(prompt).toContain(addedClause)
  })
})

/**
 * The behaviour that FLIPPED. Both server paths a picker's text can reach a
 * prompt by are covered, because they are reached differently:
 *
 *  - `{Label}`: the consumer's prompt names the picker. Naming it ALSO
 *    suppresses the cinematography auto-inject (no double-injection), so the
 *    ref-map / pre-completion path is the only thing that can put text in the
 *    prompt — which is exactly what makes it a clean probe of that path.
 *  - DIRECT WIRE: the picker feeds the consumer's `cinematography` handle and
 *    the prompt does NOT name it, so `collectCinematographyHints` fires. That
 *    path reads `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`, not the label set.
 *
 * Expected text is always derived from the catalog composer the picker itself
 * dispatches to — never a hand-written sentence — so catalog copy can change
 * without touching this file, and the test really cross-checks the walker in
 * `resolveParameterHint` against the composer.
 */
describe("transition + character-fx server text composes from the graph", () => {
  it("transition {Label}: a wired startState now reaches its text", () => {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward, {Cut}",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const tone = node("tone", "tone", { label: "Tone", tone: "warm golden morning light" })
    const cut = node("cut", "transition", { label: "Cut", transition: "cross-dissolve" })
    const nodes = [s2v, tone, cut]
    const edges = [edge("tone", "cut", "startState"), edge("cut", "s2v", "cinematography")]

    const contextFree = getParameterPromptHint(cut)
    const composed = getParameterPromptHint(cut, { nodes, edges })
    expect(contextFree).not.toBe("")
    expect(composed).not.toBe(contextFree)

    const expected = composeTransitionHintFromConnections(
      "cross-dissolve",
      [getParameterPromptHint(tone)],
      [],
    )
    expect(composed).toBe(expected)

    const prompt = buildPayload(s2v, "job-2", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    expect(prompt).toContain(expected)
    // `contextFree` is a PREFIX of `composed` for transition (the start/end
    // clauses are appended), so asserting it discriminates nothing — the added
    // clause is what flipped, and it is sliced off the composer's own output.
    const addedClause = expected.slice(contextFree.length)
    expect(addedClause.trim()).not.toBe("")
    expect(prompt).toContain(addedClause)
  })

  it("character-fx {Label}: a wired target ref now reaches its text", () => {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward, {FX}",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const mira = node("mira", "character", { label: "Mira", characterName: "Mira" })
    const fx = node("fx", "character-fx", { label: "FX", characterFx: "werewolf" })
    const nodes = [s2v, mira, fx]
    const edges = [edge("mira", "fx", "target"), edge("fx", "s2v", "cinematography")]

    const contextFree = getParameterPromptHint(fx)
    const composed = getParameterPromptHint(fx, { nodes, edges })
    expect(contextFree).not.toBe("")
    expect(composed).not.toBe(contextFree)

    const expected = composeCharacterFxHintFromConnections("werewolf", ["Mira"])
    expect(composed).toBe(expected)

    const prompt = buildPayload(s2v, "job-3", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    expect(prompt).toContain(expected)
    // Character FX substitutes the wired name INTO the sentence ("the subject"
    // → "Mira"), so the old context-free string is not a prefix — it must be
    // gone from the prompt entirely.
    expect(prompt).not.toContain(contextFree)
  })

  it("transition DIRECT WIRE: the cinematography collector composes the start/end clauses", () => {
    // No `{Cut}` in the prompt: the label-ref suppression does not apply, so
    // this exercises collectCinematographyHints / the execution set, not the
    // label set.
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const tone = node("tone", "tone", { label: "Tone", tone: "warm golden morning light" })
    const dusk = node("dusk", "tone", { label: "Dusk", tone: "cold blue dusk" })
    const cut = node("cut", "transition", { label: "Cut", transition: "cross-dissolve" })
    const nodes = [s2v, tone, dusk, cut]
    const edges = [
      edge("tone", "cut", "startState"),
      edge("dusk", "cut", "endState"),
      edge("cut", "s2v", "cinematography"),
    ]

    const contextFree = getParameterPromptHint(cut)
    const expected = composeTransitionHintFromConnections(
      "cross-dissolve",
      [getParameterPromptHint(tone)],
      [getParameterPromptHint(dusk)],
    )
    expect(expected).not.toBe(contextFree)

    const prompt = buildPayload(s2v, "job-4", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    expect(prompt).toContain(expected)
    const addedClause = expected.slice(contextFree.length)
    expect(addedClause.trim()).not.toBe("")
    expect(prompt).toContain(addedClause)
  })

  it("character-fx DIRECT WIRE: the cinematography collector substitutes the target's name", () => {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "a man walks forward",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const mira = node("mira", "character", { label: "Mira", characterName: "Mira" })
    const fx = node("fx", "character-fx", { label: "FX", characterFx: "werewolf" })
    const nodes = [s2v, mira, fx]
    const edges = [edge("mira", "fx", "target"), edge("fx", "s2v", "cinematography")]

    const contextFree = getParameterPromptHint(fx)
    const expected = composeCharacterFxHintFromConnections("werewolf", ["Mira"])
    expect(expected).not.toBe(contextFree)

    const prompt = buildPayload(s2v, "job-5", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    expect(prompt).toContain(expected)
    expect(prompt).not.toContain(contextFree)
  })

  it("UNWIRED is untouched: nothing on the picker's handles → the prompt is byte-identical to the context-free text", () => {
    // The bound Tal signed off on, at the level of a real payload. The
    // exhaustive per-entry version lives in the prompts package
    // (graph-composed-unwired-identity.test.ts); this is the payload-level
    // sanity check that the collector does not add anything of its own.
    const mk = (pickerType: string, pickerData: Record<string, unknown>) => {
      const s2v = node("s2v", "speech-to-video", {
        prompt: "a man walks forward",
        imageUrl: "https://example.com/a.png",
        audioUrl: "https://example.com/a.mp3",
      })
      const picker = node("p", pickerType, pickerData)
      const nodes = [s2v, picker]
      const edges = [edge("p", "s2v", "cinematography")]
      return {
        picker,
        nodes,
        edges,
        prompt: buildPayload(s2v, "job-6", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string,
      }
    }

    for (const [type, data] of [
      ["transition", { label: "Cut", transition: "cross-dissolve" }],
      ["character-fx", { label: "FX", characterFx: "werewolf" }],
    ] as const) {
      const { picker, nodes, edges, prompt } = mk(type, data)
      expect(getParameterPromptHint(picker, { nodes, edges })).toBe(getParameterPromptHint(picker))
      expect(prompt).toBe(`a man walks forward. ${getParameterPromptHint(picker)}`)
    }
  })
})

describe("every server {Label} pre-completion site asks the shared helper", () => {
  const CALL = (nodeVar: string, nodesVar: string, edgesVar: string) =>
    new RegExp(
      `getParameterPromptHint\\(\\s*${nodeVar}\\s*,\\s*labelRefHintContext\\(\\s*${nodeVar}\\s*,\\s*${nodesVar}\\s*,\\s*${edgesVar}\\s*\\)\\s*\\)`,
    )
  const BARE = (nodeVar: string) => new RegExp(`getParameterPromptHint\\(\\s*${nodeVar}\\s*\\)`)

  it("orchestrator worker: parameter pre-completion passes the run graph", () => {
    const src = read("workers/orchestrator-worker.ts")
    expect(src).toMatch(CALL("node", "nodes", "edges"))
    expect(src).not.toMatch(BARE("node"))
  })

  it("sub-workflow handler: parameter pre-completion passes the SUB-graph", () => {
    const src = read("services/workflow-engine/sub-workflow-handler.ts")
    expect(src).toMatch(CALL("subNode", "subNodes", "subEdges"))
    expect(src).not.toMatch(BARE("subNode"))
  })

  it("buildNodeRefMap: the parameter fallback passes the graph", () => {
    const src = read("services/workflow-engine/payload-builder.ts")
    const start = src.indexOf("export function buildNodeRefMap(")
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf("\n}\n", start))
    expect(body).toMatch(CALL("node", "nodes", "edges"))
    expect(body).not.toContain("getNodePromptHint(")
  })
})
