/**
 * The executors that used to answer a refused start with a toast alone now
 * open the not-enough-credits dialog for a credits shortfall — and for that
 * alone. A storage refusal or the subscription ask on such a lane shows the
 * same toast it always did, and opens no dialog: those lanes ask the credits
 * half of the blocking-dialog check (`promptCreditsShortfall`), never the
 * whole of it (`checkStorageError`, which the lanes that already asked it
 * before keep asking).
 *
 * Driven on Site Capture end to end on the client: its real start call
 * answered with the server's body, through `throwApiError`, the executor's
 * catch and the real check — none of them mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  nodes: [] as Array<{ id: string; type?: string; data: Record<string, unknown> }>,
}))

vi.mock("sonner", () => ({ toast: h.toast }))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasCredits: () => true,
}))
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

import { executeSiteCapture } from "../site-capture-execute"
import type { ExecutionContext } from "../types"
import { en } from "@/lib/i18n/en"

function editorCtx() {
  const ctx = {
    userId: "u1",
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
    openCreditsDialog: vi.fn(),
  }
  return ctx as typeof ctx & ExecutionContext
}

/** The server answers the node's start with this status and body. */
function serverAnswers(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }))
}

async function runSiteCapture(ctx: ExecutionContext) {
  const node = { id: "n1", type: "site-capture", position: { x: 0, y: 0 }, data: { label: "Site Capture", url: "https://example.com" } }
  await expect(executeSiteCapture(node as never, {} as never, ctx)).rejects.toBeDefined()
}

/** The toast Site Capture has always shown for a failed start. */
const failedToast = (message: string) => en["nodeRun.siteCaptureFailed"].replace("{message}", message)

beforeEach(() => {
  h.nodes = [{ id: "n1", type: "site-capture", data: { label: "Site Capture" } }]
  Object.values(h.toast).forEach((t) => t.mockReset())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("a newly routed lane (Site Capture): only a credits shortfall opens a dialog", () => {
  it("a storage refusal shows the toast it always showed, and opens no dialog", async () => {
    serverAnswers(413, { error: { code: "storage_limit_exceeded", message: "Out of space", usedBytes: 10, quotaBytes: 10, remainingBytes: 0, tier: "free" } })
    const ctx = editorCtx()
    await runSiteCapture(ctx)
    expect(h.toast.error).toHaveBeenCalledTimes(1)
    expect(h.toast.error).toHaveBeenCalledWith(failedToast("Out of space"))
    expect(ctx.setShowStorageExceeded).not.toHaveBeenCalled()
    expect(ctx.openCreditsDialog).not.toHaveBeenCalled()
    expect(ctx.setShowSubscriptionRequired).not.toHaveBeenCalled()
  })

  it("the subscription ask shows the toast it always showed, and opens no dialog", async () => {
    serverAnswers(403, { error: { code: "subscription_required", message: "Subscription required" } })
    const ctx = editorCtx()
    await runSiteCapture(ctx)
    expect(h.toast.error).toHaveBeenCalledTimes(1)
    expect(h.toast.error).toHaveBeenCalledWith(failedToast("Subscription required"))
    expect(ctx.setShowSubscriptionRequired).not.toHaveBeenCalled()
    expect(ctx.setShowStorageExceeded).not.toHaveBeenCalled()
    expect(ctx.openCreditsDialog).not.toHaveBeenCalled()
  })

  it("a credits shortfall that names its figures opens the dialog instead of the toast", async () => {
    serverAnswers(402, { error: { code: "insufficient_credits", message: "Insufficient credits. Required: 40, Available: 0" }, required: 40, balance: 0 })
    const ctx = editorCtx()
    await runSiteCapture(ctx)
    expect(ctx.openCreditsDialog).toHaveBeenCalledWith({ required: 40, available: 0 })
    expect(h.toast.error).not.toHaveBeenCalled()
  })
})
