/**
 * The red dot's popup: names the new version, warns on majors, shows the
 * highlights and the exact upgrade commands with back-up-first ahead of them.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { UpdateDialog } from "../update-dialog"

const info = (current: string, version: string) => ({
  current,
  latest: {
    version,
    url: `https://github.com/nodaroai/app.nodaro.ai/releases/tag/${version}`,
    publishedAt: "2026-08-19T00:00:00Z",
    highlights: "## Breaking changes\n- credit re-denomination\n## Features\n- NODARO marks",
  },
  updateAvailable: true,
})

describe("UpdateDialog", () => {
  it("names both versions and renders the highlights as lines", () => {
    render(<UpdateDialog open onOpenChange={vi.fn()} info={info("1.23.0", "v1.24.0")} />)
    expect(screen.getByText("v1.24.0 is available")).toBeTruthy()
    expect(screen.getByText(/You are running v1\.23\.0/)).toBeTruthy()
    expect(screen.getByText("Breaking changes")).toBeTruthy()
    expect(screen.getByText("- NODARO marks")).toBeTruthy()
    expect(screen.queryByText(/major release/i)).toBeNull()
  })

  it("a major bump warns in red before anything else", () => {
    render(<UpdateDialog open onOpenChange={vi.fn()} info={info("1.23.0", "v2.0.0")} />)
    expect(screen.getByText(/This is a major release/)).toBeTruthy()
  })

  it("shows the upgrade commands with back-up-first — the backup is the only road back", () => {
    render(<UpdateDialog open onOpenChange={vi.fn()} info={info("1.23.0", "v2.0.0")} />)
    expect(screen.getByText(/docker compose .* pull nodaro/)).toBeTruthy()
    expect(screen.getByText(/Back up first/)).toBeTruthy()
  })
})
