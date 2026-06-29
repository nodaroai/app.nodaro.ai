import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SunoMixPopover } from "../suno-mix-popover"
import { QuickStripOpenChangeContext } from "../node-quick-strip"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

// The popover reads `setQuickStripPinned` from the real (singleton) store. Each
// pin-assertion test swaps in a spy and restores the real setter + clears the
// pin after, so nothing leaks between tests.
const realSetPin = useWorkflowStore.getState().setQuickStripPinned
afterEach(() => {
  useWorkflowStore.setState({ setQuickStripPinned: realSetPin, quickStripPinnedNodeId: null })
})

describe("SunoMixPopover", () => {
  it("renders a Mix trigger", () => {
    render(<SunoMixPopover nodeId="n1" />)
    expect(screen.getByLabelText("Mix")).toBeInTheDocument()
  })
  it("opens to show the 3 sliders with descriptions", async () => {
    render(<SunoMixPopover nodeId="n1" />)
    await userEvent.click(screen.getByLabelText("Mix"))
    expect(await screen.findByText("Style Weight")).toBeInTheDocument()
    expect(screen.getByText("How literally Suno follows your Style tags.")).toBeInTheDocument()
    expect(screen.getByText("Audio Weight")).toBeInTheDocument()
  })

  // Single-writer routing: inside a NodeQuickStrip the popover must compose into
  // the strip's openCount via the context handler and NEVER touch the pin store
  // directly (the dual-writer race + double-count this fix removes).
  it("routes open/close through the NodeQuickStrip context and never writes the pin directly", async () => {
    const stripOnOpenChange = vi.fn()
    const pinSpy = vi.fn()
    useWorkflowStore.setState({ setQuickStripPinned: pinSpy })

    render(
      <QuickStripOpenChangeContext.Provider value={stripOnOpenChange}>
        <SunoMixPopover nodeId="n1" />
      </QuickStripOpenChangeContext.Provider>,
    )

    // Open → routes `true` through the strip handler, not the pin store.
    await userEvent.click(screen.getByLabelText("Mix"))
    expect(await screen.findByText("Style Weight")).toBeInTheDocument()
    expect(stripOnOpenChange).toHaveBeenCalledWith(true)
    expect(pinSpy).not.toHaveBeenCalled() // no direct pin write, no double-count

    // Close → routes `false` through the same handler; still never the pin store.
    await userEvent.keyboard("{Escape}")
    expect(stripOnOpenChange).toHaveBeenCalledWith(false)
    expect(pinSpy).not.toHaveBeenCalled()
  })

  // Standalone (no NodeQuickStrip provider, e.g. a unit render): the popover must
  // still pin the strip itself so the hover toolbar can't hide mid-adjust.
  it("falls back to writing the pin directly when no NodeQuickStrip provider is present", async () => {
    const pinSpy = vi.fn()
    useWorkflowStore.setState({ setQuickStripPinned: pinSpy })

    render(<SunoMixPopover nodeId="n1" />)

    await userEvent.click(screen.getByLabelText("Mix"))
    expect(await screen.findByText("Style Weight")).toBeInTheDocument()
    expect(pinSpy).toHaveBeenCalledWith("n1")

    await userEvent.keyboard("{Escape}")
    expect(pinSpy).toHaveBeenCalledWith(null)
  })
})
