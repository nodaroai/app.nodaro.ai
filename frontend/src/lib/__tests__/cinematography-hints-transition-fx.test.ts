import { describe, it, expect } from "vitest"
import {
  getParameterPromptHint,
} from "@nodaro/prompts/picker-catalogs"
import {
  composeTransitionHintFromConnections,
  composeCharacterFxHintFromConnections,
} from "@nodaro/prompts/pickers"
import { EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES } from "@nodaro/shared/catalogs"
import { collectCinematographyHints, STILL_IMAGE_EXCLUDE_TYPES } from "../cinematography-hints"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * Transition and character-fx now compose from the graph on the DIRECT-WIRE
 * path too — the `cinematography` handle the frontend DAG executor reads
 * through this collector (the backend payload builder mirrors it, covered in
 * backend `label-ref-hint-context.test.ts`).
 *
 * Before this change the collector dispatched them WITHOUT the graph, so a
 * wired `startState` / `endState` / `target` was shown in the config panel's
 * injection preview and on the canvas card — both of which call
 * `getParameterPromptHint(node, { nodes, edges })` — and then silently dropped
 * at execution. The signed-off bound is that an UNWIRED picker is unchanged;
 * the exhaustive per-entry proof of that lives in
 * `packages/prompts/src/__tests__/graph-composed-unwired-identity.test.ts`, and
 * the last case here is its collector-level echo.
 *
 * Every expected string is derived from the catalog composer the picker itself
 * dispatches to — never hand-written — so catalog copy can change freely.
 */

const n = (nodes: unknown[]) => nodes as unknown as WorkflowNode[]
const e = (edges: unknown[]) => edges as unknown as WorkflowEdge[]

const TRANSITION_ID = "cross-dissolve"
const FX_ID = "werewolf"

const tone = (id: string, text: string) => ({ id, type: "tone", data: { tone: text } })
const hintOf = (node: { id: string; type: string; data: Record<string, unknown> }) =>
  getParameterPromptHint(node as never)

function transitionGraph(consumerType: string, handle: string, opts: { wired: boolean }) {
  const start = tone("start", "warm golden morning light")
  const end = tone("end", "cold blue dusk")
  const cut = { id: "cut", type: "transition", data: { transition: TRANSITION_ID } }
  return {
    cut,
    start,
    end,
    nodes: n([{ id: "c", type: consumerType, data: {} }, start, end, cut]),
    edges: e(
      opts.wired
        ? [
            { source: "start", target: "cut", targetHandle: "startState" },
            { source: "end", target: "cut", targetHandle: "endState" },
            { source: "cut", target: "c", targetHandle: handle },
          ]
        : [{ source: "cut", target: "c", targetHandle: handle }],
    ),
  }
}

function fxGraph(consumerType: string, handle: string, opts: { wired: boolean }) {
  const mira = { id: "mira", type: "character", data: { characterName: "Mira" } }
  const fx = { id: "fx", type: "character-fx", data: { characterFx: FX_ID } }
  return {
    fx,
    nodes: n([{ id: "c", type: consumerType, data: {} }, mira, fx]),
    edges: e(
      opts.wired
        ? [
            { source: "mira", target: "fx", targetHandle: "target" },
            { source: "fx", target: "c", targetHandle: handle },
          ]
        : [{ source: "fx", target: "c", targetHandle: handle }],
    ),
  }
}

describe("collectCinematographyHints — transition composes from startState / endState", () => {
  it("a video consumer receives the composed start/end clauses", () => {
    const { nodes, edges, cut, start, end } = transitionGraph("generate-video", "cinematography", { wired: true })
    const expected = composeTransitionHintFromConnections(
      TRANSITION_ID,
      [hintOf(start)],
      [hintOf(end)],
    )
    const hints = collectCinematographyHints("c", nodes, edges)

    expect(hints).toContain(expected)
    // Not vacuous: the composed clause really is more than the bare hint, and
    // the added tail is what flipped (the bare hint is a PREFIX of it).
    const bare = hintOf(cut)
    expect(expected.startsWith(bare)).toBe(true)
    const added = expected.slice(bare.length)
    expect(added.trim()).not.toBe("")
    expect(hints.join(" | ")).toContain(added)
  })

  it("a still-image consumer never receives it (the video-only exclusion still applies)", () => {
    const { nodes, edges } = transitionGraph("generate-image", "look", { wired: true })
    const hints = collectCinematographyHints("c", nodes, edges, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
    expect(hints.join(" | ")).not.toContain("warm golden morning light")
    expect(hints).toEqual([])
  })
})

describe("collectCinematographyHints — character-fx substitutes its target's name", () => {
  it("a video consumer receives the name-substituted effect", () => {
    const { nodes, edges, fx } = fxGraph("generate-video", "cinematography", { wired: true })
    const expected = composeCharacterFxHintFromConnections(FX_ID, ["Mira"])
    const hints = collectCinematographyHints("c", nodes, edges)

    expect(hints).toContain(expected)
    // The name is substituted INTO the sentence, so the old context-free text
    // must be gone entirely — not merely extended.
    expect(hints.join(" | ")).not.toContain(hintOf(fx))
    expect(hints.join(" | ")).toContain("Mira")
  })

  it("a still-image consumer never receives it", () => {
    const { nodes, edges } = fxGraph("generate-image", "look", { wired: true })
    const hints = collectCinematographyHints("c", nodes, edges, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
    expect(hints).toEqual([])
  })
})

describe("the bound: nothing wired to the picker's own handles changes nothing", () => {
  it("transition and character-fx wired ONLY into the consumer inject their context-free text", () => {
    for (const build of [transitionGraph, fxGraph]) {
      const g = build("generate-video", "cinematography", { wired: false })
      const picker = "cut" in g ? g.cut : g.fx
      expect(collectCinematographyHints("c", g.nodes, g.edges)).toEqual([hintOf(picker)])
    }
  })
})

describe("the collector reads the shared set", () => {
  it("both pickers are members, so the frontend and backend collectors cannot drift", () => {
    expect(EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES.has("transition")).toBe(true)
    expect(EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES.has("character-fx")).toBe(true)
  })
})
