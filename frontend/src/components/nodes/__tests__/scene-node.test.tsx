import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SceneNode } from "../scene-node"
import type { SceneNodeFrontendData } from "@/types/nodes"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
  ),
}))

function makeData(overrides: Partial<SceneNodeFrontendData> = {}): SceneNodeFrontendData {
  return {
    label: "Scene 1",
    scene_index: 1,
    description: "Establishing wide of the lighthouse at dawn",
    emotional_beat: "setup",
    duration_seconds: 12,
    shot_input_mode: "first_frame",
    cast_keys: [],
    location_key: "lighthouse",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "nano-banana-2",
    video_model: "kling",
    shots: [],
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
    view_mode: "storyboard",
    ...overrides,
  }
}

function renderNode(data: SceneNodeFrontendData, selected = false) {
  return render(
    <SceneNode
      id="node-1"
      data={data as any}
      selected={selected}
      type="scene"
      dragging={false}
      zIndex={0}
      isConnectable={true}
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      {...({} as any)}
    />,
  )
}

describe("SceneNode (Phase 1B.2 pipeline)", () => {
  it("renders without crashing", () => {
    renderNode(makeData())
    expect(screen.getByTestId("scene-node")).toBeInTheDocument()
  })

  it("declares the four target handles for inputs", () => {
    renderNode(makeData())
    expect(screen.getByTestId("handle-characters")).toHaveAttribute("data-type", "target")
    expect(screen.getByTestId("handle-location")).toHaveAttribute("data-type", "target")
    expect(screen.getByTestId("handle-objects")).toHaveAttribute("data-type", "target")
    expect(screen.getByTestId("handle-prev_last_frame")).toHaveAttribute("data-type", "target")
  })

  it("declares the three source handles for outputs", () => {
    renderNode(makeData())
    expect(screen.getByTestId("handle-video")).toHaveAttribute("data-type", "source")
    expect(screen.getByTestId("handle-last_frame")).toHaveAttribute("data-type", "source")
    expect(screen.getByTestId("handle-audio_track")).toHaveAttribute("data-type", "source")
  })

  it("defaults to the storyboard view when view_mode is undefined", () => {
    // view_mode omitted -> storyboard. Storyboard renders the "No shots yet" empty state.
    const data = makeData({ view_mode: undefined as any })
    renderNode(data)
    expect(screen.getByText(/No shots yet/i)).toBeInTheDocument()
  })

  it("renders the scripting view when view_mode='scripting'", () => {
    const data = makeData({ view_mode: "scripting" })
    renderNode(data)
    // The scripting view shows the emotional_beat in its header row.
    expect(screen.getByText("setup")).toBeInTheDocument()
  })

  it("renders the video view when view_mode='video'", () => {
    const data = makeData({ view_mode: "video" })
    renderNode(data)
    expect(screen.getByText(/No composite yet/i)).toBeInTheDocument()
  })

  it("renders the default view when view_mode='default'", () => {
    const data = makeData({ view_mode: "default" })
    renderNode(data)
    // Default view shows "0 shots · 12s".
    expect(screen.getByText(/0 shots/)).toBeInTheDocument()
  })

  it("highlights the border when selected", () => {
    const { rerender } = renderNode(makeData(), false)
    expect(screen.getByTestId("scene-node").className).toContain("border-zinc-300")
    rerender(
      <SceneNode
        id="node-1"
        data={makeData() as any}
        selected={true}
        type="scene"
        dragging={false}
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        {...({} as any)}
      />,
    )
    expect(screen.getByTestId("scene-node").className).toContain("border-blue-500")
  })

  it("adds the pipeline_owned ring when the scene is pipeline-managed", () => {
    renderNode(makeData({ pipeline_owned: true }))
    expect(screen.getByTestId("scene-node").className).toContain("ring-blue-200")
  })

  it("shows the scene label in the storyboard header", () => {
    renderNode(makeData({ label: "Opening lighthouse", view_mode: "storyboard" }))
    expect(screen.getByText("Opening lighthouse")).toBeInTheDocument()
  })
})
