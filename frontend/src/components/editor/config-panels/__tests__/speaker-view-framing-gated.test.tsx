/**
 * "Edit framing…" on a Speaker View fed a bare video while video mode is not
 * live (R15; hide + explain, decided 2026-10-13): the badge already says why,
 * and the editor would open on a frame with nothing to draw, so the panel does
 * not offer it. Fed an edit, or once video mode is live, it is offered as before.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode is open only with both (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: false }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))

import { render, screen, cleanup } from "@testing-library/react"
import { SpeakerViewConfig } from "../speaker-view-config"
import { useFramingOpenStore } from "@/hooks/use-framing-open-store"
import type { SpeakerViewData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

const EDL = {
  version: 1,
  clock: "master",
  sources: [{ id: "camA", url: "https://cdn/a.mp4", kind: "video", speakers: ["Host"] }],
  segments: [{ id: "s0", inMs: 0, outMs: 10_000, video: "camA", speaker: "Host" }],
}

function graph(input: "video" | "edl") {
  const nodes = [
    { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Clip", url: "https://cdn/clip.mp4", metadata: { width: 1920, height: 1080 } } },
    { id: "plan", type: "edit-plan", position: { x: 0, y: 0 }, data: { label: "Plan", generatedJson: EDL } },
    { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", fieldMappings: {} } },
  ] as unknown as WorkflowNode[]
  const edges = (input === "video"
    ? [{ id: "e1", source: "up", target: "sv", targetHandle: "video" }]
    : [{ id: "e1", source: "plan", sourceHandle: "edl", target: "sv", targetHandle: "edl" }]) as unknown as WorkflowEdge[]
  return { nodes, edges }
}

const common = { onUpdate: () => {}, sources: [], fieldMappings: {}, onMapField: () => {} }
const renderView = (input: "video" | "edl") => {
  const g = graph(input)
  return render(<SpeakerViewConfig {...common} data={g.nodes[2]!.data as unknown as SpeakerViewData} nodes={g.nodes} edges={g.edges} nodeId="sv" />)
}

beforeEach(() => {
  flag.priced = true
  flag.frames = false
  useFramingOpenStore.setState({ hostMounted: true, nodeId: null })
})
afterEach(() => {
  cleanup()
  useFramingOpenStore.setState({ hostMounted: false, nodeId: null })
})

describe("Edit framing… on a video-fed Speaker View", () => {
  it("is not offered while video mode is not live", () => {
    renderView("video")
    expect(screen.queryByTestId("speaker-view-edit-framing")).toBeNull()
  })

  it("is offered once video mode is live", () => {
    flag.frames = true
    renderView("video")
    expect(screen.getByTestId("speaker-view-edit-framing")).toBeTruthy()
  })

  it("is offered on a Speaker View fed an edit, video mode live or not", () => {
    for (const frames of [false, true]) {
      flag.frames = frames
      renderView("edl")
      expect(screen.getByTestId("speaker-view-edit-framing"), `frames priced: ${frames}`).toBeTruthy()
      cleanup()
    }
  })
})
