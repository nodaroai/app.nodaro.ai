// @test-watches frontend/src/components/editor/workflow-editor/workflow-editor-main.tsx
/**
 * A node's own Run that the server refuses for a credits shortfall opens the
 * editor's not-enough-credits dialog with the refusal's figures, and says
 * nothing else: the "Failed to start …" toast is for every other refusal.
 *
 * Driven end to end on the client: a real start call (`editImage`) answered
 * with the server's 402 body, through `throwApiError`, the node's poll lane
 * (`pollJobWithNodeUpdate`) and the editor's blocking-dialog check
 * (`checkStorageError`) — none of them mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const h = vi.hoisted(() => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  nodes: [] as Array<{ id: string; type?: string; data: Record<string, unknown> }>,
  cloud: true,
  userId: undefined as string | undefined,
}))

vi.mock("sonner", () => ({ toast: h.toast }))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasCredits: () => h.cloud,
}))
vi.mock("@/hooks/use-auth", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-auth")>()),
  getCachedUserId: () => h.userId,
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

import { pollJobWithNodeUpdate } from "../poll-job"
import type { ExecutionContext } from "../types"
import { openInsufficientCreditsDialog, type CreditsShortfall } from "../credits-shortfall"
import { editImage } from "@/lib/api"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

function editorCtx(overrides: Partial<ExecutionContext> = {}) {
  const dialog = vi.fn<(shortfall: CreditsShortfall) => void>()
  const storage = vi.fn()
  const subscription = vi.fn()
  const ctx = {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: ReturnType<typeof setInterval>) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: storage,
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
    setShowSubscriptionRequired: subscription,
    openCreditsDialog: dialog,
    ...overrides,
  } as ExecutionContext
  return { ctx, dialog, storage, subscription }
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

/** Press the node's Run: its start call, followed by its poll lane, to its end. */
async function runNode(ctx: ExecutionContext) {
  await expect(pollJobWithNodeUpdate("n1", () => editImage("https://r2/in.png"), "generatedImageUrl", "Edit Image", ctx)).rejects.toBeDefined()
}

const node = () => h.nodes[0]!.data

beforeEach(() => {
  h.cloud = true
  h.nodes = [{ id: "n1", type: "edit-image", data: { label: "Edit Image" } }]
  Object.values(h.toast).forEach((t) => t.mockReset())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("a node's Run refused for a credits shortfall", () => {
  it("opens the dialog with the refusal's figures, and no toast", async () => {
    serverAnswers(402, { error: { code: "insufficient_credits", message: "Insufficient credits. Required: 176, Available: 0" }, required: 176, balance: 0 })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(dialog).toHaveBeenCalledWith({ required: 176, available: 0 })
    expect(h.toast.error).not.toHaveBeenCalled()
    expect(h.toast.warning).not.toHaveBeenCalled()
    // The node still shows the run did not start, and why, once the dialog is closed.
    expect(node().executionStatus).toBe("failed")
    expect(node().errorMessage).toBe("Insufficient credits. Required: 176, Available: 0")
  })

  it("quotes the figures RAW, as the refusal carries them (the dialog converts them for display)", async () => {
    serverAnswers(402, { error: { code: "insufficient_credits", message: "Needs up to 2400 credits" }, required: 2400, balance: 1500 })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).toHaveBeenCalledWith({ required: 2400, available: 1500 })
  })
})

describe("every other refusal keeps what it does today", () => {
  it("a deployment payer's 402 names no balance: the toast, never a dialog quoting a balance nobody was told", async () => {
    serverAnswers(402, { error: { code: "insufficient_credits", message: "This deployment is out of credits. Contact your administrator." }, required: 176 })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
  })

  it("a 402 whose figures show no shortfall (refused for another reason) keeps the toast", async () => {
    serverAnswers(402, { error: { code: "insufficient_credits", message: "Daily credit limit reached for free tier." }, required: 10, balance: 500 })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
  })

  it("a 402 with no figures at all keeps the toast", async () => {
    serverAnswers(402, { error: { code: "insufficient_credits", message: "This model is not available on your plan." } })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
  })

  it("the free-plan video limit keeps the toast", async () => {
    serverAnswers(402, { error: { code: "free_video_limit", message: "Not available on free credits" } })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error.mock.calls.length + h.toast.warning.mock.calls.length).toBe(1)
  })

  it("a per-user allowance refusal (deployment payer) keeps the toast", async () => {
    serverAnswers(402, { error: { code: "user_allowance_exceeded", message: "Your allowance cannot cover this run" }, required: 176, remaining: 0 })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
  })

  it("an app-credits refusal keeps the toast", async () => {
    serverAnswers(402, { error: { code: "insufficient_app_credits", message: "Insufficient app credits." }, required: 176, balance: 0 })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
  })

  it("a storage refusal still opens the storage dialog, not this one", async () => {
    serverAnswers(413, { error: { code: "storage_limit_exceeded", message: "Out of space", usedBytes: 10, quotaBytes: 10, remainingBytes: 0, tier: "free" } })
    const { ctx, dialog, storage } = editorCtx()
    await runNode(ctx)
    expect(storage).toHaveBeenCalledWith(true)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error).not.toHaveBeenCalled()
    // Exactly as before: the node says nothing more (only a credits refusal keeps its sentence there).
    expect(node().errorMessage).toBeUndefined()
  })

  it("the subscription ask still opens its own dialog", async () => {
    serverAnswers(403, { error: { code: "subscription_required", message: "Subscription required" } })
    const { ctx, dialog, subscription } = editorCtx()
    await runNode(ctx)
    expect(subscription).toHaveBeenCalledWith(true)
    expect(dialog).not.toHaveBeenCalled()
    expect(node().errorMessage).toBeUndefined()
  })

  it("an ordinary failure keeps the toast", async () => {
    serverAnswers(500, { error: { code: "internal_error", message: "Something broke" } })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
  })

  it("a run whose context mounts no dialog (the inline auto-run) keeps the toast", async () => {
    serverAnswers(402, { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 176, balance: 0 })
    const { ctx } = editorCtx({ openCreditsDialog: undefined })
    await runNode(ctx)
    expect(h.toast.error).toHaveBeenCalledTimes(1)
  })

  it("a build without credits never opens it", async () => {
    h.cloud = false
    serverAnswers(402, { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 176, balance: 0 })
    const { ctx, dialog } = editorCtx()
    await runNode(ctx)
    expect(dialog).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
  })
})

