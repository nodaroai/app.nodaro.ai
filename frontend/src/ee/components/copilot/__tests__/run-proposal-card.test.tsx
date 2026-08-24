/**
 * The card that IS the run confirmation.
 *
 * The editor's own confirm dialog is skipped when a run starts from here, so
 * everything that dialog would have said has to be on this card — including
 * which of the user's files the copilot attached while building the graph.
 * Approving a run is the moment they agree to spend credits on THIS graph, and
 * a file they cannot see was wired in is a thing they did not actually approve.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { RunProposalCard } from "../copilot-cards"
import type { CopilotWiredAsset } from "@/ee/lib/copilot/types"

function renderCard(wiredAssets: CopilotWiredAsset[]) {
  return render(
    <RunProposalCard
      estimate={42}
      estimateStale={false}
      nodeCount={3}
      balance={1000}
      overLimit={false}
      ceiling={500}
      wiredAssets={wiredAssets}
      onRun={vi.fn()}
      onSkip={vi.fn()}
    />,
  )
}

describe("RunProposalCard", () => {
  it("names every file the copilot attached", () => {
    renderCard([
      { id: "a", kind: "image", filename: "cat.png", nodeId: "up1" },
      { id: "b", kind: "video", filename: "clip.mp4", nodeId: "up2" },
    ])

    expect(screen.getByText("cat.png")).toBeTruthy()
    expect(screen.getByText("clip.mp4")).toBeTruthy()
  })

  it("names them rather than counting them", () => {
    // "1 file attached" does not tell anyone WHICH file they are about to spend
    // credits on, which is the only thing the line is for.
    renderCard([{ id: "a", kind: "image", filename: "cat.png", nodeId: "up1" }])

    expect(screen.queryByText(/1 file/i)).toBeNull()
    expect(screen.getByText("cat.png")).toBeTruthy()
  })

  it("says nothing at all when no file was wired", () => {
    const { container } = renderCard([])

    expect(container.querySelector("ul")).toBeNull()
    expect(screen.queryByText(/using your files/i)).toBeNull()
  })

  it("keeps showing the same file on two different nodes", () => {
    // One photo wired into two upload nodes is two things the run will use, and
    // collapsing them would hide that the second node is not empty.
    renderCard([
      { id: "a", kind: "image", filename: "cat.png", nodeId: "up1" },
      { id: "a", kind: "image", filename: "cat.png", nodeId: "up2" },
    ])

    expect(screen.getAllByText("cat.png")).toHaveLength(2)
  })

  it("still shows the estimate and the way out", () => {
    renderCard([{ id: "a", kind: "image", filename: "cat.png", nodeId: "up1" }])

    expect(screen.getByText(/42/)).toBeTruthy()
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(2)
  })
})
