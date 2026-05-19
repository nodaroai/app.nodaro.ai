import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SceneConfig } from "../scene-configs"
import type { SceneNodeFrontendData } from "@/types/nodes"
import type { MatchCutVerdict, ShotSpec } from "@nodaro/shared"

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
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
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

// Mock the pipelinesApi — only the acceptMatchCutBreak call is tested here.
const mockAcceptMatchCutBreak = vi.fn()
vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    acceptMatchCutBreak: (...args: unknown[]) => mockAcceptMatchCutBreak(...args),
  },
}))

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

const MATCH_CUT_SHOT = {
  ...BASE_SHOT,
  shot_id: "shot_01",
  shot_intent: { ...BASE_SHOT.shot_intent, is_match_cut: true },
  keyframe_url: "https://example.com/shot01.jpg",
}

const NEXT_SHOT = {
  ...BASE_SHOT,
  shot_id: "shot_02",
  action: "Villain turns around",
  keyframe_url: "https://example.com/shot02.jpg",
}

function makeDataWithMatchCut(
  shotOverride: Partial<ShotSpec> = {},
): SceneNodeFrontendData {
  return {
    scene_index: 1,
    description: "Test scene",
    emotional_beat: "tension",
    duration_seconds: 10,
    shot_input_mode: "first_frame",
    cast_keys: [],
    location_key: "loc_01",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "flux-1.1-pro",
    video_model: "kling-1.6",
    shots: [
      { ...MATCH_CUT_SHOT, ...shotOverride },
      { ...NEXT_SHOT },
    ],
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
    pipeline_id: "pipe_01",
    pipeline_entity_id: "entity_01",
  } as unknown as SceneNodeFrontendData
}

const STRONG_VERDICT: MatchCutVerdict = {
  shot_pair: ["shot_01", "shot_02"],
  match_strength: "strong",
  suggested_adjustments: "No changes needed.",
  checked_at: "2026-05-20T00:00:00.000Z",
}

const BREAK_VERDICT: MatchCutVerdict = {
  shot_pair: ["shot_01", "shot_02"],
  match_strength: "break",
  suggested_adjustments: "Consider adjusting framing for continuity.",
  checked_at: "2026-05-20T00:00:00.000Z",
}

function renderPanel(
  data: SceneNodeFrontendData,
  stageOutput?: { match_cut_verdicts?: Record<string, MatchCutVerdict> },
) {
  const onUpdate = vi.fn()
  render(
    <SceneConfig
      data={data}
      onUpdate={onUpdate}
      stageOutput={stageOutput}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />,
  )
  return { onUpdate }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SceneConfig match-cut verdict surface (Phase 1D.1)", () => {
  beforeEach(() => {
    mockAcceptMatchCutBreak.mockReset()
  })

  // ── Test 1: side-by-side thumbnails ─────────────────────────────────────────

  it("renders side-by-side thumbnails for is_match_cut shots", () => {
    renderPanel(makeDataWithMatchCut(), {
      match_cut_verdicts: { shot_01: STRONG_VERDICT },
    })

    const images = screen.getAllByRole("img")
    const shot01Img = images.find((img) => img.getAttribute("src") === "https://example.com/shot01.jpg")
    const shot02Img = images.find((img) => img.getAttribute("src") === "https://example.com/shot02.jpg")

    expect(shot01Img).toBeDefined()
    expect(shot02Img).toBeDefined()
  })

  // ── Test 2: red chip + accept button when match_strength=break ──────────────

  it("shows 'break' chip and Accept break button when match_strength=break", () => {
    renderPanel(makeDataWithMatchCut(), {
      match_cut_verdicts: { shot_01: BREAK_VERDICT },
    })

    // Red chip with 'break' text
    expect(screen.getByText("break")).toBeInTheDocument()
    // Accept break button visible
    expect(screen.getByRole("button", { name: /accept break/i })).toBeInTheDocument()
    // Suggested adjustments text
    expect(
      screen.getByText(/Consider adjusting framing for continuity/i),
    ).toBeInTheDocument()
  })

  // ── Test 3: calls acceptMatchCutBreak on button click ───────────────────────

  it("calls acceptMatchCutBreak when Accept break button is clicked", async () => {
    mockAcceptMatchCutBreak.mockResolvedValueOnce({ ok: true, pendingRemaining: 0 })

    const { onUpdate } = renderPanel(makeDataWithMatchCut(), {
      match_cut_verdicts: { shot_01: BREAK_VERDICT },
    })

    fireEvent.click(screen.getByRole("button", { name: /accept break/i }))

    expect(mockAcceptMatchCutBreak).toHaveBeenCalledWith("pipe_01", "entity_01", "shot_01")

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1)
    })

    const [updateArg] = onUpdate.mock.calls[0]
    expect(updateArg.shots[0].accepted_match_cut_break).toBe(true)
  })

  // ── Test 4: shows 'Break accepted' pill when accepted_match_cut_break=true ──

  it("shows 'Break accepted' pill when accepted_match_cut_break is true", () => {
    renderPanel(
      makeDataWithMatchCut({ accepted_match_cut_break: true }),
      { match_cut_verdicts: { shot_01: BREAK_VERDICT } },
    )

    expect(screen.getByText(/break accepted/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /accept break/i })).not.toBeInTheDocument()
  })

  // ── Bonus test: pending state when stageOutput has no verdict ───────────────

  it("shows pending text when stageOutput is absent", () => {
    renderPanel(makeDataWithMatchCut())

    expect(screen.getByText(/pending critic verdict/i)).toBeInTheDocument()
  })
})
