/**
 * Every video producer wired into Mix Audio's `in` is one of its tracks (its
 * sound; decided 2026-10-13) on the EDITOR's resolver — the canvas accepts the
 * wire for every member of VIDEO_PRODUCER_TYPES, so none may silently drop.
 * The server's resolver is pinned the same way
 * (backend/.../workflow-engine/__tests__/mix-audio-video-totality.test.ts).
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import { VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { NODE_DEFINITIONS, type WorkflowNode } from "@/types/nodes"
import { resolveNodeInputs } from "../node-input-resolver"

const URL = "https://r2/take.mp4"
const BED = "https://r2/bed.mp3"

/** The producer's video pip: the one its colour table calls video, else a declared output naming video, else its first. */
const videoHandleOf = (type: string): string | null => {
  const typed = Object.entries(HANDLE_OUTPUT_TYPES[type] ?? {}).find(([, t]) => t === "video")?.[0]
  const outs = NODE_DEFINITIONS.find((d) => d.type === type)?.outputs ?? []
  return typed ?? outs.find((h) => h.includes("video")) ?? outs[0] ?? null
}

const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, fieldMappings: {}, ...data } }) as unknown as WorkflowNode

describe("Mix Audio: every video producer on `in` lands in audioUrls (editor resolver)", () => {
  it.each([...VIDEO_PRODUCER_TYPES].sort())("%s", (type) => {
    // The result as the canvas holds it: the field each producer saves its take on.
    const src = node("src", type, { generatedVideoUrl: URL, url: URL, videoUrl: URL, youtubeUrl: URL, generatedResults: [{ url: URL }], activeResultIndex: 0 })
    const bed = node("bed", "upload-audio", { url: BED, assetId: "" })
    const mix = node("mix", "mix-audio", { trackCount: 2, trackVolumes: {} })
    const edges = [
      { id: "e1", source: "src", target: "mix", sourceHandle: videoHandleOf(type), targetHandle: "in" },
      { id: "e2", source: "bed", target: "mix", sourceHandle: "audio", targetHandle: "in" },
    ]
    const inputs = resolveNodeInputs(mix, [src, bed, mix], edges as never)
    expect(inputs.audioUrls).toEqual([URL, BED])
  })
})
