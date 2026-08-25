/**
 * The transcript's one hard rule: the run decision outlives the turn.
 *
 * The server persists a turn's messages BEFORE it emits `done`, so the history
 * refetch that follows a turn always contains that turn — and the live block is
 * deduped away a second or two into the run decision. Anything scoped to that
 * block disappears with it, which is exactly what happened to the proposal card
 * (and to the outcome watcher inside it) before this was pinned.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
  useUserCredits: () => ({ data: { total: 6515 } }),
}))
vi.mock("@/ee/lib/copilot/turn-engine", () => ({
  abandonRunFollow: vi.fn(),
  startProposedRun: vi.fn(),
  skipProposedRun: vi.fn(),
  reportRunOutcome: vi.fn(),
  noteExecutionStarted: vi.fn(),
  clearRunFollow: vi.fn(),
  askForFix: vi.fn(),
}))
vi.mock("@/lib/api", () => ({ getWorkflowExecution: vi.fn(async () => ({ status: "running" })) }))

const { CopilotConversation } = await import("../copilot-conversation")
const { useCopilotStore } = await import("@/ee/lib/copilot/turn-store")

const TURN_ID = "turn-1"

const proposal = {
  workflowId: "wf-1",
  addedNodeTypes: ["generate-image"],
  note: null,
}

/** What the server hands back once it has persisted the turn. */
const persistedHistory = [
  {
    id: "m1",
    seq: 1,
    turnId: TURN_ID,
    role: "user" as const,
    createdAt: "now",
    parts: [{ kind: "text" as const, text: "build me a 6-shot promo" }],
  },
  {
    id: "m2",
    seq: 2,
    turnId: TURN_ID,
    role: "assistant" as const,
    createdAt: "now",
    parts: [{ kind: "text" as const, text: "Built it — six shots." }],
  },
]

function renderConversation(messages: typeof persistedHistory) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CopilotConversation
        messages={messages}
        userId="u1"
        nodeCount={7}
        onShowOnCanvas={vi.fn()}
        onStopRun={vi.fn()}
        onRetry={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useCopilotStore.setState({
    streaming: false,
    runPhase: "proposed",
    proposalDismissed: false,
    executionId: null,
    runMode: "ask",
    autoRunLimit: 100,
    activityCollapsed: true,
    insufficient: null,
    turn: {
      turnId: TURN_ID,
      status: "completed",
      userText: "build me a 6-shot promo",
      startedAt: 1_700_000_000_000,
      text: "Built it — six shots.",
      activities: [],
      update: {
        workflowId: "wf-1",
        version: 7,
        addedNodeIds: ["n1", "n2"],
        updatedNodeIds: [],
        removedNodeIds: [],
        addedNodeTypes: ["generate-image"],
        nodeCount: 7,
        edgeCount: 6,
        adjustments: [],
      },
      proposal,
      memorySaves: [],
      creditsCharged: 4,
      error: null,
    },
  })
  useCopilotStore.getState().setBridge({ creditEstimate: 12, estimateStale: false, estimateVersion: 6, isRunning: false })
})

describe("the run decision", () => {
  it("is on screen before the turn is persisted", () => {
    renderConversation([])
    expect(screen.getByText("Run this workflow?")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument()
  })

  it("SURVIVES the history refetch that follows the turn", () => {
    // This is the regression: the server persists before `done`, so by the time
    // the user reaches for the button the turn is already in history.
    renderConversation(persistedHistory)
    expect(screen.getByText("Run this workflow?")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument()
  })

  it("keeps Show on canvas reachable after the turn is persisted", () => {
    renderConversation(persistedHistory)
    expect(screen.getByRole("button", { name: "Show on canvas" })).toBeInTheDocument()
  })

  it("does not draw the turn twice once history carries it", () => {
    renderConversation(persistedHistory)
    expect(screen.getAllByText("Built it — six shots.")).toHaveLength(1)
    expect(screen.getAllByText("build me a 6-shot promo")).toHaveLength(1)
  })

  it("quotes the estimate, and says so plainly when the price is not known yet", () => {
    renderConversation(persistedHistory)
    expect(screen.getByText("~12 credits")).toBeInTheDocument()

    useCopilotStore.getState().setBridge({ estimateStale: true })
    renderConversation(persistedHistory)
    expect(screen.getAllByText("pricing…").length).toBeGreaterThan(0)
  })

  it("disappears once the user declines", () => {
    useCopilotStore.setState({ proposalDismissed: true, runPhase: "idle" })
    renderConversation(persistedHistory)
    expect(screen.queryByText("Run this workflow?")).not.toBeInTheDocument()
  })
})

describe("the gap between send and the first token", () => {
  /** The exact state the panel is in for the first several seconds of a turn. */
  const justSent = {
    streaming: true,
    turn: {
      turnId: null,
      status: "streaming" as const,
      userText: "build me a product shot",
      startedAt: 1_700_000_000_000,
      text: "",
      activities: [],
      update: null,
      proposal: null,
      memorySaves: [],
      creditsCharged: null,
      error: null,
    },
  }

  it("is never blank — the pill and the skeleton stand in for the answer", () => {
    useCopilotStore.setState({ ...justSent, runPhase: "idle", proposalDismissed: true })
    renderConversation([])
    expect(screen.getByText("build me a product shot")).toBeInTheDocument()
    expect(screen.getByText("Reading the workflow")).toBeInTheDocument()
    expect(screen.getByTestId("copilot-answer-skeleton")).toBeInTheDocument()
  })

  it("drops the skeleton the moment prose starts arriving", () => {
    useCopilotStore.setState({
      ...justSent,
      turn: { ...justSent.turn, text: "Adding three angles" },
      runPhase: "idle",
      proposalDismissed: true,
    })
    renderConversation([])
    expect(screen.getByText("Adding three angles")).toBeInTheDocument()
    // Real text has arrived, so the stand-in for it must be gone.
    expect(screen.queryByTestId("copilot-answer-skeleton")).toBeNull()
    // The pill stays — it carries the step and the clock until `done`.
    expect(screen.getByText("Reading the workflow")).toBeInTheDocument()
  })

  it("shows neither on a turn that is over", () => {
    useCopilotStore.setState({ streaming: false, runPhase: "idle", proposalDismissed: true })
    renderConversation(persistedHistory)
    expect(screen.queryByText("Reading the workflow")).toBeNull()
    expect(screen.queryByTestId("copilot-answer-skeleton")).toBeNull()
  })
})
