import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { StageProgressBanner } from "../stage-progress-banner"

describe("StageProgressBanner", () => {
  it("renders the stage label + message", () => {
    render(
      <StageProgressBanner
        stageName="script"
        message="Drafting plan (3.4 KB so far)…"
      />,
    )
    const banner = screen.getByTestId("stage-progress-banner")
    expect(banner).toBeInTheDocument()
    expect(screen.getByText("Stage 1 — Script")).toBeInTheDocument()
    expect(screen.getByText(/Drafting plan/)).toBeInTheDocument()
  })

  it("uses the correct label for each stage", () => {
    const { rerender } = render(
      <StageProgressBanner stageName="characters" message="..." />,
    )
    expect(screen.getByText("Stage 2 — Characters")).toBeInTheDocument()

    rerender(<StageProgressBanner stageName="animate_audio_edit" message="..." />)
    expect(screen.getByText("Stage 7 — Animate & Audio")).toBeInTheDocument()

    rerender(<StageProgressBanner stageName="post_merge" message="..." />)
    expect(screen.getByText("Stage 8 — Final Merge")).toBeInTheDocument()
  })

  it("renders a spinner icon", () => {
    const { container } = render(
      <StageProgressBanner stageName="script" message="Starting…" />,
    )
    // lucide-react renders <svg class="... animate-spin ...">
    const spinner = container.querySelector(".animate-spin")
    expect(spinner).not.toBeNull()
  })
})
