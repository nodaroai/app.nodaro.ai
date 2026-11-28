// @test-units-by-name it names only Seedance models and video job types, never a node unit
/**
 * The stop rule in the workflow engine's cancel (node-executor.ts
 * `cancelJobAndThrow`, reached by a workflow Stop, an app run's cancel and a
 * node's timeout): a Seedance 2.x video job whose task already started is NOT
 * cancelled — it keeps running (it finishes in the library and is charged by
 * its own settle), nothing is refunded, and the node fails with the
 * "stopped, finishing" code. Before a task exists the cancel is free, as
 * always — and its write only flips a row that still has no task.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  flips: [] as Array<{ filters: string[] }>,
  refunds: [] as string[],
  stopped: [] as string[],
  readError: false,
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const filters: string[] = []
      let updating = false
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.update = () => ((updating = true), chain)
      chain.eq = (c: string) => (filters.push(`eq:${c}`), chain)
      chain.in = (c: string, values: string[]) => (filters.push(`in:${c}=${values.join(",")}`), chain)
      chain.not = (c: string) => (filters.push(`not:${c}`), chain)
      chain.is = (c: string, v: unknown) => (filters.push(`is:${c}=${String(v)}`), chain)
      chain.maybeSingle = async () => h.readError ? { data: null, error: { message: "connection closed" } } : { data: h.row, error: null }
      chain.single = async () => ({ data: h.row, error: null })
      chain.insert = () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) })
      chain.then = (ok: (v: unknown) => unknown) => {
        if (!updating) return Promise.resolve({ data: h.row, error: null }).then(ok)
        h.flips.push({ filters: [...filters] })
        // The task-less CAS misses a row whose task exists; the plain one flips it.
        const missed = filters.includes("is:provider_task_id=null") && typeof h.row.provider_task_id === "string"
        return Promise.resolve({ data: missed ? [] : [{ id: "j-1", user_id: "u-1", provider_task_id: h.row.provider_task_id ?? null }], error: null }).then(ok)
      }
      return chain
    },
  },
}))
vi.mock("../../../lib/config.js", async (orig) => ({ ...(await orig<typeof import("../../../lib/config.js")>()), hasCredits: () => true }))
vi.mock("../../../workers/shared.js", () => ({ requestJobStop: async (id: string) => { h.stopped.push(id) }, refundJobCredits: vi.fn(async (_l: unknown, id: string) => { h.refunds.push(id) }) }))
vi.mock("../../../lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: vi.fn(async (id: string) => { h.refunds.push(id) }) }))
vi.mock("../../../lib/cancel-job.js", () => ({ settleMeteredHoldsBeforeCancel: async () => "not-metered", settleMeteredHoldAfterFlip: async () => "refund" }))
vi.mock("../../../lib/llm-side-hold.js", () => ({ settleSideHoldsAfterFlip: async () => {} }))
vi.mock("../../../lib/concurrency-lanes/withdraw.js", () => ({ withdrawFromLane: async () => {} }))

const { cancelJobAndThrow } = await import("../node-executor.js")
const { STOPPED_FINISHING_CODE, TIMED_OUT_FINISHING_CODE } = await import("../../../lib/stop-rule.js")

const ctx = { userId: "u-1", stepCharges: undefined } as never
const thrown = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error & { errorCode?: string })

beforeEach(() => {
  h.flips = []
  h.refunds = []
  h.stopped = []
  h.readError = false
})

describe("cancelJobAndThrow — the stop rule", () => {
  it("a started Seedance 2.x job is left running: no flip, no refund, the node reads 'stopped, finishing'", async () => {
    h.row = { status: "processing", job_type: "image-to-video", provider_task_id: "kie-task-1", model: "seedance-2-5" }
    const err = await thrown(cancelJobAndThrow("j-1", "log-1", "Execution cancelled", "generate-video", 100, ctx))
    expect(err?.errorCode).toBe(STOPPED_FINISHING_CODE)
    expect(h.flips).toEqual([])
    expect(h.refunds).toEqual([])
  })

  it("leaves the paid job with its reservation if its started state cannot be verified", async () => {
    h.readError = true
    const err = await thrown(cancelJobAndThrow("j-1", "log-1", "Execution cancelled", "generate-video", 100, ctx))
    expect(err?.message).toContain("Could not verify")
    expect(h.refunds).toEqual([])
    expect(h.flips).toEqual([])
  })

  it("on the route too (its task reference, or a claim with a start in flight)", async () => {
    h.row = { status: "processing", job_type: "voiced-video", provider_task_id: "alt:claimed", model: "seedance-2" }
    expect((await thrown(cancelJobAndThrow("j-1", "log-1", "Execution cancelled", "voiced-video", 100, ctx)))?.errorCode).toBe(STOPPED_FINISHING_CODE)
    expect(h.refunds).toEqual([])
  })

  it("a node timeout follows the same rule, with its own words", async () => {
    h.row = { status: "processing", job_type: "extend-video", provider_task_id: "kie-task-2", model: "seedance-2-5-flash" }
    const err = await thrown(cancelJobAndThrow("j-1", "log-1", "Node timeout: …", "extend-video", 100, ctx))
    expect(err?.errorCode).toBe(TIMED_OUT_FINISHING_CODE)
    expect(h.refunds).toEqual([])
  })

  it("before a task exists the cancel is free, and its write flips only a row with no task", async () => {
    h.row = { status: "processing", job_type: "image-to-video", provider_task_id: null, model: "seedance-2-5" }
    const err = await thrown(cancelJobAndThrow("j-1", "log-1", "Execution cancelled", "generate-video", 100, ctx))
    expect(err?.message).toBe("Execution cancelled")
    expect(h.flips[0]!.filters).toContain("is:provider_task_id=null")
    expect(h.refunds).toContain("j-1")
  })

  it.each(["generate-video-pro", "edit-video-pro", "ugc-clip"])("%s stops after current work and leaves the parent with its hold", async (jobType) => {
    h.row = { status: "processing", job_type: jobType, model: "seedance-2-5" }
    const err = await thrown(cancelJobAndThrow("j-1", "log-1", "Execution cancelled", jobType, 100, ctx))
    expect(err?.errorCode).toBe("stopped_finishing")
    expect(h.stopped).toEqual(["j-1"])
    expect(h.flips).toEqual([])
    expect(h.refunds).toEqual([])
  })

  it.each(["generate-video-pro", "edit-video-pro", "ugc-clip"])("a queued %s with no started segment cancels and refunds immediately", async (jobType) => {
    h.row = { status: "queued", job_type: jobType, model: "seedance-2-5" }
    const err = await thrown(cancelJobAndThrow("j-1", "log-1", "Execution cancelled", jobType, 100, ctx))
    expect(err?.message).toBe("Execution cancelled")
    expect(h.flips[0]?.filters).toContain("in:status=queued,pending")
    expect(h.flips[0]?.filters).toContain("is:video_send_started_at=null")
    expect(h.refunds).toEqual(["j-1"])
  })

  it.each([["extend-video", "seedance-2-5-extend"], ["video-upscale", "seedance-2-5-hd"]])("%s recognizes a started submit even before a task id exists", async (jobType, provider) => {
    h.row = { status: "processing", job_type: jobType, model: provider, provider_task_id: null, video_send_started_at: new Date().toISOString() }
    const err = await thrown(cancelJobAndThrow("j-1", "log-1", "Execution cancelled", jobType, 100, ctx))
    expect(err?.errorCode).toBe("stopped_finishing")
    expect(h.flips).toEqual([])
    expect(h.refunds).toEqual([])
  })

  it("a model the rule does not follow is cancelled and refunded as always, even with a task", async () => {
    h.row = { status: "processing", job_type: "image-to-video", provider_task_id: "kie-task-3", model: "kling-3.0" }
    const err = await thrown(cancelJobAndThrow("j-1", "log-1", "Execution cancelled", "generate-video", 100, ctx))
    expect(err?.message).toBe("Execution cancelled")
    expect(h.flips[0]!.filters).not.toContain("is:provider_task_id=null")
    expect(h.refunds).toContain("j-1")
  })
})
