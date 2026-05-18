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
  },
}))
vi.mock("@/hooks/use-pipeline-events", () => ({
  usePipelineEvents: vi.fn(() => ({ lastEvent: null, connected: false, drift: null })),
}))

import { pipelinesApi } from "@/lib/pipelines-api"

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
})
