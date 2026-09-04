import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Track A — the canvas precheck under a deployment payer (D12, ruling R-A).
 *
 * The gate at `run-handlers.ts` compares the run's estimate against
 * `balance.total`. On a payer instance that field is the requester's FROZEN
 * signup grant: nothing debits it, nothing tops it up, and it has no relation
 * to what the user may actually spend. Comparing against it either blocks a
 * user who has plenty of allowance left (grant exhausted) or waves through one
 * with none (grant untouched) — and the second is the expensive direction,
 * because the refusal then arrives from the server after a job row exists.
 *
 * But VISIBLE is not ENFORCED. The server sends the allowance from the moment
 * a payer exists (that is what un-freezes the sidebar at rollout step 5) and
 * only refuses on it after the `billing.allowances` flip, which it reports as
 * `allowance.enforced`. So the gate compares against `allowance.remaining` ONLY
 * when the server says it is enforced.
 *
 * And in the window between those two — a payer exists, enforcement is off —
 * this precheck DOES NOT RUN AT ALL. Falling back to `total` there was the
 * earlier rule and it was wrong: on a payer instance `total` is the frozen
 * signup grant, so the fallback refuses runs the payer's pool would have paid
 * for (a 4,000-credit run against a 1,500-credit grant) and waves through ones
 * it would not. `spendableCredits().gateApplies` is the bit that says so, and
 * in that window the server — the payer's pool now, the RPC's allowance check
 * after the flip — is the only thing entitled to refuse.
 *
 * The comparison stays in RAW credits — `creditUnits` is a RENDER conversion
 * and putting it on either side of this `<` is how a display unit turns into a
 * money bug. The decision itself lives in `spendableCredits()`; this file pins
 * that the canvas actually asks it.
 */

const mockMarkNodesStatus = vi.fn()
const mockToastError = vi.fn()
const mockExecuteNode = vi.fn()
const mockBuildExecutionLevels = vi.fn()
const mockGetEffectivelySkippedIds = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockGetListInputForNode = vi.fn()
const mockRunWorkflow = vi.fn()
const mockFetchQuery = vi.fn()
const mockGetQueryData = vi.fn<(key: unknown) => unknown>(() => undefined)
const mockEstimateRunCredits = vi.fn()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: { label: string } }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges,
      updateNodeData: vi.fn(), markNodesStatus: mockMarkNodesStatus,
      isDirty: false, workflowId: "wf-1",
    }),
  },
}))
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  runWorkflow: (...a: unknown[]) => mockRunWorkflow(...a),
  getWorkflowExecution: vi.fn(),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: class extends Error {},
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/query-client", () => ({
  queryClient: {
    fetchQuery: (...a: unknown[]) => mockFetchQuery(...a),
    // The billing surface, read from the cache `useBillingSurface` fills (the
    // editor mounts it long before a Run is possible). It is the ONLY way this
    // imperative gate can tell a payer instance from mainline, and that is the
    // difference between "a null allowance means my wallet is live" and "a null
    // allowance means I am not entitled to refuse at all".
    getQueryData: (key: unknown) => mockGetQueryData(key),
  },
}))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../estimate-run-credits", () => ({ estimateRunCredits: (...a: unknown[]) => mockEstimateRunCredits(...a) }))
vi.mock("../types", () => ({
  WorkflowStaleError: class extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: () => {},
  NODE_CREDIT_COSTS: { "generate-image": 1 } as Record<string, number>,
  isExecutableNode: (n: { type?: string }) => n.type === "generate-image",
  getFanOutMultiplier: () => 1,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: (...a: unknown[]) => mockBuildExecutionLevels(...a),
  getEffectivelySkippedIds: (...a: unknown[]) => mockGetEffectivelySkippedIds(...a),
  collapseExpandedClones: (...a: unknown[]) => mockCollapseExpandedClones(...a),
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: (...a: unknown[]) => mockGetListInputForNode(...a) }))
vi.mock("../execute-node", () => ({ executeNode: (...a: unknown[]) => mockExecuteNode(...a), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))

import { handleRun } from "../run-handlers"
import { BILLING_SURFACE_QUERY_KEY } from "@/lib/billing-surface"

const NODE = { id: "n1", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "generate-image" } }

