/**
 * The release dialog (founder comp, 2026-08-19). Upgrade mode: changelog +
 * release/compare links on one side, the two numbered steps (back up first —
 * with the published guide linked — then pull+restart) and the backup
 * acknowledgment on the other. What's-new mode (cloud): changelog only —
 * no steps, no commands, nothing to act on.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { UpdateDialog } from "../update-dialog"

const info = (current: string, version: string) => ({
  current,
  latest: {
    version,
    url: `https://github.com/nodaroai/app.nodaro.ai/releases/tag/${version}`,
    publishedAt: "2026-08-19T00:00:00Z",
    highlights: "## Features\n- NODARO marks\n## Fixes\n- heap bump",
  },
  updateAvailable: true,
})

describe("UpdateDialog — upgrade mode (self-host)", () => {
  it("names both versions, renders the changelog, and links the release AND the compare view", () => {
    render(<UpdateDialog open onOpenChange={vi.fn()} info={info("1.23.0", "v1.26.0")} />)
    expect(screen.getByText("Upgrade to v1.26.0")).toBeTruthy()
    expect(screen.getByText(/You are running v1\.23\.0/)).toBeTruthy()
    expect(screen.getByText("Features")).toBeTruthy()
    expect(screen.getByText("– NODARO marks")).toBeTruthy()
    const release = screen.getByText(/Release v1\.26\.0 on GitHub/) as HTMLAnchorElement
    expect(release.href).toContain("/releases/tag/v1.26.0")
    const compare = screen.getByText(/Compare v1\.23\.0/) as HTMLAnchorElement
    expect(compare.href).toContain("/compare/v1.23.0...v1.26.0")
  })

  it("step 1 is BACK UP, linked to the published guide; step 2 carries the exact commands", () => {
    render(<UpdateDialog open onOpenChange={vi.fn()} info={info("1.23.0", "v1.26.0")} />)
    expect(screen.getByText("Back up your data")).toBeTruthy()
    const guide = screen.getByText(/Backup & restore guide/) as HTMLAnchorElement
    expect(guide.href).toBe("https://nodaroai.github.io/app.nodaro.ai/backup-restore")
    expect(screen.getByText(/docker compose .* pull nodaro/)).toBeTruthy()
    expect(screen.getByText(/only way\s+back to v1\.23\.0/)).toBeTruthy()
  })

  it("the backup acknowledgment checkbox marks step 1 done", () => {
    render(<UpdateDialog open onOpenChange={vi.fn()} info={info("1.23.0", "v1.26.0")} />)
    const box = screen.getByRole("checkbox") as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(box.checked).toBe(true)
  })

  it("a major bump warns in red; a dev current gets no compare link (no tag to compare from)", () => {
    render(<UpdateDialog open onOpenChange={vi.fn()} info={info("1.23.0-dev.abc", "v2.0.0")} />)
    expect(screen.getByText(/This is a major release/)).toBeTruthy()
    expect(screen.queryByText(/Compare/)).toBeNull()
  })
})

describe("UpdateDialog — what's-new mode (cloud)", () => {
  it("shows only the changelog: no steps, no commands, no compare, no running-version framing", () => {
    render(
      <UpdateDialog open onOpenChange={vi.fn()} info={info("1.23.0", "v1.26.0")} mode="whats-new" />,
    )
    expect(screen.getByText("What's new in v1.26.0")).toBeTruthy()
    expect(screen.getByText(/already live for you/)).toBeTruthy()
    expect(screen.getByText("– NODARO marks")).toBeTruthy()
    expect(screen.queryByText("Back up your data")).toBeNull()
    expect(screen.queryByText(/docker compose/)).toBeNull()
    expect(screen.queryByText(/Compare/)).toBeNull()
    expect(screen.queryByText(/You are running/)).toBeNull()
    expect(screen.getByText("Close")).toBeTruthy()
  })
})
