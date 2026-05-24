import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SceneConfig } from "../scene-configs"
import type { SceneNodeFrontendData } from "@/types/nodes"
import type { SceneInputMode, ShotSpec } from "@nodaro/shared"

// ── Minimal mocks for heavy dependencies ────────────────────────────────────

vi.mock("@/hooks/use-scene-helper", () => ({
  useSceneHelper: () => ({
    state: { status: "idle" },
    invoke: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock("../scene-helper-buttons", () => ({
  SceneHelperButtons: () => <div data-testid="scene-helper-buttons" />,
}))

vi.mock("../scene-helper-modal", () => ({
  SceneHelperModal: () => <div data-testid="scene-helper-modal" />,
}))

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor, ...props }: any) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ ...props }: any) => <textarea {...props} />,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      const items: any[] = []
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectContent" || child.props?.__content) {
          React.Children.forEach(child.props?.children, (item: any) => {
            if (item) items.push(item)
          })
        }
      })
      // Extract id from trigger if present
      let triggerId: string | undefined
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectTrigger") {
          triggerId = child.props?.id
        }
      })
      return (
        <select
          id={triggerId}
          value={value ?? ""}
          onChange={(e: any) => onValueChange?.(e.target.value)}
          data-testid={triggerId ? `select-${triggerId}` : undefined}
        >
          {items}
        </select>
      )
    },
    SelectContent: Object.assign(({ children }: any) => <>{children}</>, {
      displayName: "SelectContent",
    }),
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
    SelectTrigger: Object.assign(
      ({ children, id }: any) => <span data-id={id}>{children}</span>,
      { displayName: "SelectTrigger" },
    ),
    SelectValue: () => null,
  }
})

// ── Test helpers ─────────────────────────────────────────────────────────────

const BASE_SHOT = {
  shot_id: "shot_01",
  camera: { shot_type: "medium" as const, angle: "eye_level" as const, motion: "static" as const },
  shot_intensity_kind: "action_shot" as const,
  action: "Hero walks toward camera",
  dialogue_line: null,
  duration_seconds: 3,
  motion_prompt: "steady walk",
  start_state: "standing far",
  end_state: "standing close",
  continuity_with_previous: null,
  shot_intent: {
    needs_multishot_reference: false,
    is_loopable: false,
    needs_music_suppression: true,
    is_match_cut: false,
  },
  visual_keyframe_prompt: "hero mid-shot walking",
  has_dialogue: false,
}

function makeData(
  shot_input_mode: SceneInputMode,
  shotOverride: Partial<ShotSpec> = {},
): SceneNodeFrontendData {
  return {
    scene_index: 1,
    description: "Test scene",
    emotional_beat: "tension",
    duration_seconds: 10,
    shot_input_mode,
    cast_keys: [],
    location_key: "loc_01",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "flux-1.1-pro",
    video_model: "kling-1.6",
    shots: [{ ...BASE_SHOT, ...shotOverride }],
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
  } as unknown as SceneNodeFrontendData
}

