import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (p: any) => <img data-testid="cached-image" src={p.src} alt={p.alt} onClick={p.onClick} />,
}))

import { ResultsThumbnailsPanel } from "../results-thumbnails-panel"

const results = [
  { text: "first result", jobId: "j1" },
  { text: "second result", jobId: "j2" },
]

describe("ResultsThumbnailsPanel — text mode", () => {
  it("renders one selectable tile per text result (no images)", () => {
    render(
      <ResultsThumbnailsPanel results={results} activeIndex={0} mediaType="text" nodeSelected={false} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText("Switch to result 1")).toBeInTheDocument()
    expect(screen.getByLabelText("Switch to result 2")).toBeInTheDocument()
    expect(screen.queryByTestId("cached-image")).not.toBeInTheDocument()
  })

  it("calls onSelect with the tile index when a tile is clicked", () => {
    const onSelect = vi.fn()
    render(
      <ResultsThumbnailsPanel results={results} activeIndex={0} mediaType="text" nodeSelected={false} onSelect={onSelect} />,
    )
    fireEvent.click(screen.getByLabelText("Switch to result 2"))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it("calls onDelete with the tile index when its delete affordance is clicked", () => {
    const onDelete = vi.fn()
    render(
      <ResultsThumbnailsPanel results={results} activeIndex={0} mediaType="text" nodeSelected={false} onSelect={() => {}} onDelete={onDelete} />,
    )
    fireEvent.click(screen.getByLabelText("Delete result 2"))
    expect(onDelete).toHaveBeenCalledWith(1)
  })
})
