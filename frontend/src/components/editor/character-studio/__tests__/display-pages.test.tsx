import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { BoardPage } from "../pages/board-page"
import { EmotionVideosPage } from "../pages/emotion-videos-page"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"

const jobs = {} as CharacterStudioJobs
function state(staged: Record<string, unknown>): CharacterStudioState {
  return { staged } as unknown as CharacterStudioState
}

describe("BoardPage (display first)", () => {
  it("renders each board image with its name", () => {
    render(
      <BoardPage
        state={state({ boards: [{ name: "turnaround", url: "https://x/b.png" }] })}
        jobs={jobs}
      />,
    )
    expect(screen.getByText("turnaround")).toBeTruthy()
    expect(screen.getByRole("img", { name: "turnaround" })).toBeTruthy()
  })

  it("shows an empty state when there are no boards", () => {
    render(<BoardPage state={state({})} jobs={jobs} />)
    expect(screen.queryByText(/no reference boards/i)).not.toBeNull()
  })
})

describe("EmotionVideosPage (display first)", () => {
  it("renders a section per emotion with every clip", () => {
    const { container } = render(
      <EmotionVideosPage
        state={state({
          referenceVideosByVariant: {
            angry: ["https://x/a1.mp4", "https://x/a2.mp4"],
            happy: ["https://x/h.mp4"],
          },
        })}
        jobs={jobs}
      />,
    )
    expect(screen.getByText(/angry/i)).toBeTruthy()
    expect(screen.getByText(/happy/i)).toBeTruthy()
    // one <video> per clip across all emotions
    expect(container.querySelectorAll("video")).toHaveLength(3)
  })

  it("skips emotions with no clips and shows the empty state when none remain", () => {
    render(<EmotionVideosPage state={state({ referenceVideosByVariant: { sad: [] } })} jobs={jobs} />)
    expect(screen.queryByText(/no emotion videos/i)).not.toBeNull()
  })
})
