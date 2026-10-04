/**
 * A render smoke test for the rail. The engine tests cover what a turn DOES;
 * this covers the thing they cannot — that the panel mounts at all, shows the
 * right face for each state, and that the composer is genuinely unavailable on
 * a read-only workflow rather than merely styled as if it were.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const workflowState = {
  workflowId: "wf-1" as string | null,
  isReadOnly: false,
  isDirty: false,
  loadedVersion: 6 as number | null,
  nodes: [] as unknown[],
}

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: typeof workflowState) => unknown) => selector(workflowState),
    { getState: () => workflowState, setState: vi.fn() },
  ),
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "asi@nodaro.ai", user_metadata: {} } }),
}))
vi.mock("@/hooks/queries/use-assets-queries", () => ({
  useCharacters: () => ({ data: [{ id: "c1", name: "Maya", sourceImageUrl: null }] }),
  useObjects: () => ({ data: [] }),
  useCreatures: () => ({ data: [] }),
  useLocations: () => ({ data: [] }),
  useLibraryInfinite: () => ({ data: { pages: [] }, isLoading: false }),
}))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 900 }))
vi.mock("@/ee/hooks/copilot/use-copilot-thread", () => ({
  useCopilotThreadForWorkflow: () => ({ thread: null, loading: false }),
  useCopilotHistory: () => ({ thread: null, messages: [] }),
  useCopilotSettings: () => ({ mutate: vi.fn() }),
}))
vi.mock("@/ee/lib/copilot/turn-engine", () => ({
  sendCopilotMessage: vi.fn(async () => {}),
  stopCopilotTurn: vi.fn(),
  teardownCopilot: vi.fn(),
  startProposedRun: vi.fn(),
  skipProposedRun: vi.fn(),
  reportRunOutcome: vi.fn(),
  noteExecutionStarted: vi.fn(),
  askForFix: vi.fn(),
}))

const CopilotPanel = (await import("../copilot-panel")).default
const { useCopilotStore } = await import("@/ee/lib/copilot/turn-store")
const { useCopilotUiStore } = await import("@/hooks/use-copilot-ui-store")
const { sendCopilotMessage } = await import("@/ee/lib/copilot/turn-engine")

const props = {
  onClose: vi.fn(),
  onMinimize: vi.fn(),
  projectId: "p1",
  save: vi.fn(async () => ({ success: true })),
  run: vi.fn(async () => ({ executionId: "exec-1" })),
  runNode: vi.fn(async () => ({ started: true })),
  estimateNode: vi.fn(() => 7),
  onStopRun: vi.fn(),
  creditEstimate: 12,
  estimateStale: false,
  estimateVersion: 6,
  isRunning: false,
  activeExecutionId: null,
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
      <CopilotPanel {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(workflowState, { workflowId: "wf-1", isReadOnly: false, isDirty: false, nodes: [] })
  useCopilotStore.setState({
    threadId: null,
    workflowId: "wf-1",
    streaming: false,
    runMode: "ask",
    autoRunLimit: 100,
    runPhase: "idle",
    draft: "",
    mentions: [],
    notice: null,
    turn: { ...useCopilotStore.getState().turn, status: "idle" },
  })
})

describe("arriving from the middle of the canvas", () => {
  it("says it moved when the person started building by hand", () => {
    workflowState.nodes = [{ id: "n1" }]
    renderPanel()
    expect(screen.getByText("Copilot moved here")).toBeInTheDocument()
    expect(screen.queryByText("Hey asi")).toBeNull()
  })

  it("sends the message typed in the middle once it is up, and only once", async () => {
    useCopilotUiStore.setState({ pendingPrompt: { text: "A 15-second product ad", workflowId: "wf-1", sentAt: Date.now() } })
    renderPanel()
    expect(sendCopilotMessage).toHaveBeenCalledTimes(1)
    expect(sendCopilotMessage).toHaveBeenCalledWith("A 15-second product ad")
    await waitFor(() => expect(useCopilotUiStore.getState().pendingPrompt).toBeNull())
    expect(sendCopilotMessage).toHaveBeenCalledTimes(1)
  })

  it("keeps the message pending until the send settles, so the canvas knows something was said", async () => {
    let finish: () => void = () => {}
    vi.mocked(sendCopilotMessage).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const prompt = { text: "A logo animation", workflowId: "wf-1", sentAt: Date.now() }
    useCopilotUiStore.setState({ pendingPrompt: prompt })
    renderPanel()
    expect(useCopilotUiStore.getState().pendingPrompt).toBe(prompt)
    finish()
    await waitFor(() => expect(useCopilotUiStore.getState().pendingPrompt).toBeNull())
  })

  it("shows what was sent at once, while the save and the handshake run", () => {
    vi.mocked(sendCopilotMessage).mockImplementationOnce(() => new Promise<void>(() => {}))
    useCopilotUiStore.setState({ pendingPrompt: { text: "A logo animation", workflowId: "wf-1", sentAt: Date.now() } })
    renderPanel()
    expect(screen.getByText("A logo animation")).toBeInTheDocument()
    expect(screen.queryByText("Hey asi")).toBeNull()
  })

  it("puts the sentence back in the box when the send is refused before its turn begins", async () => {
    useCopilotUiStore.setState({ pendingPrompt: { text: "A logo animation", workflowId: "wf-1", sentAt: Date.now() } })
    renderPanel()
    await waitFor(() => expect(useCopilotUiStore.getState().pendingPrompt).toBeNull())
    expect(useCopilotStore.getState().draft).toBe("A logo animation")
  })

  it("never sends a message typed for another workflow", () => {
    useCopilotUiStore.setState({ pendingPrompt: { text: "Build it", workflowId: "wf-other", sentAt: Date.now() } })
    renderPanel()
    expect(sendCopilotMessage).not.toHaveBeenCalled()
    expect(useCopilotUiStore.getState().pendingPrompt).toBeNull()
  })
})

describe("the header's own controls", () => {
  it("folds the rail and puts it away", () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Minimize Copilot" }))
    expect(props.onMinimize).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Close Copilot" }))
    expect(props.onClose).toHaveBeenCalled()
  })
})

describe("the empty rail", () => {
  it("greets the user and offers openers", () => {
    renderPanel()
    expect(screen.getByText("Hey asi")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create a product shot workflow/i })).toBeInTheDocument()
  })

  it("sends the suggestion the user clicks", () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /turn a script into a narrated video/i }))
    expect(sendCopilotMessage).toHaveBeenCalledWith("Turn a script into a narrated video")
  })

  it("states what this MESSAGE can cost before the user commits to sending it", () => {
    renderPanel()
    // A ceiling, not a price — the tooltip carries the rest of that sentence.
    expect(screen.getByText(/up to ~900 CR/)).toBeInTheDocument()
    expect(screen.getByTitle(/billed for what the assistant actually uses/i)).toBeInTheDocument()
  })

  it("states in words what the current mode will do about spending", () => {
    renderPanel()
    // The composer says it with the settings closed; the settings say it too.
    expect(screen.getByText("nothing runs without your OK")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Copilot settings" }))
    expect(screen.getByText("asks before running")).toBeInTheDocument()
  })

  it("keeps its settings behind the header button, which names the current choice", () => {
    renderPanel()
    expect(screen.queryByRole("radio", { name: "Auto" })).toBeNull()
    const button = screen.getByRole("button", { name: "Copilot settings" })
    expect(button.textContent).toContain("Ask")
    expect(button.textContent).toContain("Smart")
  })

  it("shows the ceiling as an editable field, dimmed while Ask is on", () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Copilot settings" }))
    const ceiling = screen.getByLabelText(/auto-run credit limit/i)
    expect(ceiling).toHaveValue("100")
    expect(ceiling.closest("div")).toHaveClass("opacity-45")
  })

  it("switches the promise when Auto is picked", () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Copilot settings" }))
    fireEvent.click(screen.getByRole("radio", { name: "Auto" }))
    expect(screen.getByText("runs on its own")).toBeInTheDocument()
    expect(screen.getByText("auto-runs up to ~100 credits")).toBeInTheDocument()
  })
})

describe("the editor bridge", () => {
  it("keeps one stable run callback that always calls the editor's LATEST closure", () => {
    const first = vi.fn(async () => ({ executionId: "exec-1" }))
    const second = vi.fn(async () => ({ executionId: "exec-1" }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <MemoryRouter>
      <QueryClientProvider client={client}>
        <CopilotPanel {...props} run={first} creditEstimate={10} />
        </QueryClientProvider>
    </MemoryRouter>,
    )
    const registered = useCopilotStore.getState().bridge.run

    // The editor hands down a new arrow on every render. The registered
    // callback must not be rebuilt (that would churn the bridge)…
    rerender(
      <MemoryRouter>
      <QueryClientProvider client={client}>
        <CopilotPanel {...props} run={second} creditEstimate={99} />
        </QueryClientProvider>
    </MemoryRouter>,
    )
    expect(useCopilotStore.getState().bridge.run).toBe(registered)

    // …but it must still reach the CURRENT one, or a run would fire against a
    // stale editor closure.
    useCopilotStore.getState().bridge.run!({ skipConfirm: true })
    expect(second).toHaveBeenCalledWith({ skipConfirm: true })
    expect(first).not.toHaveBeenCalled()

    // Plain values do flow through.
    expect(useCopilotStore.getState().bridge.creditEstimate).toBe(99)
  })

  it("clears the run callback on unmount, so a closed editor cannot start a paid run", () => {
    const { unmount } = renderPanel()
    expect(useCopilotStore.getState().bridge.run).not.toBeNull()
    unmount()
    expect(useCopilotStore.getState().bridge.run).toBeNull()
    expect(useCopilotStore.getState().bridge.save).toBeNull()
  })

  it("offers no run callback at all on a read-only workflow", () => {
    workflowState.isReadOnly = true
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter>
      <QueryClientProvider client={client}>
        <CopilotPanel {...props} run={null} save={null} />
        </QueryClientProvider>
    </MemoryRouter>,
    )
    expect(useCopilotStore.getState().bridge.run).toBeNull()
  })
})

describe("read-only workflow", () => {
  it("removes the composer entirely — there is nothing to disable around", () => {
    workflowState.isReadOnly = true
    renderPanel()
    expect(screen.queryByPlaceholderText(/describe what you want/i)).not.toBeInTheDocument()
    expect(screen.getByText("Editing is off for this workflow")).toBeInTheDocument()
  })
})

describe("a live turn", () => {
  beforeEach(() => {
    useCopilotStore.setState({
      streaming: true,
      turn: {
        turnId: "turn-1",
        status: "streaming",
        userText: "build me a product shot",
        startedAt: 1_700_000_000_000,
        text: "Adding three angles",
        activities: [{ id: "tu1", label: "Reading the workflow", note: "", status: "started" }],
        update: null,
        proposal: null,
        memorySaves: [], createdWorkflows: [],
        creditsCharged: null,
        error: null,
      },
    })
  })

  it("shows what the user asked, what is being written, and what is happening", () => {
    renderPanel()
    expect(screen.getByText("build me a product shot")).toBeInTheDocument()
    expect(screen.getByText("Adding three angles")).toBeInTheDocument()
    // Twice on purpose: the activity ROW is the log of what happened, the live
    // PILL is the always-visible "still working, on this step, for this long".
    expect(screen.getAllByText("Reading the workflow")).toHaveLength(2)
  })

  it("turns the send button into a stop button", () => {
    renderPanel()
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument()
  })
})