function renderPanel(data: SceneNodeFrontendData) {
  const onUpdate = vi.fn()
  render(
    <SceneConfig
      data={data}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />,
  )
  return { onUpdate }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SceneConfig per-shot editor", () => {
  it("does NOT render any per-shot section for first_frame mode", () => {
    renderPanel(makeData("first_frame"))
    expect(screen.queryByText(/Extends shot/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Interpolation keyframes/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Camera path/i)).not.toBeInTheDocument()
  })

  // ── Section 1: video_continuation ──────────────────────────────────────────

  it("renders 'Extends shot' select for video_continuation mode", () => {
    renderPanel(makeData("video_continuation"))
    expect(screen.getByText(/Extends shot/i)).toBeInTheDocument()
  })

  it("shows helper text for video_continuation", () => {
    renderPanel(makeData("video_continuation"))
    expect(screen.getByText(/Continuation requires VEO or Seedance 2/i)).toBeInTheDocument()
  })

  it("shows warning when extends_shot_id references a missing shot", () => {
    renderPanel(
      makeData("video_continuation", { extends_shot_id: "shot_99" }),
    )
    expect(screen.getByText(/referenced shot not found/i)).toBeInTheDocument()
  })

  it("does NOT show warning when extends_shot_id is absent", () => {
    renderPanel(makeData("video_continuation"))
    expect(screen.queryByText(/referenced shot not found/i)).not.toBeInTheDocument()
  })

  it("calls onUpdate with patched shots when extends_shot_id changes", () => {
    // Need two shots so there's an option to select.
    const data: SceneNodeFrontendData = {
      ...makeData("video_continuation"),
      shots: [
        { ...BASE_SHOT, shot_id: "shot_01" },
        { ...BASE_SHOT, shot_id: "shot_02", action: "Secondary shot action" },
      ],
    } as unknown as SceneNodeFrontendData
    const { onUpdate } = renderPanel(data)

    // The select for shot_01's extends_shot_id
    const select = screen.getByTestId("select-extends-shot_01")
    fireEvent.change(select, { target: { value: "shot_02" } })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [updateArg] = onUpdate.mock.calls[0]
    expect(updateArg.shots[0].extends_shot_id).toBe("shot_02")
    // The second shot should be unchanged.
    expect(updateArg.shots[1].shot_id).toBe("shot_02")
  })

  // ── Section 2: frame_interpolation ─────────────────────────────────────────

  it("renders 'Interpolation keyframes' section for frame_interpolation mode", () => {
    renderPanel(makeData("frame_interpolation"))
    expect(screen.getByText(/Interpolation keyframes/i)).toBeInTheDocument()
  })

  it("shows the 'Add keyframe' button", () => {
    renderPanel(makeData("frame_interpolation"))
    expect(screen.getByRole("button", { name: /add keyframe/i })).toBeInTheDocument()
  })

  it("adds a keyframe row when 'Add keyframe' is clicked", () => {
    const { onUpdate } = renderPanel(makeData("frame_interpolation"))
    fireEvent.click(screen.getByRole("button", { name: /add keyframe/i }))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [updateArg] = onUpdate.mock.calls[0]
    expect(updateArg.shots[0].interpolation_keyframes).toHaveLength(1)
    expect(updateArg.shots[0].interpolation_keyframes[0]).toEqual({
      timestamp_sec: 0,
      prompt: "",
    })
  })

  it("renders existing keyframe rows with timestamp and prompt inputs", () => {
    const data = makeData("frame_interpolation", {
      interpolation_keyframes: [
        { timestamp_sec: 0, prompt: "Opening frame" },
        { timestamp_sec: 2.5, prompt: "Midpoint frame" },
      ],
    })
    renderPanel(data)
    expect(
      screen.getByRole("spinbutton", { name: /Keyframe 1 timestamp/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("spinbutton", { name: /Keyframe 2 timestamp/i }),
    ).toBeInTheDocument()
  })

  it("removes a keyframe row when X button is clicked", () => {
    const data = makeData("frame_interpolation", {
      interpolation_keyframes: [
        { timestamp_sec: 0, prompt: "Opening frame" },
        { timestamp_sec: 2, prompt: "Second frame" },
      ],
    })
    const { onUpdate } = renderPanel(data)

    const removeButtons = screen.getAllByRole("button", { name: /Remove keyframe/i })
    fireEvent.click(removeButtons[0]) // remove first keyframe

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [updateArg] = onUpdate.mock.calls[0]
    expect(updateArg.shots[0].interpolation_keyframes).toHaveLength(1)
    expect(updateArg.shots[0].interpolation_keyframes[0].prompt).toBe("Second frame")
  })

  it("shows helper text for frame_interpolation", () => {
    renderPanel(makeData("frame_interpolation"))
    expect(screen.getByText(/Requires ≥2 keyframes/i)).toBeInTheDocument()
  })

  // ── Section 3: camera_path ──────────────────────────────────────────────────

  it("renders 'Camera path' select for camera_path mode", () => {
    renderPanel(makeData("camera_path"))
    expect(screen.getByText(/Camera path/i)).toBeInTheDocument()
  })

  it("renders all 5 path_kind options", () => {
    renderPanel(makeData("camera_path"))
    expect(screen.getByRole("option", { name: "Orbit" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Dolly" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Crane" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Arc" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Reveal" })).toBeInTheDocument()
  })

  it("renders Parameters (JSON) textarea for camera_path mode", () => {
    renderPanel(makeData("camera_path"))
    expect(screen.getByLabelText(/Parameters \(JSON\)/i)).toBeInTheDocument()
  })

  it("shows helper text for camera_path", () => {
    renderPanel(makeData("camera_path"))
    expect(screen.getByText(/Camera-path directive/i)).toBeInTheDocument()
  })

  it("calls onUpdate with new path_kind when select changes", () => {
    const { onUpdate } = renderPanel(makeData("camera_path"))
    const select = screen.getByTestId(`select-path-kind-shot_01`)
    fireEvent.change(select, { target: { value: "dolly" } })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [updateArg] = onUpdate.mock.calls[0]
    expect(updateArg.shots[0].camera_path_directive?.path_kind).toBe("dolly")
  })

  it("shows orbit hint when path_kind is 'orbit'", () => {
    renderPanel(
      makeData("camera_path", {
        camera_path_directive: { path_kind: "orbit" },
      }),
    )
    expect(screen.getByText(/degrees/i)).toBeInTheDocument()
  })
})

// ── Pipeline-managed vs. manually-placed gating (Bug 3) ──────────────────────

describe("SceneConfig pipeline-managed vs manual gating", () => {
  it("shows the read-only 'pipeline-managed' message when pipeline_owned=true", () => {
    const data = {
      ...makeData("first_frame"),
      pipeline_owned: true,
    } as unknown as SceneNodeFrontendData
    renderPanel(data)
    expect(screen.getByTestId("pipeline-managed-message")).toBeInTheDocument()
    // Editable label/description inputs MUST NOT be rendered.
    expect(screen.queryByLabelText(/^Label$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Description$/i)).not.toBeInTheDocument()
  })

  it("does NOT show the read-only message for a manually-placed scene (no pipeline_owned)", () => {
    renderPanel(makeData("first_frame"))
    expect(screen.queryByTestId("pipeline-managed-message")).not.toBeInTheDocument()
  })

  it("renders editable Label / Description / Beat / Duration inputs for a manual scene", () => {
    renderPanel(makeData("first_frame"))
    // Labels are wired to the inputs via htmlFor — getByLabelText resolves them.
    expect(screen.getByLabelText(/^Label$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Scene index/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Description$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Emotional beat/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Duration \(s\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Image model/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Video model/i)).toBeInTheDocument()
  })

  it("calls onUpdate when the Description textarea is edited (manual scene)", () => {
    const { onUpdate } = renderPanel(makeData("first_frame"))
    const desc = screen.getByLabelText(/^Description$/i)
    fireEvent.change(desc, { target: { value: "An updated description" } })
    expect(onUpdate).toHaveBeenCalledWith({ description: "An updated description" })
  })

  it("does NOT show the read-only message when pipeline_owned is undefined but pipeline_id is set", () => {
    // A stray `pipeline_id` alone (e.g. a half-initialized node) must NOT
    // silently lock the scene. Only `pipeline_owned === true` does.
    const data = {
      ...makeData("first_frame"),
      pipeline_id: "some-pipeline-uuid",
    } as unknown as SceneNodeFrontendData
    renderPanel(data)
    expect(screen.queryByTestId("pipeline-managed-message")).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Label$/i)).toBeInTheDocument()
  })

  it("hides the Helpers block on manually-placed scenes (backend routes require a parent pipeline)", () => {
    renderPanel(makeData("first_frame"))
    expect(screen.queryByTestId("scene-helper-buttons")).not.toBeInTheDocument()
  })

  it("shows the Helpers block on pipeline-managed scenes", () => {
    const data = {
      ...makeData("first_frame"),
      pipeline_owned: true,
    } as unknown as SceneNodeFrontendData
    renderPanel(data)
    expect(screen.getByTestId("scene-helper-buttons")).toBeInTheDocument()
  })
})
