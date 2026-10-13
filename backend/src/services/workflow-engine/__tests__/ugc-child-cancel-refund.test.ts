/**
 * A child job the orchestrator polls without its usage log — UGC Creator's
 * image, started through its public route, which reserved it — is refunded
 * when the run cancels it: the poll's cancel flips the row and gives back the
 * reservation found by the job. Before, the refund stopped at the missing log
 * id, and the worker, which drops the result of a job it finds cancelled
 * (trusting the canceller to have refunded), left the reservation held.
 *
 * Exactly once: a second cancel of the same job flips nothing and refunds
 * nothing, and a refund finds no reservation that is no longer `reserved`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SimpleNode } from "../types.js"

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refundCredits: vi.fn(),
  refundJobCredits: vi.fn(),
  /** jobs rows by id. */
  jobs: new Map<string, Record<string, unknown>>(),
  /** usage_logs rows. */
  logs: [] as Array<{ id: string; job_id: string; status: string }>,
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000, INTERNAL_ORCHESTRATOR_SECRET: "test-orchestrator-secret" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const TERMINAL = new Set(["completed", "failed", "cancelled"])
  function builder(table: string) {
    let op: "select" | "update" | "insert" = "select"
    let patch: Record<string, unknown> = {}
    const filters: Record<string, unknown> = {}
    let excludeTerminal = false
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.update = (p: Record<string, unknown>) => { op = "update"; patch = p; return b }
    b.insert = () => { op = "insert"; return b }
    b.eq = (column: string, value: unknown) => { filters[column] = value; return b }
    b.not = () => { excludeTerminal = true; return b }
    for (const m of ["in", "order", "limit", "is", "neq"]) b[m] = () => b
    const result = () => {
      if (table === "jobs") {
        const row = h.jobs.get(String(filters.id))
        if (op === "update") {
          if (!row || (excludeTerminal && TERMINAL.has(String(row.status)))) return { data: [], error: null }
          Object.assign(row, patch)
          return { data: [{ id: filters.id, user_id: "user-1", provider_task_id: null, provider_kind: null, model_identifier: null, credits: 45 }], error: null }
        }
        return { data: row ?? null, error: null }
      }
      if (table === "usage_logs") {
        return { data: h.logs.filter((l) => l.job_id === filters.job_id && (filters.status === undefined || l.status === filters.status)).map((l) => ({ id: l.id })), error: null }
      }
      return { data: { status: "running" }, error: null }
    }
    b.single = async () => {
      const r = result()
      return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }
    }
    b.maybeSingle = b.single
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej)
    return b
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    checkCredits: vi.fn(),
    reserveCredits: vi.fn(),
    // The settler's CAS: only a reserved log is refunded.
    refundCredits: h.refundCredits.mockImplementation(async (id: string) => {
      const log = h.logs.find((l) => l.id === id)
      if (log?.status === "reserved") log.status = "refunded"
    }),
  },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn() } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: h.refundJobCredits }))
vi.mock("../loopback-fetch.js", () => ({ loopbackFetch: h.fetchMock }))

import { refundReservedCreditsForJob } from "../../../lib/credits-job-lifecycle.js"
import { executeNode } from "../node-executor.js"

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
const CHECK = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
const ANSWER = {
  kind: "sampled", seed: 7, gender: "woman", traits: { t: 1 }, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
  image: { tool: "generate_image", args: { prompt: "p", model: "image-model-a", aspect_ratio: "3:4" } },
  realismPass: null, secondFrame: null, photoCheck: null, genderCheck: CHECK,
}
const creator: SimpleNode = { id: "creator", type: "ugc-creator", data: { label: "c", source: "sampled", gender: "woman", keepResult: false } }

/** One run of the creator whose image job is in flight when the run is cancelled. */
async function cancelledRun() {
  const ctx = {
    executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual",
    billingContext: { payer: "user", userId: "user-1" }, cancelled: false, isAppRun: false, onJobCreated: vi.fn(),
  }
  h.fetchMock.mockReset()
  h.fetchMock
    .mockResolvedValueOnce(reply(200, ANSWER))                                    // the builder
    .mockImplementationOnce(async () => { ctx.cancelled = true; return reply(200, { jobId: "img-1" }) })  // the image job starts; the run is cancelled
  await expect(executeNode(creator, { ugc: { category: "saas" } } as never, [], [creator], {}, ctx as never)).rejects.toThrow("Execution cancelled")
}

beforeEach(() => {
  vi.clearAllMocks()
  h.jobs.clear()
  h.jobs.set("img-1", { id: "img-1", status: "processing", output_data: null, error_message: null, progress: 10, credits_actual: null, credits: 45, error_hint: null })
  h.logs = [{ id: "log-img-1", job_id: "img-1", status: "reserved" }]
})

describe("a cancelled run's in-flight UGC Creator image job", () => {
  it("is cancelled and its reservation refunded, found by the job", async () => {
    await cancelledRun()
    expect(h.jobs.get("img-1")!.status).toBe("cancelled")
    expect(h.refundCredits).toHaveBeenCalledTimes(1)
    expect(h.refundCredits).toHaveBeenCalledWith("log-img-1")
    expect(h.logs[0]!.status).toBe("refunded")
  })
  it("a second cancel of the same job refunds nothing", async () => {
    await cancelledRun()
    await cancelledRun()                     // the route hands the same job back; it is already cancelled
    expect(h.refundCredits).toHaveBeenCalledTimes(1)
  })
  it("a refund of a job whose reservation was already given back finds nothing to refund", async () => {
    expect(await refundReservedCreditsForJob("img-1")).toBe(1)
    expect(await refundReservedCreditsForJob("img-1")).toBe(0)
    expect(h.refundCredits).toHaveBeenCalledTimes(1)
  })
})
