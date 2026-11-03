import { describe, it, expect } from "vitest"
import { getStylePromptHint, getStyleVideoPromptHint } from "@nodaro/prompts/pickers"
import { collectCinematographyHints, STILL_IMAGE_EXCLUDE_TYPES } from "../cinematography-hints"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * A Style node wired into a VIDEO consumer injects its video wording
 * (`getStyleVideoPromptHint`; every style authors one), the editor's video
 * executors passing `surface: "video"` to this collector as the backend's
 * payload builder does. A still keeps the image wording (`promptHint`).
 */

const n = (nodes: unknown[]) => nodes as unknown as WorkflowNode[]
const e = (edges: unknown[]) => edges as unknown as WorkflowEdge[]

const graph = (styleId: string, consumerType: string) => ({
  nodes: n([
    { id: "style-1", type: "style", data: { style: styleId } },
    { id: "gen-1", type: consumerType, data: { prompt: "a man walks" } },
  ]),
  edges: e([{ id: "e1", source: "style-1", target: "gen-1", targetHandle: "look" }]),
})

describe("collectCinematographyHints: a Style node follows the consumer's surface", () => {
  it("video: Low Poly's video wording", () => {
    const { nodes, edges } = graph("low-poly", "generate-video")
    expect(collectCinematographyHints("gen-1", nodes, edges, { excludeCharacterElements: true, surface: "video" }))
      .toEqual([getStyleVideoPromptHint("low-poly")])
    expect(getStyleVideoPromptHint("low-poly")).not.toBe(getStylePromptHint("low-poly"))
  })

  it("still (no surface): Low Poly's image wording, as before", () => {
    const { nodes, edges } = graph("low-poly", "generate-image")
    expect(collectCinematographyHints("gen-1", nodes, edges, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES }))
      .toEqual([getStylePromptHint("low-poly")])
  })

  it("video: another style, Anime, injects its own video wording too", () => {
    const { nodes, edges } = graph("anime", "generate-video")
    expect(collectCinematographyHints("gen-1", nodes, edges, { surface: "video" }))
      .toEqual([getStyleVideoPromptHint("anime")])
    expect(getStyleVideoPromptHint("anime")).not.toBe(getStylePromptHint("anime"))
  })
})
