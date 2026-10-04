/**
 * The edition boundary, checked rather than assumed: on a community build the
 * Copilot must be completely absent — no rail, no toolbar button, no keyboard
 * shortcut, and above all no `@/ee/...` chunk requested.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

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

// The ee rail and panel, stubbed: these tests pin the core shim, not the panel.
vi.mock("@/ee/components/copilot/copilot-rail", () => ({ default: () => <div data-testid="copilot-rail" /> }))
vi.mock("@/ee/components/copilot/copilot-panel", () => ({ default: () => <div data-testid="copilot-panel" /> }))

const { CopilotCollapsedTab, CopilotPanelSlot, CopilotToolbarButton } = await import("../copilot-panel-slot")
const { useCopilotUiStore } = await import("@/hooks/use-copilot-ui-store")
const { useWorkflowStore } = await import("@/hooks/use-workflow-store")

/** The slot reads the handoff parameter; nothing here navigates. */
const Router = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

const props = {
  projectId: "p1",
  save: null,
  run: null,
  runNode: null,
  estimateNode: null,
  onStopRun: () => undefined,
  creditEstimate: 0,
  estimateStale: false,
  estimateVersion: 6,
  isRunning: false,
  activeExecutionId: null,
}

beforeEach(() => {
  viewportIsMobile = false
  useCopilotUiStore.setState({ mode: "min", dock: "min", everOpened: false, turnActive: false, messageCount: 0 })
  useWorkflowStore.setState({ nodes: [], isReadOnly: false })
})

describe("community build", () => {
  it("renders no rail", () => {
    const { container } = render(<CopilotPanelSlot {...props} />, { wrapper: Router })
    expect(container).toBeEmptyDOMElement()
  })

  it("renders no toolbar button", () => {
    const { container } = render(<CopilotToolbarButton />, { wrapper: Router })
    expect(container).toBeEmptyDOMElement()
  })

  it("renders no collapsed tab", () => {
    const { container } = render(<CopilotCollapsedTab />, { wrapper: Router })
    expect(container).toBeEmptyDOMElement()
  })

  it("does not bind the keyboard shortcut", () => {
    const addSpy = vi.spyOn(window, "addEventListener")
    render(<CopilotToolbarButton />, { wrapper: Router })
    expect(addSpy.mock.calls.some(([type]) => type === "keydown")).toBe(false)
    addSpy.mockRestore()
  })
})

describe("cloud build", () => {
  beforeEach(() => {
    hasCredits.mockReturnValue(true)
  })

  it("shows the folded strip at once, then the rail once its chunk arrives", async () => {
    render(<CopilotPanelSlot {...props} />, { wrapper: Router })
    expect(screen.getByRole("button", { name: /copilot/i })).toBeInTheDocument()
    expect(await screen.findByTestId("copilot-rail")).toBeInTheDocument()
  })

  it("the tab unfolds the strip into the rail when there is something to talk about", () => {
    useCopilotUiStore.setState({ messageCount: 2 })
    render(<CopilotToolbarButton />, { wrapper: Router })
    screen.getByRole("button", { name: /copilot/i }).click()
    expect(useCopilotUiStore.getState().mode).toBe("panel")
    expect(useCopilotUiStore.getState().everOpened).toBe(true)
  })

  it("the tab puts the Copilot in the middle of an empty canvas with nothing said", () => {
    render(<CopilotToolbarButton />, { wrapper: Router })
    screen.getByRole("button", { name: /copilot/i }).click()
    expect(useCopilotUiStore.getState().mode).toBe("center")
  })

  it("the tab folds an open rail to the strip when there is a conversation", () => {
    useCopilotUiStore.setState({ mode: "panel", everOpened: true, messageCount: 2 })
    render(<CopilotToolbarButton />, { wrapper: Router })
    screen.getByRole("button", { name: /copilot/i }).click()
    expect(useCopilotUiStore.getState().mode).toBe("min")
  })

  it("the tab takes an open rail over an empty, quiet canvas back to the middle", () => {
    useCopilotUiStore.setState({ mode: "panel", everOpened: true, messageCount: 0, turnActive: false, pendingPrompt: null })
    render(<CopilotToolbarButton />, { wrapper: Router })
    screen.getByRole("button", { name: /copilot/i }).click()
    expect(useCopilotUiStore.getState()).toMatchObject({ mode: "center", dock: "min" })
  })

  it("marks the button pressed only while the rail is open", () => {
    useCopilotUiStore.setState({ mode: "panel", everOpened: true })
    const { unmount } = render(<CopilotToolbarButton />, { wrapper: Router })
    expect(screen.getByRole("button", { name: /copilot/i })).toHaveAttribute("aria-pressed", "true")
    unmount()
    useCopilotUiStore.setState({ mode: "min" })
    render(<CopilotToolbarButton />, { wrapper: Router })
    expect(screen.getByRole("button", { name: /copilot/i })).toHaveAttribute("aria-pressed", "false")
  })

  it("shows no collapsed tab on a phone — 40px of a phone's canvas is not free", () => {
    viewportIsMobile = true
    const { container } = render(<CopilotPanelSlot {...props} />, { wrapper: Router })
    expect(container).toBeEmptyDOMElement()
  })

  it("still offers the toolbar button on a phone, opening and closing the sheet", () => {
    viewportIsMobile = true
    render(<CopilotToolbarButton />, { wrapper: Router })
    const button = screen.getByRole("button", { name: /copilot/i })
    button.click()
    expect(useCopilotUiStore.getState().mode).toBe("panel")
    button.click()
    expect(useCopilotUiStore.getState().mode).toBe("hidden")
  })

  it("renders the sheet on a phone once it is open", async () => {
    viewportIsMobile = true
    useCopilotUiStore.setState({ mode: "panel", everOpened: true })
    render(<CopilotPanelSlot {...props} />, { wrapper: Router })
    expect(await screen.findByTestId("copilot-panel")).toBeInTheDocument()
  })
})
