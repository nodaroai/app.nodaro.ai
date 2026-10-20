import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { UseCaseCamerasSummary } from "../use-case-cameras-summary"

afterEach(() => cleanup())

describe("the review's cameras summary (decided 2026-10-17)", () => {
  it("one line per speaker: their camera, or the wide shot", () => {
    render(<UseCaseCamerasSummary report={{ speakers: [{ speaker: "speaker_1", ordinal: 1, camera: 2, marginDb: 7 }, { speaker: "speaker_0", ordinal: 2, camera: null, marginDb: null }], syncNotes: [], mapNotes: [] }} />)
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Speaker 1: Camera 2", "Speaker 2: Wide shot"])
  })
  it("no report, or one with no speakers: nothing", () => {
    const { container } = render(<UseCaseCamerasSummary report={undefined} />)
    expect(container).toBeEmptyDOMElement()
    render(<UseCaseCamerasSummary report={{ speakers: [], syncNotes: ["x"], mapNotes: [] }} />)
    expect(screen.queryByTestId("use-case-cameras-summary")).toBeNull()
  })
})
