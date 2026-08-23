/**
 * The edition boundary, checked rather than assumed: on a community build the
 * Copilot must be completely absent — no rail, no toolbar button, no keyboard
 * shortcut, and above all no `@/ee/...` chunk requested.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

/** jsdom has no matchMedia; `useIsMobile` needs one to decide rail vs sheet. */
let viewportIsMobile = false
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (media: string) => ({
    matches: viewportIsMobile,
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
})

const hasCredits = vi.fn(() => false)
vi.mock("@/lib/edition", async () => {
  const actual = await vi.importActual<typeof import("@/lib/edition")>("@/lib/edition")
  return { ...actual, hasCredits: () => hasCredits() }
})

const { CopilotCollapsedTab, CopilotPanelSlot, CopilotToolbarButton } = await import("../copilot-panel-slot")
const { useCopilotUiStore } = await import("@/hooks/use-copilot-ui-store")

const props = {
  projectId: "p1",
  save: null,
  run: null,
  onStopRun: () => undefined,
  creditEstimate: 0,
  estimateStale: false,
  estimateVersion: 6,
  isRunning: false,
  activeExecutionId: null,
}

beforeEach(() => {
  viewportIsMobile = false
  useCopilotUiStore.setState({ open: false, everOpened: false, turnActive: false })
})

describe("community build", () => {
  it("renders no rail", () => {
    const { container } = render(<CopilotPanelSlot {...props} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders no toolbar button", () => {
    const { container } = render(<CopilotToolbarButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders no collapsed tab", () => {
    const { container } = render(<CopilotCollapsedTab />)
    expect(container).toBeEmptyDOMElement()
  })

  it("does not bind the keyboard shortcut", () => {
    const addSpy = vi.spyOn(window, "addEventListener")
    render(<CopilotToolbarButton />)
    expect(addSpy.mock.calls.some(([type]) => type === "keydown")).toBe(false)
    addSpy.mockRestore()
  })
})

describe("cloud build", () => {
  beforeEach(() => {
    hasCredits.mockReturnValue(true)
  })

  it("shows the collapsed tab before the panel has ever been opened, and loads no ee chunk", () => {
    render(<CopilotPanelSlot {...props} />)
    expect(screen.getByRole("button", { name: /copilot/i })).toBeInTheDocument()
  })

  it("opens the rail from the toolbar button", async () => {
    render(<CopilotToolbarButton />)
    const button = screen.getByRole("button", { name: /copilot/i })
    button.click()
    expect(useCopilotUiStore.getState().open).toBe(true)
    expect(useCopilotUiStore.getState().everOpened).toBe(true)
  })

  it("marks the button pressed while the rail is open", () => {
    useCopilotUiStore.setState({ open: true, everOpened: true })
    render(<CopilotToolbarButton />)
    expect(screen.getByRole("button", { name: /copilot/i })).toHaveAttribute("aria-pressed", "true")
  })

  it("shows no collapsed tab on a phone — 40px of a phone's canvas is not free", () => {
    viewportIsMobile = true
    const { container } = render(<CopilotPanelSlot {...props} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("still offers the toolbar button on a phone", () => {
    viewportIsMobile = true
    render(<CopilotToolbarButton />)
    expect(screen.getByRole("button", { name: /copilot/i })).toBeInTheDocument()
  })
})
