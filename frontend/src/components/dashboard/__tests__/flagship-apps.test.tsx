import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Coming-soon cards call sonner's toast on click; stub it (no Toaster in jsdom).
vi.mock("sonner", () => ({ toast: vi.fn() }))
// PreviewVideo is imported for media-backed cards, but the flagships ship without
// real media yet — stub it so the test doesn't pull in the video player.
vi.mock("@/components/ui/preview-video", () => ({ PreviewVideo: () => null }))

import { FlagshipApps } from "../flagship-apps"
import { studioBaseUrl } from "@/lib/studio"
import { voiceBaseUrl } from "@/lib/voice"

describe("FlagshipApps", () => {
  it("renders the two flagship products", () => {
    render(<FlagshipApps />)
    expect(screen.getByText("Studio")).toBeInTheDocument()
    expect(screen.getByText("Voice Changer Pro")).toBeInTheDocument()
    // Avatar was replaced by Voice Changer Pro (2026-07).
    expect(screen.queryByText("Avatar")).not.toBeInTheDocument()
  })

  it("renders Studio as a live external link to the studio home", () => {
    render(<FlagshipApps />)
    const link = screen.getByRole("link", { name: /Open Studio/i })
    expect(link).toHaveAttribute("href", studioBaseUrl())
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("renders Voice Changer Pro as a live external link to the voice app", () => {
    render(<FlagshipApps />)
    const link = screen.getByRole("link", { name: /Open Voice Changer Pro/i })
    expect(link).toHaveAttribute("href", voiceBaseUrl())
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("shows both flagships as live — no coming-soon card remains", () => {
    render(<FlagshipApps />)
    expect(screen.getAllByRole("link")).toHaveLength(2)
    expect(screen.getAllByText("Live")).toHaveLength(2)
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument()
    expect(screen.queryByText("Notify me")).not.toBeInTheDocument()
  })
})
