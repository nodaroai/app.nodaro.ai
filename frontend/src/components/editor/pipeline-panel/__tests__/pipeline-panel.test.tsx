import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PipelinePanel } from "../pipeline-panel"

vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    get: vi.fn(),
    getStage: vi.fn(),
    approveStage: vi.fn(),
    rejectStage: vi.fn(),
    cancel: vi.fn(),
    eventsUrl: vi.fn(() => "/events"),
    branch: vi.fn(),
    patchMode: vi.fn(),
    fetchChat: vi.fn().mockResolvedValue({ turns: [] }),
    postChat: vi.fn(),
    applyChat: vi.fn(),
  },
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))
vi.mock("@/hooks/use-pipeline-events", () => ({
  usePipelineEvents: vi.fn(() => ({
    lastEvent: null,
    connected: false,
    drift: null,
    currentSubGate: null,
  })),
}))

import { pipelinesApi } from "@/lib/pipelines-api"
import { toast } from "sonner"

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const fakeAwaiting = {
  status: "awaiting_approval",
  output: {
    plan: {
      title: "Mock Title",
      logline: "x",
      scenes: [
        { scene_index: 1, description: "open shot", duration_seconds: 20 },
        { scene_index: 2, description: "climax", duration_seconds: 30 },
      ],
    },
  },
  critic_feedback: {},
} as never

