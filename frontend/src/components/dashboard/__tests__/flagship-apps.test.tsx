import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Avatar's "Notify me" click calls sonner's toast; stub it (no Toaster in jsdom).
vi.mock("sonner", () => ({ toast: vi.fn() }))
// PreviewVideo is imported for media-backed cards, but the flagships ship without
// real media yet — stub it so the test doesn't pull in the video player.
vi.mock("@/components/ui/preview-video", () => ({ PreviewVideo: () => null }))

import { FlagshipApps } from "../flagship-apps"
import { studioBaseUrl } from "@/lib/studio"

describe("FlagshipApps", () => {
  it("renders the two flagship products", () => {
    render(<FlagshipApps />)
    expect(screen.getByText("Studio")).toBeInTheDocument()
    expect(screen.getByText("Avatar")).toBeInTheDocument()
  })

  it("renders Studio as a live external link to the studio home", () => {
    render(<FlagshipApps />)
    const link = screen.getByRole("link", { name: /Studio/i })
    expect(link).toHaveAttribute("href", studioBaseUrl())
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.getByText("Live")).toBeInTheDocument()
    expect(screen.getByText("Open Studio")).toBeInTheDocument()
  })

  it("renders Avatar as a coming-soon button, not a link", () => {
    render(<FlagshipApps />)
    // Avatar has no href, so it renders as a <button> — Studio is the only link.
    expect(screen.getAllByRole("link")).toHaveLength(1)
    expect(screen.getByRole("button", { name: /Avatar/i })).toBeInTheDocument()
    expect(screen.getByText("Coming soon")).toBeInTheDocument()
    expect(screen.getByText("Notify me")).toBeInTheDocument()
  })
})
