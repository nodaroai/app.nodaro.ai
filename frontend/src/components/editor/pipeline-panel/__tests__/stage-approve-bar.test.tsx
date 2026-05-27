import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { StageApproveBar } from "../stage-approve-bar"

describe("StageApproveBar", () => {
  it("renders the stage label and the approve button", () => {
    render(
      <StageApproveBar
        stageLabel="2. Characters"
        onApprove={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(screen.getByTestId("stage-approve-bar")).toBeInTheDocument()
    expect(screen.getByText(/2\. Characters/)).toBeInTheDocument()
    expect(screen.getByTestId("stage-approve-button")).toHaveTextContent(
      "Approve variants & continue",
    )
  })

  it("calls onApprove when the button is clicked", () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    render(<StageApproveBar stageLabel="2. Characters" onApprove={onApprove} />)

    fireEvent.click(screen.getByTestId("stage-approve-button"))

    expect(onApprove).toHaveBeenCalledOnce()
  })

  it("disables the button and shows progress while approving", async () => {
    let resolve!: () => void
    const onApprove = vi.fn(
      () => new Promise<void>((r) => { resolve = r }),
    )
    render(<StageApproveBar stageLabel="2. Characters" onApprove={onApprove} />)
    const btn = screen.getByTestId("stage-approve-button")

    fireEvent.click(btn)

    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn).toHaveTextContent("Approving…")

    resolve()
    await waitFor(() => expect(btn).not.toBeDisabled())
    expect(btn).toHaveTextContent("Approve variants & continue")
  })
})