function makeCtx() {
  return {
    userId: "u1", projectId: "p1",
    trackInterval: (i: unknown) => i, untrackInterval: vi.fn(),
    save: vi.fn(), setIsRunning: vi.fn(),
    isWorkflowStale: () => false, isStorageError: () => false,
    setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(), setInsufficientCreditsData: vi.fn(),
  }
}

/** The whole balance body, as `/v1/user/credits` sends it. */
function balance(over: Record<string, unknown>) {
  mockFetchQuery.mockResolvedValue({ total: 1500, tier: "free", ...over })
}

/** `billingSurface().deploymentPayer`, as the query cache holds it. */
function payerInstance(on: boolean) {
  mockGetQueryData.mockReturnValue({ deploymentPayer: on })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = [NODE]
  mockEdges = []
  mockCollapseExpandedClones.mockReturnValue({ nodes: [NODE], edges: [] })
  mockBuildExecutionLevels.mockReturnValue([[NODE]])
  mockGetEffectivelySkippedIds.mockReturnValue(new Set())
  mockExecuteNode.mockResolvedValue(undefined)
  mockGetListInputForNode.mockReturnValue(null)
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  // Mainline unless the case says otherwise.
  payerInstance(false)
})

describe("the canvas precheck and the per-user allowance", () => {
  it("blocks on the ALLOWANCE when the frozen grant would have waved it through", async () => {
    // total 1 500 (the untouched signup grant) vs an allowance with 40 left.
    balance({ total: 1500, allowance: { granted: 400_000, remaining: 40, enforced: true } })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).toHaveBeenCalledWith(true)
    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith(
      expect.objectContaining({ required: 500, available: 40 }),
    )
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("allows on the ALLOWANCE when the frozen grant would have blocked it", async () => {
    // The expensive direction reversed: a spent-looking grant, plenty of quota.
    balance({ total: 0, allowance: { granted: 400_000, remaining: 399_000, enforced: true } })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("feeds the modal the allowance figures, RAW — no unit conversion on the gate", async () => {
    balance({ total: 1500, allowance: { granted: 400_000, remaining: 40, enforced: true } })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    const arg = ctx.setInsufficientCreditsData.mock.calls[0][0]
    expect(arg.available).toBe(40)      // not 40 × any rate
    expect(arg.required).toBe(500)
    expect(arg.tier).toBe("free")
  })

  it("an exactly-affordable run proceeds (the boundary is `<`, not `<=`)", async () => {
    balance({ total: 0, allowance: { granted: 400_000, remaining: 500, enforced: true } })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
  })

  it("falls back to `total` when the server sent no allowance (mainline)", async () => {
    balance({ total: 100 })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith(
      expect.objectContaining({ required: 500, available: 100 }),
    )
  })

  it("falls back to `total` when the allowance is explicitly null (payer, or the figure was unavailable)", async () => {
    // null is a REAL answer — "no allowance applies to you" — and must not be
    // read as "remaining 0", which would refuse the payer's own runs.
    balance({ total: 100_000, allowance: null })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("RUNS on a PAYER instance when the allowance is null and the frozen grant is short", async () => {
    // THE UNAVAILABLE CASE, and the reason this gate reads the billing surface
    // at all. `allowance: null` under a payer is two answers in one: the caller
    // IS the payer (D13), or the figure could not be read — a settings row that
    // would not load, a transient PostgREST error. The superseded rule gated on
    // `total` for both, so one blipped read re-armed the pre-flip refusal on
    // the frozen signup grant, and the server's 15 s balance cache pinned it
    // there for every poll in that window. On a payer instance nothing but a
    // PRESENT, ENFORCED allowance may refuse.
    payerInstance(true)
    balance({ total: 100, allowance: null })
    mockEstimateRunCredits.mockReturnValue(5000)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("MAINLINE still refuses on `total` when the allowance key is explicitly null", async () => {
    // The same body on a deployment with no payer: there is no allowance
    // concept, `total` is the wallet the run debits, and the refusal is honest.
    // The surface flag is the only thing keeping these two cases apart.
    payerInstance(false)
    balance({ total: 100, allowance: null })
    mockEstimateRunCredits.mockReturnValue(5000)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith(
      expect.objectContaining({ required: 5000, available: 100 }),
    )
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("an unreadable surface cache is MAINLINE, and a present allowance still decides alone", async () => {
    // The cache can be cold (or a refactor can drop the entry): reading it must
    // never throw into this gate's catch and skip the balance check wholesale.
    // Undefined reads as mainline — and a PRESENT allowance is unaffected by
    // the flag either way, which keeps the pre-flip window safe even then.
    mockGetQueryData.mockReturnValue(undefined)
    balance({ total: 100, allowance: { granted: 400_000, remaining: 399_000, enforced: false } })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("reads the surface under the key the hook writes", async () => {
    // A second literal copy of the key reads an always-empty cache and answers
    // "no payer" for ever — the failure this assertion exists to catch.
    payerInstance(true)
    balance({ total: 100, allowance: null })
    mockEstimateRunCredits.mockReturnValue(5000)

    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(mockGetQueryData).toHaveBeenCalledWith(BILLING_SURFACE_QUERY_KEY)
  })

  it("RUNS on an exhausted allowance the server is not enforcing yet (rollout step 5)", async () => {
    // The step-5 window: the allowance is VISIBLE and empty, the server still
    // enforces the payer's pool alone and would have run this job. Refusing
    // here refuses every user on the deployment for as long as step 5 lasts.
    balance({ total: 100_000, allowance: { granted: 1000, remaining: 0, enforced: false } })
    mockEstimateRunCredits.mockReturnValue(1020)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("RUNS when the server sent an allowance but no enforcement flag at all", async () => {
    // A backend older than the flag is not "assume enforced": an unknown
    // enforcement state must behave exactly as the pre-Track-A gate did.
    balance({ total: 100_000, allowance: { granted: 1000, remaining: 0 } })
    mockEstimateRunCredits.mockReturnValue(1020)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("does NOT refuse on `total` while enforcement is off — the frozen grant is not a ceiling", async () => {
    // The superseded rule refused here, quoting 100. On a payer instance that
    // 100 is a frozen signup grant: nothing debits it, nothing tops it up, and
    // the payer's own top-up lever cannot move it. The user has 399,000 of
    // allowance and the pool would have paid — so the precheck stands down.
    balance({ total: 100, allowance: { granted: 400_000, remaining: 399_000, enforced: false } })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
    expect(ctx.setInsufficientCreditsData).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("PROCEEDS with enforcement off even when the estimate is over BOTH remaining and total", async () => {
    // Neither number is one this client may refuse on: `total` is frozen, and
    // `remaining` is not enforced yet. If the pool cannot cover it the server
    // says so — with a real refusal, not a guess made from a stale grant.
    balance({ total: 100, allowance: { granted: 1000, remaining: 40, enforced: false } })
    mockEstimateRunCredits.mockReturnValue(5000)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("still refuses once the flip lands, on the enforced remaining", async () => {
    // The same instance one setting later: enforcement on, and the number the
    // server will refuse on is now a number this client may quote.
    balance({ total: 100, allowance: { granted: 1000, remaining: 40, enforced: true } })
    mockEstimateRunCredits.mockReturnValue(5000)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith(
      expect.objectContaining({ required: 5000, available: 40 }),
    )
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("MAINLINE still refuses on `total`, exactly as it did before Track A", async () => {
    // No payer, no allowance key: `total` IS the wallet the run debits, so the
    // pre-Track-A comparison is the honest one and must not have moved.
    balance({ total: 100 })
    mockEstimateRunCredits.mockReturnValue(500)
    const ctx = makeCtx()

    await handleRun(ctx as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith(
      expect.objectContaining({ required: 500, available: 100 }),
    )
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })
})
