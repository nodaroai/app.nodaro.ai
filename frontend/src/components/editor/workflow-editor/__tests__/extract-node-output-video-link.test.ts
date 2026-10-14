// @vitest-environment node
// The Video URL node's output on the CANVAS engine. The server engine
// (`output-extractor.ts`) reads the node through the same `@nodaro/shared` rule;
// these cases are mirrored in its test so the two cannot disagree about which
// video a node emits.
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { resolveVideoLinkOutput } from "@nodaro/shared"
import { extractNodeOutput } from "../execution-graph"
import type { WorkflowNode } from "@/types/nodes"

function linkNode(data: Record<string, unknown>): WorkflowNode {
  return { id: "v1", type: "youtube-video", position: { x: 0, y: 0 }, data: { label: "Video URL", ...data } as never } as WorkflowNode
}

const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"

describe("extractNodeOutput — youtube-video", () => {
  it("emits the downloaded file when it belongs to the current link", () => {
    expect(
      extractNodeOutput(linkNode({ youtubeUrl: " https://youtu.be/sameVideo001 ", downloadedVideoUrl: FILE, downloadedFromUrl: "https://youtu.be/sameVideo001" })),
    ).toBe(FILE)
  })

  it("trusts a file with no recorded source — every node saved before the field existed", () => {
    expect(extractNodeOutput(linkNode({ youtubeUrl: "https://yt.com", downloadedVideoUrl: FILE }))).toBe(FILE)
  })

  it("never emits a file downloaded from ANOTHER link — it falls back to the current link", () => {
    expect(
      extractNodeOutput(linkNode({
        youtubeUrl: "https://youtu.be/newVideo0001",
        downloadedVideoUrl: FILE,
        downloadedFromUrl: "https://youtu.be/oldVideo0001",
      })),
    ).toBe("https://youtu.be/newVideo0001")
  })

  it("passes a direct file link through untouched", () => {
    expect(extractNodeOutput(linkNode({ youtubeUrl: "https://cdn.nodaro.ai/videos/yt-9.mp4" }))).toBe("https://cdn.nodaro.ai/videos/yt-9.mp4")
  })

  it("is undefined for an empty node", () => {
    expect(extractNodeOutput(linkNode({ youtubeUrl: "" }))).toBeUndefined()
  })

  it("IS the shared rule — not a copy of it", () => {
    const cases = [
      { youtubeUrl: "https://yt.com", downloadedVideoUrl: FILE },
      { youtubeUrl: "https://a", downloadedVideoUrl: FILE, downloadedFromUrl: "https://b" },
      { youtubeUrl: "   " },
      {},
    ]
    for (const data of cases) expect(extractNodeOutput(linkNode(data))).toBe(resolveVideoLinkOutput(data))
  })
})
