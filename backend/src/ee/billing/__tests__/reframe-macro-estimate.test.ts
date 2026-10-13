import { describe, it, expect, vi } from "vitest"
import { CreditsService, estimateWorkflowCredits, estimateWorkflowListingCredits } from "../credits.js"

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => false,
}))

/**
 * D5 (decided 2026-10-11): Reframe is a canvas macro, so its Transcribe, Speaker
 * Frames and Speaker View are ordinary nodes that each charge their own price,
 * inside a Group the engine treats as a transparent frame. Every server-side
 * estimate — a run's quote, the credit preflight, an app's listing and quotes,
 * `/v1/nodes` — prices the nodes of the graph and nothing else, so the total
 * for the group IS the sum of its three nodes. These tests pin that the frame
 * (and the `parentId` that places a node in it) changes no figure, so the
 * summed estimate the editor shows for the group cannot differ from what the
 * server quotes or reserves.
 */
const nodes = [
  { id: "up", type: "upload-video", data: { url: "https://example.com/clip.mp4" } },
  { id: "g", type: "group", data: { label: "Reframe", macro: "reframe" } },
  { id: "t", type: "transcribe", data: { provider: "elevenlabs-stt", diarize: true }, parentId: "g" },
  { id: "f", type: "speaker-frames", data: {}, parentId: "g" },
  { id: "v", type: "speaker-view", data: { quality: "final", targetAspect: "9:16" }, parentId: "g" },
  { id: "img", type: "generate-image", data: { provider: "nano-banana" } },
]
const edges = [
  { source: "up", target: "t", targetHandle: "audio" },
  { source: "up", target: "f", targetHandle: "video" },
  { source: "up", target: "v", targetHandle: "video" },
  { source: "t", sourceHandle: "json", target: "f", targetHandle: "transcript" },
  { source: "t", sourceHandle: "json", target: "v", targetHandle: "transcript" },
  { source: "f", sourceHandle: "tracks", target: "v", targetHandle: "tracks" },
]
const ungrouped = nodes.filter((n) => n.type !== "group").map(({ parentId: _parentId, ...n }) => n)

describe("the server's estimate of a Reframe group", () => {
  it("is the same with the frame as without it: the group adds no price and hides none", () => {
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges)).toBe(CreditsService.estimateWorkflowBaseCredits(ungrouped, edges))
  })

  it("counts each node once: the grouped graph is the sum of its nodes priced one by one", () => {
    const each = (list: typeof nodes) => list.reduce((sum, n) => sum + CreditsService.estimateWorkflowBaseCredits([n], []), 0)
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, [])).toBe(each(nodes))
    // ...and the three nodes of the group are real, priced work, not zero-cost passengers.
    expect(each(nodes.filter((n) => n.parentId === "g"))).toBeGreaterThan(0)
  })

  it("the run quote and the stored listing price the same graph the same way", async () => {
    expect(await estimateWorkflowCredits(nodes, edges)).toBe(await estimateWorkflowCredits(ungrouped, edges))
    const grouped = await estimateWorkflowListingCredits(nodes, edges, { publishType: "app" })
    const flat = await estimateWorkflowListingCredits(ungrouped, edges, { publishType: "app" })
    expect(grouped).toEqual(flat)
  })
})
