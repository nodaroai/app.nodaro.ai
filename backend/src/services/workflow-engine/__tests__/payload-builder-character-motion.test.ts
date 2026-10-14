import { describe, it, expect } from "vitest"
import { getCharacterMotionPromptHint as hintOf } from "@nodaro/prompts/pickers"
import { getParameterPromptHint } from "@nodaro/prompts/picker-catalogs"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}
function edge(source: string, target: string, targetHandle: string): SimpleEdge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle: null, targetHandle }
}
function ctxFor(
  consumer: SimpleNode,
  handle: string,
  opts: { picks?: string[]; mira?: Record<string, unknown> } = {},
) {
  return {
    nodes: [
      consumer,
      node("mira", "character", { characterName: "Mira", ...opts.mira }),
      node("theo", "character", { characterName: "Theo" }),
      node("m", "character-motion", { characterMotion: opts.picks ?? ["wave-hello", "hug-partner"] }),
    ],
    edges: [edge("mira", "m", "target"), edge("theo", "m", "partner"), edge("m", consumer.id, handle)],
    nodeStates: {},
  }
}

const named = (id: string) =>
  hintOf(id).replace(/\bthe subject\b/g, "Mira").replace(/\bthe partner\b/g, "Theo")

const EXPECTED = `${named("wave-hello")}, then ${named("hug-partner")}`

/** The wave wording with its subject stripped — present whether or not names were substituted. */
const WAVE_BODY = hintOf("wave-hello").replace(/^the subject /, "")

function s2vNode(): SimpleNode {
  return node("s2v", "speech-to-video", {
    prompt: "a man speaks to the crowd",
    imageUrl: "https://example.com/a.png",
    audioUrl: "https://example.com/a.mp3",
  })
}

function s2vPrompt(opts: { picks?: string[]; mira?: Record<string, unknown> } = {}): string {
  const s2v = s2vNode()
  return buildPayload(s2v, "job-1", {}, undefined, ctxFor(s2v, "cinematography", opts)).payload.prompt as string
}

describe("payload-builder: character-motion", () => {
  it("a video consumer's prompt carries the sequence with the wired names (server parity with the editor)", () => {
    expect(s2vPrompt()).toContain(EXPECTED)
  })

  it("a still-image consumer's prompt never carries it", () => {
    const gi = node("gen-1", "generate-image", { prompt: "a woman in a cafe", provider: "nano-banana-pro" })
    const prompt = buildPayload(gi, "job-1", {}, undefined, ctxFor(gi, "look")).payload.prompt as string
    expect(prompt).not.toContain("Mira")
    expect(prompt).not.toContain(WAVE_BODY)
    expect(prompt).toContain("a woman in a cafe")
  })
})

describe("payload-builder: character-motion minor-age floor reaches execution", () => {
  const picks = ["wave-hello", "kiss-partner"]

  it("a target Character with a minor `person` age drops the adult-only move", () => {
    const prompt = s2vPrompt({ picks, mira: { description: "a girl with a red raincoat", person: { age: "age-child" } } })
    expect(prompt).toContain(named("wave-hello"))
    expect(prompt).not.toContain(named("kiss-partner"))
    expect(prompt).not.toContain("presses the lips")
    expect(prompt).not.toContain(", then ")
  })

  it("a target Character whose description states a minor age (no `person` value) drops it too", () => {
    const prompt = s2vPrompt({ picks, mira: { description: "a 7 year old on a swing" } })
    expect(prompt).toContain(named("wave-hello"))
    expect(prompt).not.toContain("presses the lips")
  })

  it("an adult target Character keeps the move (the floor is not vacuous)", () => {
    const prompt = s2vPrompt({ picks, mira: { description: "a woman in her 30s", person: { age: "age-30s" } } })
    expect(prompt).toContain(`${named("wave-hello")}, then ${named("kiss-partner")}`)
  })
})

// A prompt that places the node by label (`{Motion}`) resolves through
// buildNodeRefMap, not the cinematography collector. The editor composes that
// value WITH the graph (execution-graph.ts extractNodeOutput), so the server
// must too: otherwise a minor Character's run ships an adult-only move and the
// wired names are lost.
describe("payload-builder: character-motion placed by {Label} in the prompt", () => {
  const picks = ["wave-hello", "kiss-partner"]

  /** Subject-only substitution: these graphs wire no partner. */
  const namedSubject = (id: string) => hintOf(id).replace(/\bthe subject\b/g, "Mira")

  /** The longest run of kiss wording between partner mentions: present however
   *  the unwired partner slot is spelled. */
  const KISS_BODY = hintOf("kiss-partner")
    .split(/\bthe partner(?:'s)?/)
    .map((s) => s.trim())
    .reduce((a, b) => (b.length > a.length ? b : a), "")

  function labelGraph(age: string) {
    const s2v = node("s2v", "speech-to-video", {
      prompt: "someone speaks to the crowd, {Motion}",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
    const mira = node("mira", "character", { label: "Mira", characterName: "Mira", person: { age } })
    const motion = node("m", "character-motion", { label: "Motion", characterMotion: picks })
    // Also wired on `cinematography`, as the editor wires it. `{Motion}` in the
    // prompt suppresses that auto-inject, so the ref map is the ONLY way the
    // fragment can reach the prompt here.
    const edges = [edge("mira", "m", "target"), edge("m", "s2v", "cinematography")]
    const nodes = [s2v, mira, motion]
    const prompt = buildPayload(s2v, "job-1", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
    return { prompt, editor: getParameterPromptHint(motion, { nodes, edges }) }
  }

  it("the kiss wording is a real, non-trivial fragment (the absence checks below are not vacuous)", () => {
    expect(KISS_BODY.length).toBeGreaterThan(20)
    expect(hintOf("wave-hello")).toMatch(/^the subject /)
  })

  it("a minor target Character: names the subject and drops the adult-only move", () => {
    const { prompt, editor } = labelGraph("age-child")
    expect(prompt).not.toContain("{Motion}")
    expect(prompt).toContain(namedSubject("wave-hello"))
    expect(prompt).not.toContain(KISS_BODY)
    expect(prompt).toContain(editor)
  })

  it("an adult target Character (control): keeps the kiss and still names the subject", () => {
    const { prompt, editor } = labelGraph("age-30s")
    expect(prompt).toContain(`${namedSubject("wave-hello")}, then `)
    expect(prompt).toContain(KISS_BODY)
    expect(prompt).toContain(editor)
  })
})
