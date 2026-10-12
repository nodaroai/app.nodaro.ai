/**
 * Seedance Draft lever: shown only for a draft-capable model; ON writes the
 * draft flag AND 480p into the node's resolution field (so every editor quote
 * prices 480p); OFF clears only the flag.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  SeedanceDraftToggle,
  SeedanceDraftResolutionHint,
  hasStaleSeedanceDraft,
  isSeedanceDraftOn,
} from "../seedance-draft-toggle"

describe("SeedanceDraftToggle", () => {
  it("renders nothing for a model that cannot draft", () => {
    const { container } = render(
      <SeedanceDraftToggle provider="seedance-2-fast" draft={undefined} resolutionField="resolution" onUpdate={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("ON writes draft + 480p into the given resolution field", async () => {
    const onUpdate = vi.fn()
    render(<SeedanceDraftToggle provider="seedance-2-5" draft={undefined} resolutionField="v2vResolution" onUpdate={onUpdate} />)
    await userEvent.click(screen.getByRole("checkbox"))
    expect(onUpdate).toHaveBeenCalledWith({ draft: true, v2vResolution: "480p" })
  })

  it("OFF clears only the flag", async () => {
    const onUpdate = vi.fn()
    render(<SeedanceDraftToggle provider="seedance-2-5" draft={true} resolutionField="resolution" onUpdate={onUpdate} />)
    await userEvent.click(screen.getByRole("checkbox"))
    expect(onUpdate).toHaveBeenCalledWith({ draft: undefined })
  })

  it("the resolution hint shows only while a draft is on", () => {
    const { container, rerender } = render(<SeedanceDraftResolutionHint provider="seedance-2-5" draft={undefined} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<SeedanceDraftResolutionHint provider="seedance-2-5" draft={true} />)
    expect(container).not.toBeEmptyDOMElement()
  })
})

describe("draft predicates", () => {
  it("a draft flag on a model that cannot draft is stale", () => {
    expect(hasStaleSeedanceDraft("kling-3.0", true)).toBe(true)
    expect(hasStaleSeedanceDraft("seedance-2-5", true)).toBe(false)
    expect(hasStaleSeedanceDraft("kling-3.0", undefined)).toBe(false)
  })

  it("a draft is on only for a draft-capable model", () => {
    expect(isSeedanceDraftOn("seedance-2-5", true)).toBe(true)
    expect(isSeedanceDraftOn("seedance-2", true)).toBe(false)
    expect(isSeedanceDraftOn("seedance-2-5", undefined)).toBe(false)
  })
})
