/**
 * A use-case node's Run, or its Continue, refused for a credits shortfall
 * (Tighten Episode, Chapters, Trailer, Clip Pack, Speaker Layout): the server's
 * refusal names what the run needs and what the account has beside its error
 * (backend lib/use-case/credits-refusal.ts), so the editor opens its
 * not-enough-credits dialog with those figures and shows no toast. A refusal
 * that names none (a deployment's pool, a web surface's free pool, a hold
 * above the run's price) keeps its toast.
 *
 * Driven end to end on the client: the real start calls (`runUseCase`,
 * `continueUseCase`) answered with the route's 402 body, through
 * `throwApiError`, the use-case executor, its landing lanes (the episode's
 * `pollJobWithNodeUpdate`, Chapters' text lane) and the editor's
 * blocking-dialog check — none of them mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  nodes: [] as Array<{ id: string; type?: string; position: { x: number; y: number }; data: Record<string, unknown> }>,
}))

vi.mock("sonner", () => ({ toast: h.toast }))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: h.nodes,
      edges: [],
      updateNodeData: (id: string, patch: Record<string, unknown>) => {
        const node = h.nodes.find((n) => n.id === id)
        if (node) node.data = { ...node.data, ...patch }
      },
    }),
  },
}))

import type { WorkflowNode } from "@/types/nodes"
import type { ExecutionContext } from "../types"
import type { CreditsShortfall } from "../credits-shortfall"
import { executeUseCase } from "../use-case-executor"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const REC = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }

/** The route's 402 bodies, as the server sends them. */
const RUN_SHORT = {
  error: { code: "insufficient_credits", message: "This episode is estimated at about 932 credits; your balance is 100." },
  required: 932,
  balance: 100,
  estimate: true,
}
const CONTINUE_SHORT = {
  error: { code: "insufficient_credits", message: "Continuing this episode is estimated at about 910 credits; your balance is 100." },
  required: 910,
  balance: 100,
  estimate: true,
}
const DEPLOYMENT = { error: { code: "insufficient_credits", message: "This deployment is out of credits. Contact your administrator." } }
const FREE_POOL = { error: { code: "insufficient_credits", message: "This episode is estimated at about 932 credits; your balance is 100." } }
const HOLD = { error: { code: "insufficient_credits", message: "Continuing this episode can hold up to about 1510 credits while it renders; your balance is 1000." } }

function editorCtx(): { ctx: ExecutionContext; dialog: ReturnType<typeof vi.fn<(shortfall: CreditsShortfall) => void>> } {
  const dialog = vi.fn<(shortfall: CreditsShortfall) => void>()
  const ctx = {
    userId: "00000000-0000-4000-8000-000000000001",
    projectId: "p1",
    trackInterval: (i: ReturnType<typeof setInterval>) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
    setShowSubscriptionRequired: vi.fn(),
    openCreditsDialog: dialog,
  } as unknown as ExecutionContext
  return { ctx, dialog }
}

/** The server answers the node's start (its run or its continue) with a 402 and this body. */
function serverRefuses(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status: 402,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }))
}

function useCaseNode(type: string, label: string): WorkflowNode {
  const node = { id: "n1", type, position: { x: 0, y: 0 }, data: { label, fieldMappings: {} } }
  h.nodes = [node]
  return node as unknown as WorkflowNode
}

const node = () => h.nodes[0]!.data

/** Press the node's Run (or its Continue), to its end. */
async function press(n: WorkflowNode, ctx: ExecutionContext, cont?: { mode: "from-failed"; jobId: string }) {
  await expect(executeUseCase(n, REC as never, ctx, cont ? { usecaseContinue: cont } : {})).rejects.toBeDefined()
}

beforeEach(() => {
  Object.values(h.toast).forEach((t) => t.mockReset())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("a use-case node's start refused for a credits shortfall that names its figures", () => {
  it("Run (an episode): the dialog with the refusal's figures, no toast, and the node keeps the server's sentence", async () => {
    serverRefuses(RUN_SHORT)
    const { ctx, dialog } = editorCtx()
    await press(useCaseNode("tighten-episode", "Tighten Episode"), ctx)
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveBeenCalledWith({ required: 932, available: 100, estimate: true })
    expect(h.toast.error).not.toHaveBeenCalled()
    expect(node().executionStatus).toBe("failed")
    expect(node().errorMessage).toBe("This episode is estimated at about 932 credits; your balance is 100.")
  })

  it("Continue from a failed step: the same dialog, no toast", async () => {
    serverRefuses(CONTINUE_SHORT)
    const { ctx, dialog } = editorCtx()
    await press(useCaseNode("tighten-episode", "Tighten Episode"), ctx, { mode: "from-failed", jobId: JOB })
    expect(dialog).toHaveBeenCalledWith({ required: 910, available: 100, estimate: true })
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it("a node whose result is text (Chapters), its Run and its Continue: the dialog, no toast", async () => {
    serverRefuses(RUN_SHORT)
    const first = editorCtx()
    await press(useCaseNode("episode-chapters", "Chapters"), first.ctx)
    expect(first.dialog).toHaveBeenCalledWith({ required: 932, available: 100, estimate: true })
    serverRefuses(CONTINUE_SHORT)
    const again = editorCtx()
    await press(useCaseNode("episode-chapters", "Chapters"), again.ctx, { mode: "from-failed", jobId: JOB })
    expect(again.dialog).toHaveBeenCalledWith({ required: 910, available: 100, estimate: true })
    expect(h.toast.error).not.toHaveBeenCalled()
  })
})

describe("a refusal that names no figures keeps its toast", () => {
  for (const [name, body, cont] of [
    ["a deployment's pool (the operator's)", DEPLOYMENT, undefined],
    ["a web surface's free pool", FREE_POOL, undefined],
    ["a deployment's pool, on Continue", DEPLOYMENT, { mode: "from-failed", jobId: JOB }],
    ["a hold above the run's price, on Continue", HOLD, { mode: "from-failed", jobId: JOB }],
  ] as const) {
    it(name, async () => {
      serverRefuses(body)
      const { ctx, dialog } = editorCtx()
      await press(useCaseNode("tighten-episode", "Tighten Episode"), ctx, cont)
      expect(dialog).not.toHaveBeenCalled()
      expect(h.toast.error).toHaveBeenCalledTimes(1)
    })
  }
})
