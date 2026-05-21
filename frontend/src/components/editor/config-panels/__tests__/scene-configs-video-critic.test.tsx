import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SceneConfig } from "../scene-configs"
import type { SceneNodeFrontendData } from "@/types/nodes"
import type { VideoCriticVerdict } from "@nodaro/shared"

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
  Button: ({ children, onClick, disabled, title, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} title={title} {...props}>
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

const mockSkipShotVideoCriticFailure = vi.fn()
const mockRetryShotVideoGeneration = vi.fn()
vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    acceptMatchCutBreak: vi.fn(),
    skipShotVideoCriticFailure: (...args: unknown[]) =>
      mockSkipShotVideoCriticFailure(...args),
    retryShotVideoGeneration: (...args: unknown[]) =>
      mockRetryShotVideoGeneration(...args),
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

type IssueRecord = VideoCriticVerdict["issues"][number]

const PASSING_FINDING: IssueRecord = {
  severity: "warning",
  category: "visual_artifacts",
  description: "Mild banding in sky gradient",
  suggested_fix: "Lower compression / re-render",
}

const BLOCKING_FINDING: IssueRecord = {
  severity: "blocking",
  category: "motion_glitch",
  description: "Hero's right hand snaps between frames 12 and 13",
  suggested_fix: "Re-generate with steadier motion prompt",
}

function makeDataWithShot(shotPatch: Record<string, unknown> = {}): SceneNodeFrontendData {
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
    shots: [{ ...BASE_SHOT, ...shotPatch }],
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

describe("SceneConfig video-critic findings surface (Phase 1D.2c-b-ii)", () => {
  beforeEach(() => {
    mockSkipShotVideoCriticFailure.mockReset()
    mockRetryShotVideoGeneration.mockReset()
  })

  // ── Test 1: no findings → nothing rendered ─────────────────────────────────

  it("does not render the video-critic block when no findings are present", () => {
    renderPanel(makeDataWithShot())

    expect(screen.queryByTestId("video-critic-shot_01")).not.toBeInTheDocument()
    expect(screen.queryByText(/Video Critic/i)).not.toBeInTheDocument()
  })

  // ── Test 2: passing critic renders informational ──────────────────────────

  it("renders the block with pass styling when findings exist and video_critic_failed=false", () => {
    renderPanel(
      makeDataWithShot({
        video_critic_findings: [PASSING_FINDING],
        video_critic_failed: false,
        video_critic_score: 8,
        video_critic_identified_action: "Hero walks toward camera in a wide shot",
      }),
    )

    const block = screen.getByTestId("video-critic-shot_01")
    expect(block).toBeInTheDocument()
    expect(screen.getByText("Video Critic")).toBeInTheDocument()
    expect(screen.getByText(/Pass · 8\/10/)).toBeInTheDocument()
    // The identified-action text lives inside the video-critic block
    expect(block.textContent ?? "").toMatch(/Hero walks toward camera/i)
    expect(screen.getByText("warning")).toBeInTheDocument()
    expect(screen.getByText("visual_artifacts")).toBeInTheDocument()
    expect(screen.getByText(/Mild banding/i)).toBeInTheDocument()
    expect(screen.getByText(/Fix: Lower compression/i)).toBeInTheDocument()

    // No Skip / Regenerate buttons when not failed
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument()
  })

  // ── Test 3: failed critic renders wired Skip + Regenerate buttons (J1) ────

  it("renders Skip and Regenerate buttons (enabled, wired) when video_critic_failed=true", () => {
    renderPanel(
      makeDataWithShot({
        video_critic_findings: [BLOCKING_FINDING],
        video_critic_failed: true,
        video_critic_score: 3,
        video_critic_continuity_score: 4,
        video_critic_retry_count: 1,
        video_critic_last_attempted_url: "https://example.com/last.mp4",
      }),
    )

    expect(screen.getByTestId("video-critic-shot_01")).toBeInTheDocument()
    expect(screen.getByText(/Failed · 3\/10/)).toBeInTheDocument()
    expect(screen.getByText(/continuity 4\/10/)).toBeInTheDocument()
    expect(screen.getByText(/Retries used: 1/i)).toBeInTheDocument()
    expect(screen.getByText("blocking")).toBeInTheDocument()
    expect(screen.getByText("motion_glitch")).toBeInTheDocument()

    // Skip + Regenerate buttons rendered, enabled (pipelineId + sceneEntityId
    // are present in the test data), no placeholder tooltip.
    const skipBtn = screen.getByRole("button", { name: /skip/i })
    const regenBtn = screen.getByRole("button", { name: /regenerate/i })
    expect(skipBtn).toBeInTheDocument()
    expect(regenBtn).toBeInTheDocument()
    expect(skipBtn).not.toBeDisabled()
    expect(regenBtn).not.toBeDisabled()
  })

  // ── Test 4: multiple findings render in order ─────────────────────────────

  it("renders multiple findings in array order", () => {
    renderPanel(
      makeDataWithShot({
        video_critic_findings: [BLOCKING_FINDING, PASSING_FINDING],
        video_critic_failed: true,
        video_critic_score: 4,
      }),
    )

    const blockingDesc = screen.getByText(/Hero's right hand snaps/i)
    const warningDesc = screen.getByText(/Mild banding/i)
    expect(blockingDesc).toBeInTheDocument()
    expect(warningDesc).toBeInTheDocument()

    // Document order check: blocking appears before warning
    const docHtml = document.body.innerHTML
    expect(docHtml.indexOf("Hero's right hand")).toBeLessThan(
      docHtml.indexOf("Mild banding"),
    )
  })

  // ── Test 5: continuity_score null → no continuity chip ────────────────────

  it("does not render the continuity chip when video_critic_continuity_score is null", () => {
    renderPanel(
      makeDataWithShot({
        video_critic_findings: [],
        video_critic_failed: false,
        video_critic_score: 9,
        video_critic_continuity_score: null,
      }),
    )

    expect(screen.queryByText(/continuity/i)).not.toBeInTheDocument()
  })

  // ── Test 6: Skip button calls skipShotVideoCriticFailure + flips flag ─────

  it("calls skipShotVideoCriticFailure and flips video_critic_failed to false", async () => {
    mockSkipShotVideoCriticFailure.mockResolvedValueOnce({ ok: true })

    const { onUpdate } = renderPanel(
      makeDataWithShot({
        video_critic_findings: [BLOCKING_FINDING],
        video_critic_failed: true,
        video_critic_score: 3,
      }),
    )

    fireEvent.click(screen.getByRole("button", { name: /skip/i }))

    expect(mockSkipShotVideoCriticFailure).toHaveBeenCalledWith(
      "pipe_01",
      "entity_01",
      "shot_01",
    )

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1)
    })

    const [updateArg] = onUpdate.mock.calls[0]
    expect(updateArg.shots[0].video_critic_failed).toBe(false)
    // Findings preserved (audit trail mirrors the server-side behavior).
    expect(updateArg.shots[0].video_critic_findings).toBeDefined()
    expect(updateArg.shots[0].video_critic_score).toBe(3)
  })

  // ── Test 7: Regenerate button calls retryShotVideoGeneration + strips fields

  it("calls retryShotVideoGeneration and strips every video_critic_* field", async () => {
    mockRetryShotVideoGeneration.mockResolvedValueOnce({ ok: true })

    const { onUpdate } = renderPanel(
      makeDataWithShot({
        video_critic_findings: [BLOCKING_FINDING],
        video_critic_failed: true,
        video_critic_score: 3,
        video_critic_continuity_score: 5,
        video_critic_retry_count: 2,
        video_critic_last_attempted_url: "https://example.com/last.mp4",
        // Non-critic field that must survive.
        motion_prompt: "steady walk",
      }),
    )

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }))

    expect(mockRetryShotVideoGeneration).toHaveBeenCalledWith(
      "pipe_01",
      "entity_01",
      "shot_01",
    )

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1)
    })

    const [updateArg] = onUpdate.mock.calls[0]
    const patchedShot = updateArg.shots[0]
    // All video_critic_* gone.
    for (const key of Object.keys(patchedShot)) {
      expect(key.startsWith("video_critic_")).toBe(false)
    }
    // Non-critic field preserved.
    expect(patchedShot.shot_id).toBe("shot_01")
    expect(patchedShot.motion_prompt).toBe("steady walk")
    expect(patchedShot.action).toBe("Hero walks toward camera")
  })

  // ── Test 8: buttons disabled when pipelineId / sceneEntityId missing ──────

  it("disables Skip / Regenerate buttons when pipelineId is missing", () => {
    // Strip pipeline_id from the test data to simulate a not-yet-wired scene.
    const data = makeDataWithShot({
      video_critic_findings: [BLOCKING_FINDING],
      video_critic_failed: true,
    })
    ;(data as unknown as { pipeline_id: string | undefined }).pipeline_id = undefined

    renderPanel(data)

    const skipBtn = screen.getByRole("button", { name: /skip/i })
    const regenBtn = screen.getByRole("button", { name: /regenerate/i })
    expect(skipBtn).toBeDisabled()
    expect(regenBtn).toBeDisabled()
  })
})
