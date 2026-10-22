/**
 * R38 item 2: a SYNCHRONOUS metered LLM route stamps its call's start with a
 * CAS on a live status — never an unconditional write. A job cancelled between
 * its reserve and that stamp is never sent the provider call: the CAS misses,
 * the hold is released through the normal settle (an empty spend → refunded),
 * and the route answers without calling. Under the rollback (a tier hold) the
 * stamp is today's unconditional write, byte-identical.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  row: { id: "job-1", status: "pending", provider_call_started_at: null as string | null } as Record<string, unknown>,
  writes: [] as Array<{ patch: Record<string, unknown>; statuses?: unknown[] }>,
  writeError: null as { message: string } | null,
  settleImpl: vi.fn(async (..._a: unknown[]) => ({ outcome: "refunded" })),
  failed: vi.fn(async (..._a: unknown[]) => true),
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      let patch: Record<string, unknown> | null = null
      let statuses: unknown[] | undefined
      const run = async () => {
        if (!patch) return { data: null, error: null }
        h.writes.push({ patch, statuses })
        if (h.writeError) return { data: null, error: h.writeError }
        const hit = statuses === undefined || statuses.includes(h.row.status)
        if (hit) Object.assign(h.row, patch)
        return { data: hit ? [{ id: "job-1" }] : [], error: null }
      }
      const b: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => { patch = p; return b },
        eq: () => b,
        in: (_c: string, v: unknown[]) => { statuses = v; return b },
        select: () => b,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      }
      return b
    },
  },
}))
vi.mock("../config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../config.js")>()), hasCredits: () => true }))
vi.mock("../job-failure.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../job-failure.js")>()), markJobFailed: h.failed }))
vi.mock("../../ee/billing/llm-billing-impl.js", () => ({ settleLlmUsageLogImpl: h.settleImpl }))

import { stampSyncLlmCallStart, type LlmReserveResult } from "../llm-billing.js"
import { markProviderCallStartIfLive } from "../reconcile/persistence.js"

const metered = { metered: true, chargeId: "llm-chat:claude-sonnet-5.5", holdCredits: 12, reservation: { usageLogId: "log-1" } } as unknown as LlmReserveResult
function reply() {
  const r = { sent: false, code: 0, body: undefined as unknown, status(c: number) { r.code = c; return r }, send(b: unknown) { r.body = b; r.sent = true; return r } }
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  h.row = { id: "job-1", status: "pending", provider_call_started_at: null }
  h.writes = []
  h.writeError = null
})

describe("markProviderCallStartIfLive", () => {
  it("stamps a live row (CAS on the live statuses, never cancelled)", async () => {
    expect(await markProviderCallStartIfLive("job-1", "anthropic-sync")).toBe("started")
    expect(h.row.provider_call_started_at).toEqual(expect.any(String))
    expect(h.writes[0]!.statuses).not.toContain("cancelled")
  })
  it("misses a cancelled row", async () => {
    h.row.status = "cancelled"
    expect(await markProviderCallStartIfLive("job-1", "anthropic-sync")).toBe("not-live")
    expect(h.row.provider_call_started_at).toBeNull()
  })
  it("a failed write is an error, never 'started'", async () => {
    h.writeError = { message: "timeout" }
    expect(await markProviderCallStartIfLive("job-1", "anthropic-sync")).toBe("error")
  })
})

describe("stampSyncLlmCallStart", () => {
  it("a live metered job: stamped, the route goes on", async () => {
    const r = reply()
    expect(await stampSyncLlmCallStart("job-1", metered, r as never)).toBe(true)
    expect(r.sent).toBe(false)
    expect(h.settleImpl).not.toHaveBeenCalled()
  })

  it("cancelled between reserve and stamp: no call (false), the hold released through the settle (an empty spend → refund), 409", async () => {
    h.row.status = "cancelled"
    const r = reply()
    expect(await stampSyncLlmCallStart("job-1", metered, r as never)).toBe(false)
    expect(h.settleImpl).toHaveBeenCalledTimes(1)
    expect((h.settleImpl.mock.calls[0]![3] as { billedAnything: boolean }).billedAnything).toBe(false)
    expect(r.code).toBe(409)
    expect(h.row.status).toBe("cancelled")
    expect(h.failed).not.toHaveBeenCalled()
  })

  it("a stamp that cannot be written: no call either (a cancel would refund it mid-flight) — refunded, failed, 503", async () => {
    h.writeError = { message: "timeout" }
    const r = reply()
    expect(await stampSyncLlmCallStart("job-1", metered, r as never)).toBe(false)
    expect(h.settleImpl).toHaveBeenCalledTimes(1)
    expect(h.failed).toHaveBeenCalledTimes(1)
    expect(r.code).toBe(503)
  })

  it("a tier hold (the rollback): today's unconditional stamp, byte-identical", async () => {
    h.row.status = "cancelled"
    expect(await stampSyncLlmCallStart("job-1", { metered: false }, reply() as never)).toBe(true)
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0]!.statuses).toBeUndefined()
    expect(h.writes[0]!.patch).toMatchObject({ provider_kind: "anthropic-sync" })
  })
})
