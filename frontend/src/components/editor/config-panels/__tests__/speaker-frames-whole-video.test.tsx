/**
 * Speaker Frames fed a bare video (no edit) samples that whole video as its
 * one camera: the panel says so instead of asking for an edit.
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { SpeakerFramesConfig } from "../speaker-frames-config"
import type { SpeakerFramesNodeData, WorkflowEdge, WorkflowNode } from "@/types/nodes"

afterEach(cleanup)

function renderPanel(edges: WorkflowEdge[]) {
  const data = { label: "Speaker Frames", fieldMappings: {} } as unknown as SpeakerFramesNodeData
  const nodes = [
    { id: "up", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Video", url: "https://x/a.mp4" } },
    { id: "sf", type: "speaker-frames", position: { x: 0, y: 0 }, data },
  ] as unknown as WorkflowNode[]
  render(<SpeakerFramesConfig data={data} onUpdate={() => {}} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={nodes} edges={edges} nodeId="sf" />)
}

describe("Speaker Frames' cameras with a bare video", () => {
  it("says the whole video is sampled, not 'wire an edit'", () => {
    renderPanel([{ id: "v", source: "up", sourceHandle: "video", target: "sf", targetHandle: "video" }] as unknown as WorkflowEdge[])
    expect(screen.getByTestId("speaker-frames-whole-video")).toBeTruthy()
    expect(screen.queryByTestId("speaker-frames-no-edit")).toBeNull()
  })

  it("still asks for an edit when nothing is wired", () => {
    renderPanel([])
    expect(screen.getByTestId("speaker-frames-no-edit")).toBeTruthy()
    expect(screen.queryByTestId("speaker-frames-whole-video")).toBeNull()
  })
})
