/**
 * Suno Add Vocals takes the song on `audio` and the lyrics or the vocal
 * direction on `prompt`: a wired audio reaches the run as its file, a wired
 * text as the prompt.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, fieldMappings: {}, ...data } }) as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, targetHandle }) as WorkflowEdge

const song = node("song", "upload-audio", { url: "https://r2/beat.mp3" })
const lyrics = node("lyrics", "text-prompt", { text: "We sing under the city lights" })
const target = node("av", "suno-add-vocals", { model: "V6" })

describe("resolveNodeInputs — suno-add-vocals", () => {
  it("the audio wire is the song's file and the prompt wire the lyrics", () => {
    const inputs = resolveNodeInputs(target, [song, lyrics, target], [edge("song", "av", "audio"), edge("lyrics", "av", "prompt")])
    expect(inputs.audioUrl).toBe("https://r2/beat.mp3")
    expect(inputs.prompt).toBe("We sing under the city lights")
  })
})