describe("the editor's dialog for it", () => {
  afterEach(() => {
    queryClient.clear()
    h.userId = undefined
  })

  it("shows the refusal's figures with the plan the account's balance names", () => {
    h.userId = "u1"
    queryClient.setQueryData(queryKeys.credits.balance("u1"), { total: 0, tier: "basic" })
    const setInsufficientCreditsData = vi.fn()
    const setShowInsufficientCredits = vi.fn()
    openInsufficientCreditsDialog({ setInsufficientCreditsData, setShowInsufficientCredits }, { required: 176, available: 0 })
    expect(setInsufficientCreditsData).toHaveBeenCalledWith({ required: 176, available: 0, tier: "basic" })
    expect(setShowInsufficientCredits).toHaveBeenCalledWith(true)
  })

  it("names the free plan while the balance is not loaded", () => {
    const setInsufficientCreditsData = vi.fn()
    openInsufficientCreditsDialog({ setInsufficientCreditsData, setShowInsufficientCredits: vi.fn() }, { required: 176, available: 0 })
    expect(setInsufficientCreditsData).toHaveBeenCalledWith({ required: 176, available: 0, tier: "free" })
  })
})

/**
 * The editor is the one context that mounts the dialog, so it is the one that
 * sets `openCreditsDialog`. Without it every node's credits refusal would fall
 * back to its toast and no test above would notice (they hand in their own
 * context). Read from the editor's source: its ExecutionContext must open the
 * dialog through the same state the mounted InsufficientCreditsModal reads.
 */
describe("the editor wires the dialog into its runs' context", () => {
  const file = path.resolve(__dirname, "../workflow-editor-main.tsx")
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)

  function ctxLiteral(): ts.ObjectLiteralExpression | undefined {
    let found: ts.ObjectLiteralExpression | undefined
    const visit = (n: ts.Node) => {
      if (
        ts.isVariableDeclaration(n) && n.name.getText() === "ctx" &&
        n.type?.getText() === "ExecutionContext" && n.initializer && ts.isObjectLiteralExpression(n.initializer)
      ) found = n.initializer
      ts.forEachChild(n, visit)
    }
    visit(source)
    return found
  }

  it("its ExecutionContext sets openCreditsDialog to open the dialog with the refusal's figures", () => {
    const literal = ctxLiteral()
    expect(literal, "the editor's `const ctx: ExecutionContext = { … }`").toBeDefined()
    const prop = literal!.properties.find((p) => p.name?.getText() === "openCreditsDialog")
    expect(prop, "openCreditsDialog on the editor's context").toBeDefined()
    const text = prop!.getText()
    expect(text).toContain("openInsufficientCreditsDialog(")
    expect(text).toContain("setInsufficientCreditsData")
    expect(text).toContain("setShowInsufficientCredits")
  })

  it("the dialog it opens is the one the editor renders", () => {
    const text = source.getFullText()
    expect(text).toMatch(/<InsufficientCreditsModal\s+open=\{showInsufficientCredits\}/)
    expect(text).toContain("required={insufficientCreditsData?.required ?? 0}")
  })
})