describe("PipelinePanel", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders Stage 1 in awaiting_approval with title + scenes + Approve/Reject", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "awaiting_approval", current_stage: "script",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue(fakeAwaiting)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByText("Mock Title")).toBeInTheDocument())
    expect(screen.getByText(/1\. Script/)).toBeInTheDocument()
    expect(screen.getByText("Approve")).toBeInTheDocument()
    expect(screen.getByText("Reject")).toBeInTheDocument()
  })

  it("calls approveStage on Approve click", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "awaiting_approval", current_stage: "script",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue(fakeAwaiting)
    ;(pipelinesApi.approveStage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)
    await waitFor(() => screen.getByText("Approve"))
    await userEvent.click(screen.getByText("Approve"))
    expect(pipelinesApi.approveStage).toHaveBeenCalledWith("p1", "script")
  })

  it("renders Characters entity grid when stage is characters", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "characters",
      spent_credits: 35, reserved_credits: 100, upfront_credit_estimate: 100,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "approved", output: {}, critic_feedback: {},
    })
    // Mock the entities fetch via fetch since usePipelineEntities uses native fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "e1", entity_type: "character", entity_key: "hero",
          status: "awaiting_approval", main_asset_id: "a1", main_asset_url: "https://r2/hero.png",
          metadata: { name: "Hero" }, variants: [],
        },
      ],
    } as never)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByText("Hero")).toBeInTheDocument())
    expect(screen.getByText("Approve")).toBeInTheDocument()
  })

  // ── Phase 1D.3 C1: Re-run from here ─────────────────────────────────────
  it("renders 'Re-run from here' on each stage when pipeline is completed", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "completed", current_stage: null,
      spent_credits: 100, reserved_credits: 0, upfront_credit_estimate: 100,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "approved", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /re-run from here/i })).toHaveLength(8)
    )
  })

  it("hides 'Re-run from here' section when pipeline status is 'running'", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script",
      spent_credits: 10, reserved_credits: 50, upfront_credit_estimate: 50,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    // Wait for the pipeline to load
    await waitFor(() => expect(screen.queryByText("running")).toBeInTheDocument())
    expect(screen.queryByText("Re-run from here")).not.toBeInTheDocument()
  })

  it("calls pipelinesApi.branch with the right stage name on click", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "completed", current_stage: null,
      spent_credits: 100, reserved_credits: 0, upfront_credit_estimate: 100,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "approved", output: {}, critic_feedback: {},
    })
    ;(pipelinesApi.branch as ReturnType<typeof vi.fn>).mockResolvedValue({
      pipelineId: "p2", clonedStages: [], clonedEntities: [],
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() =>
      expect(screen.getByTestId("rerun-btn-scene_images")).toBeInTheDocument()
    )
    await userEvent.click(screen.getByTestId("rerun-btn-scene_images"))
    await waitFor(() =>
      expect(pipelinesApi.branch).toHaveBeenCalledWith("p1", "scene_images")
    )
    expect(toast.success).toHaveBeenCalled()
  })

  // ── Phase 1D.3 D1: Branch lineage breadcrumb ─────────────────────────────
  it("shows breadcrumb when pipeline is branched", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: "p0", branched_from_stage: "shot_list",
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() =>
      expect(screen.getByTestId("branch-lineage-breadcrumb")).toBeInTheDocument()
    )
    expect(screen.getByText("Branched from")).toBeInTheDocument()
    expect(screen.getByText("original pipeline")).toBeInTheDocument()
    expect(screen.getByText("(at shot_list)")).toBeInTheDocument()
  })

  it("hides breadcrumb when pipeline is not branched", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("running")).toBeInTheDocument())
    expect(screen.queryByTestId("branch-lineage-breadcrumb")).not.toBeInTheDocument()
  })

  it("invokes onNavigateToPipeline with the parent pipeline id on breadcrumb link click", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: "p0", branched_from_stage: "shot_list",
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    const onNavigate = vi.fn()
    renderWithClient(
      <PipelinePanel pipelineId="p1" onClose={() => undefined} onNavigateToPipeline={onNavigate} />
    )

    await waitFor(() => expect(screen.getByText("original pipeline")).toBeInTheDocument())
    await userEvent.click(screen.getByText("original pipeline"))
    expect(onNavigate).toHaveBeenCalledWith("p0")
  })

  // ── Phase 1D.2a §4.5 K2: Auto/Guided badge + critic-failure surface ─────
  it("renders the Auto Mode badge when pipeline.mode === 'auto'", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script", mode: "auto",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("mode-badge-auto")).toBeInTheDocument())
    expect(screen.queryByTestId("mode-badge-guided")).not.toBeInTheDocument()
  })

  it("renders the Guided badge when pipeline.mode === 'guided'", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script", mode: "guided",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("mode-badge-guided")).toBeInTheDocument())
    expect(screen.queryByTestId("mode-badge-auto")).not.toBeInTheDocument()
  })

  it("renders neither badge when pipeline.mode === 'manual'", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script", mode: "manual",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("running")).toBeInTheDocument())
    expect(screen.queryByTestId("mode-badge-auto")).not.toBeInTheDocument()
    expect(screen.queryByTestId("mode-badge-guided")).not.toBeInTheDocument()
  })

  it("hides Approve/Reject on Stage 1 when pipeline.mode === 'auto'", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "awaiting_approval", current_stage: "script", mode: "auto",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue(fakeAwaiting)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    // The plan still renders (so the user can see what the orchestrator is
    // approving on their behalf) — but the explicit gate buttons don't.
    await waitFor(() => expect(screen.getByText("Mock Title")).toBeInTheDocument())
    expect(screen.queryByText("Approve")).not.toBeInTheDocument()
    expect(screen.queryByText("Reject")).not.toBeInTheDocument()
  })

  it("mounts ModeSwitchButton when mode='auto' AND status='running'", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script", mode: "auto",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByTestId("mode-switch-button")).toBeInTheDocument())
  })

  it("renders the critic-failure surface for failed + _unresolvable failure reason", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "failed", current_stage: "script", mode: "auto",
      failure_reason: "script_critic_unresolvable",
      spent_credits: 12, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "failed", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() =>
      expect(screen.getByTestId("critic-failure-surface")).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/Auto Mode failed: script_critic_unresolvable/i),
    ).toBeInTheDocument()
  })

  it("does NOT render the critic-failure surface when failure_reason is not _unresolvable", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "failed", current_stage: "script", mode: "manual",
      failure_reason: "user_cancelled",
      spent_credits: 12, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "failed", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("failed")).toBeInTheDocument())
    expect(screen.queryByTestId("critic-failure-surface")).not.toBeInTheDocument()
  })

  // ── Phase 1D.2b M1: ChatPanel mount conditional ──────────────────────────
  it("mounts ChatPanel when mode='guided' AND script stage is awaiting_approval", async () => {
    // ChatPanel auto-collapses below 1280px viewport; force a wide one so
    // it renders in expanded form for this assertion.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1600,
    })
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "awaiting_approval", current_stage: "script", mode: "guided",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue(fakeAwaiting)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByTestId("chat-panel")).toBeInTheDocument())
  })

  it("does NOT mount ChatPanel when mode='manual'", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "awaiting_approval", current_stage: "script", mode: "manual",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue(fakeAwaiting)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByText("Mock Title")).toBeInTheDocument())
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("chat-panel-collapsed")).not.toBeInTheDocument()
  })

  it("does NOT mount ChatPanel when mode='auto' (auto-mode has its own critic loop)", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "awaiting_approval", current_stage: "script", mode: "auto",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue(fakeAwaiting)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.getByText("Mock Title")).toBeInTheDocument())
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("chat-panel-collapsed")).not.toBeInTheDocument()
  })

  it("does NOT mount ChatPanel when guided but stage status is 'running'", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1", status: "running", current_stage: "script", mode: "guided",
      spent_credits: 5, reserved_credits: 30, upfront_credit_estimate: 30,
      branched_from_pipeline_id: null, branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running", output: {}, critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("running")).toBeInTheDocument())
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("chat-panel-collapsed")).not.toBeInTheDocument()
  })

  // ── Phase 1D.2c D1: ChatPanel mount at post_merge ───────────────────────
  it("mounts ChatPanel when mode='guided' AND post_merge stage is awaiting_approval", async () => {
    // ChatPanel auto-collapses below 1280px viewport; force wide.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1600,
    })
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "awaiting_approval",
      current_stage: "post_merge",
      mode: "guided",
      spent_credits: 200,
      reserved_credits: 250,
      upfront_credit_estimate: 250,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    // The chat mount uses postMergeStageQuery.status, NOT the legacy
    // script-status path; mock per-stage so post_merge returns
    // awaiting_approval (the gate) and script returns approved (so it
    // doesn't accidentally satisfy the script-side mount).
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_pipelineId: string, stage: string) => {
        if (stage === "post_merge") {
          return {
            status: "awaiting_approval",
            output: { final_output_url: "https://r2/final.mp4" },
            critic_feedback: {},
          }
        }
        return { status: "approved", output: {}, critic_feedback: {} }
      },
    )

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() =>
      expect(screen.queryByTestId("chat-panel")).toBeInTheDocument(),
    )
    // Header label uses the stage prop — "Post merge chat" confirms the
    // post_merge stage value was threaded all the way down to ChatPanel.
    expect(screen.getByText(/post merge chat/i)).toBeInTheDocument()
  })

  it("does NOT mount ChatPanel at post_merge when mode='manual' (chat is guided-only)", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "awaiting_approval",
      current_stage: "post_merge",
      mode: "manual",
      spent_credits: 200,
      reserved_credits: 250,
      upfront_credit_estimate: 250,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "awaiting_approval",
      output: { final_output_url: "https://r2/final.mp4" },
      critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("awaiting_approval")).toBeInTheDocument())
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("chat-panel-collapsed")).not.toBeInTheDocument()
  })

  it("does NOT mount ChatPanel at post_merge when stage is still running", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "running",
      current_stage: "post_merge",
      mode: "guided",
      spent_credits: 200,
      reserved_credits: 250,
      upfront_credit_estimate: 250,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running",
      output: {},
      critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("running")).toBeInTheDocument())
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("chat-panel-collapsed")).not.toBeInTheDocument()
  })

  // ── Phase 1D.2c follow-up: postMergeStageQuery includes completed ────────
  it("fetches post_merge stage when pipeline is completed (re-opened panel against finished pipeline)", async () => {
    // Mirrors sceneImagesStageQuery's enabled gate — re-opening the panel
    // after a pipeline completes still needs to hydrate the post_merge stage
    // so the chat artifact + final video are available.
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "completed",
      current_stage: null,
      mode: "guided",
      spent_credits: 200,
      reserved_credits: 0,
      upfront_credit_estimate: 250,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_pipelineId: string, stage: string) => {
        return {
          status: stage === "post_merge" ? "approved" : "approved",
          output: {},
          critic_feedback: {},
        }
      },
    )

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    // Wait for the pipeline + initial stage fetches to settle.
    await waitFor(() =>
      expect(pipelinesApi.getStage).toHaveBeenCalledWith("p1", "post_merge"),
    )
  })

  it("renders SceneGrid when current_stage is shot_list", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "running",
      current_stage: "shot_list",
      spent_credits: 80,
      reserved_credits: 200,
      upfront_credit_estimate: 200,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "approved",
      output: {},
      critic_feedback: {},
    })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "scene-1",
          entity_type: "scene",
          entity_key: "scene_01",
          status: "awaiting_approval",
          main_asset_id: null,
          main_asset_url: null,
          metadata: {
            entity_type: "scene",
            scene_node_data: {
              scene_index: 1,
              description: "Hero on the runway",
              emotional_beat: "setup",
              duration_seconds: 30,
              shots: [
                { shot_id: "shot_01", duration_seconds: 10, camera: { shot_type: "wide" } },
              ],
              video_model: "kling",
              shot_input_mode: "first_frame",
            },
          },
          variants: [],
        },
      ],
    } as never)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByText("Hero on the runway")).toBeInTheDocument())
    expect(screen.getByText("Approve")).toBeInTheDocument()
  })

  // ── Phase 1D.2c-b-i — Storyboard Cohesion banner mount ───────────────────
  it("mounts StoryboardCohesionBanner when scene_images stage output carries storyboard_cohesion_*", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "running",
      current_stage: "scene_images",
      mode: "manual",
      spent_credits: 60,
      reserved_credits: 200,
      upfront_credit_estimate: 200,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    // Per-stage response: the script poll returns the awaiting fixture; the
    // scene_images poll returns the cohesion verdict that drives the banner.
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_pipelineId: string, stage: string) => {
        if (stage === "scene_images") {
          return {
            status: "running",
            output: {
              storyboard_cohesion_findings: [
                {
                  severity: "warning",
                  category: "character_inconsistency",
                  affected_scenes: [2, 4],
                  description:
                    "Alice wears a red dress in scene 2 but blue in scene 4.",
                  suggested_action:
                    "Re-generate scene 4 with the scene 2 wardrobe reference.",
                },
              ],
              storyboard_cohesion_assessment: "minor_issues",
              storyboard_cohesion_score: 6,
              storyboard_cohesion_summary:
                "Mostly cohesive — one wardrobe mismatch.",
            },
            critic_feedback: {},
          }
        }
        return { status: "approved", output: {}, critic_feedback: {} }
      },
    )

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() =>
      expect(
        screen.getByTestId("storyboard-cohesion-banner"),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText("Storyboard Cohesion")).toBeInTheDocument()
    expect(
      screen.getByText("Mostly cohesive — one wardrobe mismatch."),
    ).toBeInTheDocument()
    expect(screen.getByText("character_inconsistency")).toBeInTheDocument()
    // assessment="minor_issues" — Branch CTA should NOT render.
    expect(
      screen.queryByTestId("storyboard-cohesion-branch-btn"),
    ).not.toBeInTheDocument()
  })

  it("does NOT mount StoryboardCohesionBanner when scene_images output lacks storyboard_cohesion_* fields", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "running",
      current_stage: "scene_images",
      mode: "manual",
      spent_credits: 60,
      reserved_credits: 200,
      upfront_credit_estimate: 200,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    // scene_images output exists but is empty — the critic hasn't run yet,
    // or it bailed (the integration is best-effort, so we don't fail Stage 6
    // on a critic LLM error — see scene-images-storyboard-cohesion.test.ts).
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running",
      output: {},
      critic_feedback: {},
    })

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("running")).toBeInTheDocument())
    expect(
      screen.queryByTestId("storyboard-cohesion-banner"),
    ).not.toBeInTheDocument()
  })

  // ── Phase 1D.2c-b-ii I1: VideoCriticSummaryBanner mount ─────────────────────

  it("mounts VideoCriticSummaryBanner when Stage 7 is awaiting_approval and a shot is video_critic_failed", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "running",
      current_stage: "animate_audio_edit",
      mode: "manual",
      spent_credits: 120,
      reserved_credits: 240,
      upfront_credit_estimate: 240,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    // Stage 7 is paused at awaiting_approval — the trigger for the banner.
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_pipelineId: string, stage: string) => {
        if (stage === "animate_audio_edit") {
          return { status: "awaiting_approval", output: {}, critic_feedback: {} }
        }
        return { status: "approved", output: {}, critic_feedback: {} }
      },
    )
    // Scene-entities endpoint: one scene with one failed shot + one passing.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "scene_uuid_01",
          entity_type: "scene",
          entity_key: "scene_01",
          status: "awaiting_approval",
          main_asset_id: null,
          main_asset_url: null,
          metadata: {
            scene_node_data: {
              scene_index: 1,
              shots: [
                {
                  shot_id: "shot_01",
                  video_critic_failed: false,
                  video_critic_findings: [],
                },
                {
                  shot_id: "shot_02",
                  video_critic_failed: true,
                  video_critic_findings: [
                    {
                      severity: "blocking",
                      category: "wrong_action",
                      description: "Hero stands still",
                      suggested_fix: "Re-render with sprint prompt",
                    },
                  ],
                  video_critic_identified_action:
                    "Hero stands still — but the prompt asked for a sprint",
                },
              ],
            },
          },
          variants: [],
        },
      ],
    } as never)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() =>
      expect(
        screen.getByTestId("video-critic-summary-banner"),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText("Video Critic")).toBeInTheDocument()
    expect(
      screen.getByTestId("video-critic-summary-count"),
    ).toHaveTextContent("1 shot need review")
    expect(screen.getByText(/Scene 1, Shot 2/)).toBeInTheDocument()
    expect(
      screen.getByText(
        /Hero stands still — but the prompt asked for a sprint/,
      ),
    ).toBeInTheDocument()
  })

  it("does NOT mount VideoCriticSummaryBanner when no shot is video_critic_failed", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "running",
      current_stage: "animate_audio_edit",
      mode: "manual",
      spent_credits: 120,
      reserved_credits: 240,
      upfront_credit_estimate: 240,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "awaiting_approval",
      output: {},
      critic_feedback: {},
    })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "scene_uuid_01",
          entity_type: "scene",
          entity_key: "scene_01",
          status: "approved",
          main_asset_id: null,
          main_asset_url: null,
          metadata: {
            scene_node_data: {
              scene_index: 1,
              shots: [
                { shot_id: "shot_01", video_critic_failed: false },
                { shot_id: "shot_02", video_critic_failed: false },
              ],
            },
          },
          variants: [],
        },
      ],
    } as never)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("running")).toBeInTheDocument())
    // Give the entities fetch + derive a tick to settle, then assert no banner.
    expect(
      screen.queryByTestId("video-critic-summary-banner"),
    ).not.toBeInTheDocument()
  })

  it("does NOT mount VideoCriticSummaryBanner when failing shots exist but Stage 7 is still running (not awaiting_approval)", async () => {
    ;(pipelinesApi.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      status: "running",
      current_stage: "animate_audio_edit",
      mode: "manual",
      spent_credits: 120,
      reserved_credits: 240,
      upfront_credit_estimate: 240,
      branched_from_pipeline_id: null,
      branched_from_stage: null,
    })
    // Stage 7 still running — the banner should stay hidden so it doesn't
    // flash before retries finish.
    ;(pipelinesApi.getStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "running",
      output: {},
      critic_feedback: {},
    })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "scene_uuid_01",
          entity_type: "scene",
          entity_key: "scene_01",
          status: "generating",
          main_asset_id: null,
          main_asset_url: null,
          metadata: {
            scene_node_data: {
              scene_index: 1,
              shots: [
                {
                  shot_id: "shot_02",
                  video_critic_failed: true,
                  video_critic_findings: [
                    {
                      severity: "blocking",
                      category: "wrong_action",
                      description: "Hero stands still",
                      suggested_fix: "Re-render",
                    },
                  ],
                },
              ],
            },
          },
          variants: [],
        },
      ],
    } as never)

    renderWithClient(<PipelinePanel pipelineId="p1" onClose={() => undefined} />)

    await waitFor(() => expect(screen.queryByText("running")).toBeInTheDocument())
    expect(
      screen.queryByTestId("video-critic-summary-banner"),
    ).not.toBeInTheDocument()
  })
})
