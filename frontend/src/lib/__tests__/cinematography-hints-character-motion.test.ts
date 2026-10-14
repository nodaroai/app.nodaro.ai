import { describe, it, expect } from "vitest"
import { getCharacterMotionPromptHint as hintOf } from "@nodaro/prompts/pickers"
import { VIDEO_ONLY_PARAMETER_NODE_TYPES } from "@nodaro/shared/catalogs"
import { collectCinematographyHints, STILL_IMAGE_EXCLUDE_TYPES } from "../cinematography-hints"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const n = (nodes: unknown[]) => nodes as unknown as WorkflowNode[]
const e = (edges: unknown[]) => edges as unknown as WorkflowEdge[]

function graph(
  consumerType: string,
  handle: string,
  opts: { picks?: string[]; mira?: Record<string, unknown> } = {},
) {
  return {
    nodes: n([
      { id: "c", type: consumerType, data: {} },
      { id: "mira", type: "character", data: { characterName: "Mira", ...opts.mira } },
      { id: "theo", type: "character", data: { characterName: "Theo" } },
      { id: "m", type: "character-motion", data: { characterMotion: opts.picks ?? ["wave-hello", "hug-partner"] } },
    ]),
    edges: e([
      { source: "mira", target: "m", targetHandle: "target" },
      { source: "theo", target: "m", targetHandle: "partner" },
      { source: "m", target: "c", targetHandle: handle },
    ]),
  }
}

const named = (id: string) =>
  hintOf(id).replace(/\bthe subject\b/g, "Mira").replace(/\bthe partner\b/g, "Theo")

const EXPECTED = `${named("wave-hello")}, then ${named("hug-partner")}`

/** The wave wording with its subject stripped — present whether or not names were substituted. */
const WAVE_BODY = hintOf("wave-hello").replace(/^the subject /, "")

describe("collectCinematographyHints — character-motion", () => {
  it("a video consumer receives the sequence with the wired names substituted", () => {
    const { nodes, edges } = graph("generate-video", "cinematography")
    expect(collectCinematographyHints("c", nodes, edges)).toContain(EXPECTED)
  })

  it("a still-image consumer never receives it", () => {
    const { nodes, edges } = graph("generate-image", "look")
    const hints = collectCinematographyHints("c", nodes, edges, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
    expect(hints.join(" ")).not.toContain("Mira")
    expect(hints.join(" ")).not.toContain(WAVE_BODY)
  })

  it("the still-image exclusion is the shared video-only set", () => {
    expect(STILL_IMAGE_EXCLUDE_TYPES).toBe(VIDEO_ONLY_PARAMETER_NODE_TYPES)
  })

  it("a minor target drops the adult-only move and keeps the rest (minor-age floor)", () => {
    const { nodes, edges } = graph("generate-video", "cinematography", {
      picks: ["wave-hello", "kiss-partner"],
      mira: { person: { age: "age-child" } },
    })
    const joined = collectCinematographyHints("c", nodes, edges).join(" | ")
    expect(joined).toContain(named("wave-hello"))
    expect(joined).not.toContain(named("kiss-partner"))
    expect(joined).not.toContain("presses the lips")
    expect(joined).not.toContain(", then ")
  })

  it("an adult target keeps the same adult-only move (the floor is not vacuous)", () => {
    const { nodes, edges } = graph("generate-video", "cinematography", {
      picks: ["wave-hello", "kiss-partner"],
      mira: { person: { age: "age-30s" } },
    })
    expect(collectCinematographyHints("c", nodes, edges)).toContain(
      `${named("wave-hello")}, then ${named("kiss-partner")}`,
    )
  })
})
