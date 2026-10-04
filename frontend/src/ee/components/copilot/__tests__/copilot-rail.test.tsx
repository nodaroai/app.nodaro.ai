/**
 * The docked Copilot on a desktop: the strip when folded (with the number of
 * replies), the panel once opened, and the conversation size it reports to the
 * canvas, which decides from it whether the Copilot may return to the middle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const conversation = { messages: 0, replies: 0, known: true }
vi.mock("@/ee/hooks/copilot/use-copilot-thread", () => ({
  useCopilotConversationSize: () => conversation,
}))
const centerAllowed = vi.fn(() => false)
vi.mock("@/components/editor/workflow-editor/copilot-placement", async (orig) => ({
  ...(await orig<typeof import("@/components/editor/workflow-editor/copilot-placement")>()),
  useCopilotCenterAllowed: () => centerAllowed(),
}))
vi.mock("../copilot-panel", () => ({
  default: ({ onClose, onMinimize }: { onClose: () => void; onMinimize: () => void }) => (
    <div data-testid="panel">
      <button type="button" onClick={onMinimize}>fold</button>
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}))

const CopilotRail = (await import("../copilot-rail")).default
const { useCopilotUiStore, COPILOT_RAIL_WIDTH, COPILOT_TAB_WIDTH } = await import("@/hooks/use-copilot-ui-store")

const props = {
  projectId: "p1",
  save: vi.fn(),
  run: vi.fn(),
  runNode: vi.fn(),
  estimateNode: vi.fn(),
  onStopRun: vi.fn(),
  creditEstimate: 0,
  estimateStale: false,
  estimateVersion: null,
  isRunning: false,
  activeExecutionId: null,
} as unknown as React.ComponentProps<typeof CopilotRail>

beforeEach(() => {
  Object.assign(conversation, { messages: 0, replies: 0, known: true })
  centerAllowed.mockReturnValue(false)
  useCopilotUiStore.setState({
    mode: "min",
    dock: "min",
    everOpened: false,
    messageCount: 0,
    conversationKnown: false,
    turnActive: false,
    pendingPrompt: null,
    returnToCenterWhenEmpty: true,
  })
})
afterEach(cleanup)

const railWidth = (container: HTMLElement) => (container.firstElementChild as HTMLElement).style.width

describe("the folded strip", () => {
  it("shows the number of the Copilot's replies, in words for a screen reader", () => {
    Object.assign(conversation, { messages: 6, replies: 3 })
    render(<CopilotRail {...props} />)
    const strip = screen.getByRole("button", { name: "Open Copilot, 3 replies" })
    expect(strip).toHaveTextContent("3")
  })

  it("names only the action while nothing has been said", () => {
    render(<CopilotRail {...props} />)
    expect(screen.getByRole("button", { name: "Open Copilot" })).toBeInTheDocument()
  })

  it("unfolds into the panel, which folds back and closes", async () => {
    const { container } = render(<CopilotRail {...props} />)
    expect(railWidth(container)).toBe(`${COPILOT_TAB_WIDTH}px`)
    fireEvent.click(screen.getByRole("button", { name: "Open Copilot" }))
    expect(await screen.findByTestId("panel")).toBeInTheDocument()
    expect(railWidth(container)).toBe(`${COPILOT_RAIL_WIDTH}px`)

    fireEvent.click(screen.getByRole("button", { name: "fold" }))
    expect(useCopilotUiStore.getState().mode).toBe("min")
    // Kept mounted while folded, so the draft and the scroll survive.
    expect(screen.getByTestId("panel")).toBeInTheDocument()

    act(() => useCopilotUiStore.getState().openPanel())
    fireEvent.click(screen.getByRole("button", { name: "close" }))
    expect(useCopilotUiStore.getState().mode).toBe("hidden")
    expect(railWidth(container)).toBe("0px")
  })
})

describe("folding or closing over an empty canvas", () => {
  const openRail = () => {
    act(() => useCopilotUiStore.getState().openPanel())
  }

  it("takes the Copilot back to the middle when nothing was said, remembering how it was left", async () => {
    centerAllowed.mockReturnValue(true)
    render(<CopilotRail {...props} />)
    openRail()
    fireEvent.click(await screen.findByRole("button", { name: "fold" }))
    expect(useCopilotUiStore.getState()).toMatchObject({ mode: "center", dock: "min" })

    openRail()
    fireEvent.click(screen.getByRole("button", { name: "close" }))
    expect(useCopilotUiStore.getState()).toMatchObject({ mode: "center", dock: "hidden" })
  })

  it("folds to the strip when there is a conversation", async () => {
    centerAllowed.mockReturnValue(true)
    conversation.messages = 2
    render(<CopilotRail {...props} />)
    openRail()
    fireEvent.click(await screen.findByRole("button", { name: "fold" }))
    expect(useCopilotUiStore.getState().mode).toBe("min")
  })

  it("folds to the strip while a message is being answered, before the history has it", async () => {
    centerAllowed.mockReturnValue(true)
    render(<CopilotRail {...props} />)
    openRail()
    act(() => useCopilotUiStore.getState().setTurnActive(true))
    fireEvent.click(await screen.findByRole("button", { name: "fold" }))
    expect(useCopilotUiStore.getState().mode).toBe("min")
  })

  it("does as asked when the person switched returning off", async () => {
    centerAllowed.mockReturnValue(true)
    useCopilotUiStore.setState({ returnToCenterWhenEmpty: false })
    render(<CopilotRail {...props} />)
    openRail()
    fireEvent.click(await screen.findByRole("button", { name: "close" }))
    expect(useCopilotUiStore.getState().mode).toBe("hidden")
  })
})

describe("what the canvas learns from it", () => {
  it("reports the conversation's size and whether it is known yet", () => {
    conversation.messages = 2
    render(<CopilotRail {...props} />)
    const ui = useCopilotUiStore.getState()
    expect(ui.messageCount).toBe(2)
    expect(ui.conversationKnown).toBe(true)
  })
})
