/**
 * PR9 (2026-09-03) — `error_hint` propagation through `pollJobToCompletion`.
 *
 * `video-worker.ts` writes `jobs.error_hint` (migration 376) on a FINAL
 * content-policy failure (`{ kind: "safety-block", class, retried,
 * suggestedProvider? }` — see `lib/safety-block.ts`). Nothing downstream of
 * the poll read it: `pollJobToCompletion` (node-executor.ts) threw a plain
 * `Error(errorMessage)` on a failed job, dropping the hint before it could
 * ride into `nodeStates[nodeId]` the way a mapped billing refusal's
 * `errorCode` already does (see `seedance2-ref-video-reserve.test.ts`'s
 * `video_too_long` precedent).
 *
 * Mirrors the mocking style of `video-analysis-orchestrated.test.ts`: only
 * the external boundaries (Supabase job lifecycle, CreditsService, BullMQ
 * queues) are mocked; payload-builder and the rest of node-executor stay
 * real, so this proves the ACTUAL throw site attaches `errorHint`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCheckCredits, mockReserveCredits, mockVideoAdd, mockRenderAdd } = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockVideoAdd: vi.fn(),
  mockRenderAdd: vi.fn(),
}))

const JOB_ID = "job-eh-orch-1"
let jobRecord: Record<string, unknown> = {}

vi.mock("../../../lib/supabase.js", () => {
  const builder = {
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: JOB_ID }, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: jobRecord }) }) }),
  }
  return { supabase: { from: () => builder } }
})

vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: mockVideoAdd } }))
vi.mock("../../../lib/render-queue.js", () => ({ renderQueue: { add: mockRenderAdd } }))
vi.mock("../../../workers/shared.js", () => ({ refundJobCredits: vi.fn() }))
vi.mock("../../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }),
}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

function vaNode(): SimpleNode {
  return { id: "va", type: "video-analysis", data: { youtubeUrl: "https://youtu.be/abc123" } }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

describe("pollJobToCompletion — error_hint propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
    mockReserveCredits.mockResolvedValue({ usageLogId: "usage-eh-1", creditsReserved: 3, watermark: false })
  })

  it("attaches errorHint to the thrown error when the failed job carries a safety-block hint", async () => {
    jobRecord = {
      status: "failed",
      output_data: null,
      error_message: "The provider's safety filter blocked this output.",
      error_hint: { kind: "safety-block", class: "safety", retried: true, suggestedProvider: "nano-banana-pro" },
      progress: 0,
    }

    const node = vaNode()
    let caught: unknown
    try {
      await executeNode(node, {}, [], [node], {}, makeCtx())
      throw new Error("expected executeNode to reject")
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe("The provider's safety filter blocked this output.")
    expect((caught as { errorHint?: unknown }).errorHint).toEqual({
      kind: "safety-block",
      class: "safety",
      retried: true,
      suggestedProvider: "nano-banana-pro",
    })
  })

  it("leaves errorHint undefined for a failed job with no classified hint", async () => {
    jobRecord = {
      status: "failed",
      output_data: null,
      error_message: "Provider timeout after 30s",
      progress: 0,
    }

    const node = vaNode()
    let caught: unknown
    try {
      await executeNode(node, {}, [], [node], {}, makeCtx())
      throw new Error("expected executeNode to reject")
    } catch (err) {
      caught = err
    }

    expect((caught as Error).message).toBe("Provider timeout after 30s")
    expect((caught as { errorHint?: unknown }).errorHint).toBeUndefined()
  })
})
