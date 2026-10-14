/**
 * Every video producer wired into Mix Audio's `in` is one of its tracks (its
 * sound; decided 2026-10-13) on the SERVER's resolver — the canvas accepts the
 * wire for every member of VIDEO_PRODUCER_TYPES, so none may silently drop.
 * The editor's resolver is pinned the same way
 * (frontend/.../workflow-editor/__tests__/mix-audio-video-totality.test.ts).
 */
import { describe, it, expect } from "vitest"
import { VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import { NODE_HANDLES } from "../../../lib/mcp/generated/node-handles.js"
import { resolveNodeInputs } from "../input-resolver.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const URL = "https://r2/take.mp4"
const BED = "https://r2/bed.mp3"

/** The producer's video pip: the declared output that names video, else its first. */
const videoHandleOf = (type: string): string | null => {
  const outs = NODE_HANDLES[type]?.outputs ?? []
  return outs.find((h) => h.includes("video")) ?? outs[0] ?? null
}

describe("Mix Audio: every video producer on `in` lands in audioUrls (server resolver)", () => {
  it.each([...VIDEO_PRODUCER_TYPES].sort())("%s", (type) => {
    const src: SimpleNode = { id: "src", type, data: { label: "src" } }
    const bed: SimpleNode = { id: "bed", type: "upload-audio", data: { label: "bed", url: BED } }
    const mix: SimpleNode = { id: "mix", type: "mix-audio", data: { label: "mix" } }
    const edges: SimpleEdge[] = [
      { id: "e1", source: "src", target: "mix", sourceHandle: videoHandleOf(type), targetHandle: "in" },
      { id: "e2", source: "bed", target: "mix", sourceHandle: "audio", targetHandle: "in" },
    ]
    const states: Record<string, NodeExecutionState> = {
      src: { status: "completed", output: { videoUrl: URL } },
      bed: { status: "completed", output: { audioUrl: BED } },
    }
    const r = resolveNodeInputs(mix, edges, states, [src, bed, mix])
    expect(r.audioUrls).toEqual([URL, BED])
  })

  it("covers Speaker View's render", () => {
    expect(VIDEO_PRODUCER_TYPES.has("speaker-view")).toBe(true)
  })
})
