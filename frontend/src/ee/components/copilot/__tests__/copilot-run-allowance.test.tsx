/**
 * Track A (D12, ruling R-A) — the balance the copilot's run proposal quotes.
 *
 * The proposal card is the fourth client gate that reads a credit balance, and
 * the one WS5's three edits missed. Under a deployment payer the requester's
 * `total` is a frozen signup grant: nothing debits it and nothing tops it up,
 * so quoting it tells the user they have thousands of credits right up to the
 * moment the server refuses the run.
 *
 * This card is the number the user APPROVES A RUN FROM — in Auto mode it is
 * the only figure on screen before the run starts — so it must be a number
 * that means something. It takes `spendableCredits().displayFigure`: the
 * allowance whenever the server sent one, `total` otherwise.
 *
 * That is the same number the sidebar shows, and it is also the number the
 * canvas gate compares against WHENEVER a client gate is allowed to run at all
 * (`gateApplies`) — the two figures only ever differ in the pre-flip payer
 * window, and there `total` is a frozen signup grant nobody may quote as
 * spendable. The superseded rule quoted it, so a user with 10,000 of allowance
 * read "balance 1,500", and a withheld user read "balance 0" on an instance
 * where the payer's pool pays for everything.
 *
 * `null` and absent are the SAME answer — "no allowance applies to me" (I am
 * the payer, or the figure was unavailable) — and both fall back to `total`,
 * which for the payer IS a live wallet. Reading null as "remaining 0" would
 * tell the account that owns the pool it is broke.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const { mockCredits, mockPayerInstance } = vi.hoisted(() => ({
  mockCredits: vi.fn<() => { data: Record<string, unknown> | undefined }>(() => ({ data: undefined })),
  mockPayerInstance: vi.fn<() => boolean>(() => false),
}))

vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
  useUserCredits: () => mockCredits(),
}))
// Track A — "does this DEPLOYMENT have a payer". The card only DISPLAYS, so
// the flag cannot change what it quotes; it is mocked so the surface query
// never reaches the network from this render, and so the payer case below can
// assert exactly that invariance.
vi.mock("@/hooks/use-billing-surface", () => ({
  useBillingSurface: () => ({ surface: { deploymentPayer: mockPayerInstance() }, isLoading: false }),
}))
vi.mock("@/ee/lib/copilot/turn-engine", () => ({
  abandonRunFollow: vi.fn(),
  askForFix: vi.fn(),
  clearRunFollow: vi.fn(),
  noteExecutionStarted: vi.fn(),
  reportRunOutcome: vi.fn(),
  skipProposedRun: vi.fn(),
  startProposedRun: vi.fn(),
}))

const { CopilotRunSection } = await import("../copilot-run-section")
const { useCopilotStore } = await import("@/ee/lib/copilot/turn-store")

function renderProposal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CopilotRunSection userId="u1" nodeCount={3} onStopRun={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPayerInstance.mockReturnValue(false)
  useCopilotStore.setState({
    runPhase: "proposed",
    proposalDismissed: false,
    executionId: null,
    streaming: false,
    runMode: "ask",
    autoRunLimit: 100,
    turn: {
      ...useCopilotStore.getState().turn,
      proposal: { workflowId: "wf-1", addedNodeTypes: [], note: null },
    },
    bridge: { ...useCopilotStore.getState().bridge, creditEstimate: 12, estimateStale: false, isRunning: false },
  })
})

describe("the copilot run proposal's balance", () => {
  it("quotes the allowance's remaining, not the frozen signup grant", () => {
    mockCredits.mockReturnValue({
      data: { total: 1500, tier: "free", allowance: { granted: 400_000, remaining: 399_000, enforced: true } },
    })
    renderProposal()
    expect(screen.getByText(/balance 399,000/)).toBeInTheDocument()
    expect(screen.queryByText(/balance 1,500/)).toBeNull()
  })

  it("falls back to `total` when the server sent no allowance (mainline)", () => {
    mockCredits.mockReturnValue({ data: { total: 1500, tier: "free" } })
    renderProposal()
    expect(screen.getByText(/balance 1,500/)).toBeInTheDocument()
  })

  it("treats an explicit null as 'no allowance applies', never as remaining 0", () => {
    // The payer reading its own balance: answering 0 here would tell the
    // account that owns the pool it cannot afford a 12-credit run.
    mockCredits.mockReturnValue({ data: { total: 250_000, tier: "free", allowance: null } })
    renderProposal()
    expect(screen.getByText(/balance 250,000/)).toBeInTheDocument()
    expect(screen.queryByText(/balance 0/)).toBeNull()
  })

  it("a genuinely exhausted allowance quotes 0, not the grant", () => {
    mockCredits.mockReturnValue({
      data: { total: 1500, tier: "free", allowance: { granted: 400_000, remaining: 0, enforced: true } },
    })
    renderProposal()
    expect(screen.getByText(/balance 0/)).toBeInTheDocument()
    expect(screen.queryByText(/balance 1,500/)).toBeNull()
  })

  it("quotes the VISIBLE allowance before the flip, never the frozen grant", () => {
    // The superseded rule quoted `total` here. On a payer instance that 1,500
    // is a frozen signup grant — the payer granted 10,000, the sidebar says
    // 10,000, and this card said 1,500 on the one screen the user approves a
    // paid run from.
    mockCredits.mockReturnValue({
      data: { total: 1500, tier: "free", allowance: { granted: 10_000, remaining: 10_000, enforced: false } },
    })
    renderProposal()
    expect(screen.getByText(/balance 10,000/)).toBeInTheDocument()
    expect(screen.queryByText(/balance 1,500/)).toBeNull()
  })

  it("quotes the allowance for a WITHHELD user, whose frozen grant is 0", () => {
    // `total: 0` under a payer is not "broke": nothing ever debited it.
    mockCredits.mockReturnValue({
      data: { total: 0, tier: "free", allowance: { granted: 10_000, remaining: 10_000, enforced: false } },
    })
    renderProposal()
    expect(screen.getByText(/balance 10,000/)).toBeInTheDocument()
  })

  it("quotes the visible allowance when the server sent no enforcement flag", () => {
    mockCredits.mockReturnValue({
      data: { total: 1500, tier: "free", allowance: { granted: 10_000, remaining: 10_000 } },
    })
    renderProposal()
    expect(screen.getByText(/balance 10,000/)).toBeInTheDocument()
    expect(screen.queryByText(/balance 1,500/)).toBeNull()
  })

  it("still quotes `total` on a PAYER instance whose allowance is unavailable", () => {
    // The card is a DISPLAY, and the surface flag moves only `gateApplies`.
    // When the allowance could not be read there is no allowance to quote, so
    // `total` is what is left and the card must still say something — the
    // refusal is what stands down, not the number on the screen.
    mockPayerInstance.mockReturnValue(true)
    mockCredits.mockReturnValue({ data: { total: 1500, tier: "free", allowance: null } })
    renderProposal()
    expect(screen.getByText(/balance 1,500/)).toBeInTheDocument()
  })

  it("says nothing about a balance it does not have yet", () => {
    mockCredits.mockReturnValue({ data: undefined })
    renderProposal()
    expect(screen.queryByText(/balance/)).toBeNull()
  })
})
