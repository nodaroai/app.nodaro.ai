// P14/W4d — the execution's resolved payer rides EVERY dispatch lane out of
// the orchestrator, and nothing below the worker re-resolves it:
//   1. worker-queued nodes: preflight AND reservation receive ctx.billingContext
//      (the same object — the two can never disagree);
//   2. sync-HTTP loopbacks: the validated workspace header is forwarded ONLY
//      for a workspace payer — a personal run's loopback wire shape stays
//      byte-identical to pre-P14;
//   3. component dispatch: the parent's context rides the BODY (the route
//      replies 202 and starts a separate execution — a header dies with the
//      wrapper request);
//   4. sub-workflows: the SAME ctx object flows down (structural inheritance —
//      assert, don't re-resolve).
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockCheckCredits,
  mockReserveCredits,
  mockGetAppSettings,
  mockExecuteSubWorkflow,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockExecuteSubWorkflow: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
  const deleteEqFn = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEqFn })
  const singleFn = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: insertFn,
        update: updateFn,
        delete: deleteFn,
        select: vi.fn(),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn().mockReturnValue({
    jobName: "image-to-video",
    queueName: "video-generation",
    modelIdentifier: "kling:5s",
    payload: { jobId: "test-job-id", provider: "kling", duration: 5, imageUrl: "https://in.png" },
  }),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi
    .fn()
    .mockImplementation((node: unknown) => ({ node, appliedMappings: [] })),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({
  executeSubWorkflow: (...args: unknown[]) => mockExecuteSubWorkflow(...args),
}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import type { BillingContext } from "../../../lib/billing-context.js"

const WS_CTX: BillingContext = {
  payer: "workspace",
  userId: "user-1",
  workspaceId: "ws-1",
  orgId: "org-1",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

function makeCtx(billingContext: BillingContext): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    billingContext,
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
  // Short-circuit before pollJobToCompletion hangs — the assertions are on
  // what the reserve RECEIVED, not on the poll.
  mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
})

describe("W4d — worker-queued nodes carry the execution's payer", () => {
  const node: SimpleNode = { id: "n1", type: "image-to-video", data: { provider: "kling", duration: 5 } }

  it("preflight AND reservation receive the SAME ctx.billingContext", async () => {
    await expect(executeNode(node, {}, [], [], {}, makeCtx(WS_CTX))).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )

    expect(mockCheckCredits).toHaveBeenCalledTimes(1)
    const preflightSurface = mockCheckCredits.mock.calls[0]?.[4] as { billingContext?: BillingContext }
    expect(preflightSurface.billingContext).toBe(WS_CTX)

    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
    const reserveOptions = mockReserveCredits.mock.calls[0]?.[5] as { billingContext?: BillingContext }
    expect(reserveOptions.billingContext).toBe(WS_CTX)
  })

  it("a personal execution threads the personal context — never undefined-with-a-workspace", async () => {
    const personal: BillingContext = { payer: "user", userId: "user-1" }
    await expect(executeNode(node, {}, [], [], {}, makeCtx(personal))).rejects.toThrow(
      /reservation-sentinel|Credit reservation failed/,
    )
    const reserveOptions = mockReserveCredits.mock.calls[0]?.[5] as { billingContext?: BillingContext }
    expect(reserveOptions.billingContext).toBe(personal)
  })
})

describe("W4d — sync-HTTP loopbacks forward the ANSWER as the validated header", () => {
  const node: SimpleNode = { id: "n1", type: "image-to-text", data: {} }

  function stubFetch() {
    const calls: Array<{ headers: Record<string, string>; body: string }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
        calls.push({ headers: init.headers, body: init.body })
        return { ok: true, json: async () => ({ text: "ok" }) }
      }),
    )
    return calls
  }

  it("a workspace payer forwards the workspace header", async () => {
    const calls = stubFetch()
    await executeNode(node, { imageUrl: "https://in.png" }, [], [], {}, makeCtx(WS_CTX)).catch(() => null)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.headers["x-nodaro-workspace"]).toBe("ws-1")
  })

  it("a personal payer sends NO workspace header — the loopback wire shape is pre-P14 byte-identical", async () => {
    const calls = stubFetch()
    await executeNode(node, { imageUrl: "https://in.png" }, [], [], {}, makeCtx({ payer: "user", userId: "user-1" })).catch(
      () => null,
    )
    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0]?.headers ?? {})).not.toContain("x-nodaro-workspace")
  })
})

describe("W4d — component dispatch forwards the parent's payer in the BODY", () => {
  const node: SimpleNode = { id: "n1", type: "component", data: { appSlug: "my-comp", componentMetadata: { inputs: [], outputs: [], exposedSettings: [] } } }

  it("the /v1/component/execute body carries ctx.billingContext verbatim", async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>)
        return { ok: true, json: async () => ({ jobId: "wrapper-1" }) }
      }),
    )
    await executeNode(node, {}, [], [], {}, makeCtx(WS_CTX)).catch(() => null)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.billingContext).toEqual(WS_CTX)
  })
})

describe("W4d — sub-workflows inherit the parent ctx object", () => {
  it("executeSubWorkflow receives the SAME ctx (same billingContext reference) — never a re-resolve", async () => {
    const node: SimpleNode = { id: "sw", type: "sub-workflow", data: { workflowId: "ref" } }
    mockExecuteSubWorkflow.mockResolvedValue({ output: { text: "hi" }, creditsUsed: 0 })
    const ctx = makeCtx(WS_CTX)

    await executeNode(node, {}, [], [node], {}, ctx)

    expect(mockExecuteSubWorkflow).toHaveBeenCalledTimes(1)
    const passedCtx = mockExecuteSubWorkflow.mock.calls[0]?.[2] as OrchestratorContext
    expect(passedCtx).toBe(ctx)
    expect(passedCtx.billingContext).toBe(WS_CTX)
  })
})
