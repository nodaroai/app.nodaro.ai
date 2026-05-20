import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ModeSwitchButton } from "../mode-switch-button"

vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    patchMode: vi.fn(),
  },
}))

import { pipelinesApi } from "@/lib/pipelines-api"

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe("ModeSwitchButton", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders 'Switch to Manual' when mode='auto' AND status='running'", () => {
    renderWithClient(
      <ModeSwitchButton pipelineId="p1" mode="auto" status="running" onSwitched={() => undefined} />,
    )
    expect(screen.getByText("Switch to Manual")).toBeInTheDocument()
  })

  it("renders 'Switch to Manual' when mode='guided' AND status='awaiting_approval'", () => {
    renderWithClient(
      <ModeSwitchButton
        pipelineId="p1"
        mode="guided"
        status="awaiting_approval"
        onSwitched={() => undefined}
      />,
    )
    expect(screen.getByText("Switch to Manual")).toBeInTheDocument()
  })

  it("does NOT render when mode='manual'", () => {
    renderWithClient(
      <ModeSwitchButton pipelineId="p1" mode="manual" status="running" onSwitched={() => undefined} />,
    )
    expect(screen.queryByText("Switch to Manual")).not.toBeInTheDocument()
  })

  it("does NOT render when status='failed' regardless of mode", () => {
    renderWithClient(
      <ModeSwitchButton pipelineId="p1" mode="auto" status="failed" onSwitched={() => undefined} />,
    )
    expect(screen.queryByText("Switch to Manual")).not.toBeInTheDocument()
  })

  it("does NOT render when status='completed' regardless of mode", () => {
    renderWithClient(
      <ModeSwitchButton pipelineId="p1" mode="auto" status="completed" onSwitched={() => undefined} />,
    )
    expect(screen.queryByText("Switch to Manual")).not.toBeInTheDocument()
  })

  it("does NOT render when mode is undefined", () => {
    renderWithClient(
      <ModeSwitchButton pipelineId="p1" mode={undefined} status="running" onSwitched={() => undefined} />,
    )
    expect(screen.queryByText("Switch to Manual")).not.toBeInTheDocument()
  })

  it("calls pipelinesApi.patchMode + invokes onSwitched on click", async () => {
    ;(pipelinesApi.patchMode as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, mode: "manual" })
    const onSwitched = vi.fn()
    renderWithClient(
      <ModeSwitchButton pipelineId="p1" mode="auto" status="running" onSwitched={onSwitched} />,
    )
    await userEvent.click(screen.getByText("Switch to Manual"))
    await waitFor(() => expect(pipelinesApi.patchMode).toHaveBeenCalledWith("p1", "manual"))
    await waitFor(() => expect(onSwitched).toHaveBeenCalled())
  })

  it("disables the button while the mutation is pending", async () => {
    let resolveIt: ((v: { ok: true; mode: "manual" }) => void) | undefined
    ;(pipelinesApi.patchMode as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<{ ok: true; mode: "manual" }>((resolve) => {
          resolveIt = resolve
        }),
    )
    renderWithClient(
      <ModeSwitchButton pipelineId="p1" mode="auto" status="running" onSwitched={() => undefined} />,
    )
    const btn = screen.getByTestId("mode-switch-button") as HTMLButtonElement
    await userEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn).toHaveTextContent("Switching…")
    resolveIt?.({ ok: true, mode: "manual" })
  })
})
