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
  usePipelineEvents: vi.fn(() => ({ events: [], connected: false })),
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
})
