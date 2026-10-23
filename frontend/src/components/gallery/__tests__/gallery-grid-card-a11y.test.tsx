/**
 * A gallery card is reachable by keyboard and screen reader (WCAG 4.1.2,
 * 2.1.1): its own control is a real button BESIDE the favourite / report /
 * delete buttons, never wrapped around them, and the action buttons show when
 * the card has keyboard focus, not only on hover.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { axeViolations } from "@/test/axe"

vi.mock("@/components/ui/cached-image", () => ({ CachedImage: () => null }))
vi.mock("@/components/audio-player", () => ({ WaveformAudioPlayer: () => null }))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  isMultiUser: () => true,
}))
vi.mock("../gallery-media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gallery-media")>()
  return { ...actual, VideoCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }
})

import { GalleryGridCard } from "../gallery-grid-card"
import type { GalleryItem } from "@/hooks/queries/use-gallery-queries"

afterEach(cleanup)

const item: GalleryItem = {
  id: "j1",
  type: "video",
  jobName: "image-to-video",
  outputUrl: "https://media.test/clip.mp4",
  thumbnailUrl: null,
  createdAt: "2026-10-06T10:00:00Z",
  prompt: null,
  model: null,
}

function show(opts: { selecting?: boolean; selected?: boolean } = {}) {
  const onSelect = vi.fn()
  const onToggleSelected = vi.fn()
  const onToggleFavorite = vi.fn()
  const view = render(
    <GalleryGridCard
      item={item}
      index={3}
      isFavorited={false}
      showFavorite
      isAdmin
      selecting={opts.selecting ?? false}
      selected={opts.selected ?? false}
      onSelect={onSelect}
      onToggleSelected={onToggleSelected}
      onToggleFavorite={onToggleFavorite}
      onReport={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  return { ...view, onSelect, onToggleSelected, onToggleFavorite }
}

describe("gallery card accessibility", () => {
  it("opens the item from its own button, and the actions are not inside it", () => {
    const { onSelect, onToggleFavorite } = show()
    const open = screen.getByRole("button", { name: "View Video item" })
    expect(open.querySelector("button")).toBeNull()
    fireEvent.click(open)
    expect(onSelect).toHaveBeenCalledWith(3)
    fireEvent.click(screen.getByTitle("Add to favorites"))
    expect(onToggleFavorite).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("is a checkbox while selecting", () => {
    const { onToggleSelected } = show({ selecting: true, selected: true })
    const box = screen.getByRole("checkbox")
    expect(box).toHaveAttribute("aria-checked", "true")
    fireEvent.click(box)
    expect(onToggleSelected).toHaveBeenCalledWith(item)
  })

  it("shows the action buttons when the card has keyboard focus", () => {
    const { container } = show()
    const actions = screen.getByTitle("Add to favorites").parentElement as HTMLElement
    expect(actions.className).toContain("group-focus-within:opacity-100")
    expect(container.firstElementChild?.className).toContain("group")
  })

  it("passes the automated WCAG 2.0 A/AA checks", async () => {
    const { container } = show()
    expect(await axeViolations(container)).toEqual([])
  })
})
