/**
 * createPipeline() when the queue refuses the new pipeline's first drive. The
 * pipeline was inserted `queued` and its upfront credits reserved; nothing
 * else would ever end it (the reconcile cron reads only running/stopping
 * pipelines, the queued sweep only those a run lane parked), so it would sit
 * holding its reservation. It is settled at once (queue-failure.ts
 * `settleUnqueuedPipeline`: failed from `queued`, refunded) and the caller —
 * POST /v1/pipelines or MCP start_pipeline — answers 500. One a drive claimed
 * meanwhile (the add was delivered with its answer lost) runs: created.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  enqueuePipelineRun: vi.fn(),
  settleUnqueuedPipeline: vi.fn(),
  reservePipelineCredits: vi.fn(),
  inserted: [] as Record<string, unknown>[],
}))

vi.mock("../llms/prompt-registry.js", () => ({ pipelinePromptsAvailable: () => true }))
vi.mock("@nodaro/shared/pipeline", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  validateDurationForFormat: () => ({ ok: true }),
  validateModeActivation: () => ({ ok: true }),
}))
vi.mock("../../../lib/deployment-payer.js", () => ({ coverageOf: () => null, payerCoverage: () => null }))
vi.mock("../credits.js", () => ({
  estimateUpfrontCredits: () => 100,
  reservePipelineCredits: m.reservePipelineCredits,
  resolveMaxCostCredits: () => 500,
  DEFAULT_SHOT_VIDEO_MODEL: null,
}))
vi.mock("../queue.js", () => ({ enqueuePipelineRun: m.enqueuePipelineRun }))
vi.mock("../queue-failure.js", () => ({ settleUnqueuedPipeline: m.settleUnqueuedPipeline }))

import { createPipeline, UNQUEUED_PIPELINE_CLIENT_MESSAGE } from "../create-pipeline.js"

/** profiles (the creator's tier) and pipelines (the insert). */
function fakeSupabase() {
  return {
    from: (table: string) => {
      if (table === "profiles") {
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = () => q
        q.single = () => Promise.resolve({ data: { tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0 }, error: null })
        return q
      }
      return {
        insert: (row: Record<string, unknown>) => {
          m.inserted.push(row)
          return { select: () => ({ single: async () => ({ data: { id: "pipe-1" }, error: null }) }) }
        },
      }
    },
  }
}

const INPUT = { story_prompt: "a story", target_duration_seconds: 60, format: "short_film", pipeline_type: "story_to_video", root_node_id: "n1", mode: "auto" }
const create = () => createPipeline({ supabase: fakeSupabase() as never, userId: "u1", input: INPUT as never })

beforeEach(() => {
  vi.clearAllMocks()
  m.inserted = []
  m.enqueuePipelineRun.mockResolvedValue(undefined)
  m.reservePipelineCredits.mockResolvedValue({ ok: true })
})

describe("createPipeline — a first drive the queue refuses", () => {
  it("a drive the queue takes: created, nothing settled", async () => {
    expect(await create()).toEqual({ ok: true, pipelineId: "pipe-1" })
    expect(m.enqueuePipelineRun).toHaveBeenCalledWith({ pipelineId: "pipe-1", userId: "u1", reason: "initial" })
    expect(m.settleUnqueuedPipeline).not.toHaveBeenCalled()
  })

  it.each([["failed"], ["unsettled"]] as const)("settled (%s) at once, and answered 500", async (outcome) => {
    const refused = new Error("OOM command not allowed when used memory > 'maxmemory'.")
    m.enqueuePipelineRun.mockRejectedValueOnce(refused)
    m.settleUnqueuedPipeline.mockResolvedValueOnce(outcome)
    expect(await create()).toEqual({ ok: false, status: 500, code: "internal_error", message: UNQUEUED_PIPELINE_CLIENT_MESSAGE })
    expect(m.settleUnqueuedPipeline).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: "pipe-1", userId: "u1", err: refused }))
  })

  it("one a drive claimed meanwhile (the add was delivered after all) is answered as created", async () => {
    m.enqueuePipelineRun.mockRejectedValueOnce(new Error("Connection is closed."))
    m.settleUnqueuedPipeline.mockResolvedValueOnce("moved-on")
    expect(await create()).toEqual({ ok: true, pipelineId: "pipe-1" })
  })
})
