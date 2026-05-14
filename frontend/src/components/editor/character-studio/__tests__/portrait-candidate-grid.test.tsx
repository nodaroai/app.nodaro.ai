import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PortraitCandidateGrid } from "../portrait-candidate-grid"

const baseProps = {
  characterId: "char-1",
  candidates: [],
  onGenerate: vi.fn(),
  onApprove: vi.fn(),
  onCancelCandidate: vi.fn(),
  cost: 6,
}

describe("PortraitCandidateGrid", () => {
  it("renders count chips 1/2/4 with default selection 1", () => {
    render(<PortraitCandidateGrid {...baseProps} />)
    expect(screen.getByRole("button", { name: /^1$/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: /^2$/ })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: /^4$/ })).toHaveAttribute("aria-pressed", "false")
  })

  it("Generate button shows cost × count", async () => {
    render(<PortraitCandidateGrid {...baseProps} cost={6} />)
    expect(screen.getByRole("button", { name: /generate · 6 cr/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /^4$/ }))
    expect(screen.getByRole("button", { name: /generate 4 · 24 cr/i })).toBeInTheDocument()
  })

  it("calls onGenerate with the selected count when Generate is clicked", async () => {
    const onGenerate = vi.fn()
    render(<PortraitCandidateGrid {...baseProps} onGenerate={onGenerate} />)
    await userEvent.click(screen.getByRole("button", { name: /^2$/ }))
    await userEvent.click(screen.getByRole("button", { name: /generate 2 · 12 cr/i }))
    expect(onGenerate).toHaveBeenCalledWith(2)
  })

  it("renders a card per candidate with status", () => {
    const candidates = [
      { jobId: "j1", status: "running" as const, progress: 30, url: undefined },
      { jobId: "j2", status: "completed" as const, progress: 100, url: "https://x/p2.png" },
    ]
    render(<PortraitCandidateGrid {...baseProps} candidates={candidates} />)
    expect(screen.getByAltText("candidate j2")).toBeInTheDocument()
    expect(screen.getByText(/30%/)).toBeInTheDocument()
  })

  it("clicking a completed candidate fires onApprove", async () => {
    const onApprove = vi.fn()
    const candidates = [{ jobId: "j2", status: "completed" as const, progress: 100, url: "https://x.png" }]
    render(<PortraitCandidateGrid {...baseProps} candidates={candidates} onApprove={onApprove} />)
    await userEvent.click(screen.getByRole("button", { name: /approve candidate j2/i }))
    expect(onApprove).toHaveBeenCalledWith("j2")
  })
})
