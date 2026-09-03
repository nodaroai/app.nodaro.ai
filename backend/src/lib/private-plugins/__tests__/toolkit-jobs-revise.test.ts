/**
 * The three revise-lane jobs members (2026-08-03, recast creative direction):
 *
 *  - `markJobFailed` — route-side CAS fail for the first SYNCHRONOUS priced
 *    route (`/v1/recast/revise` has no worker to own its failure path). Its
 *    BODY now delegates to `lib/job-failure.ts` (the one failure writer), so
 *    it flips FAILABLE_STATUSES — every live status except the parked one — and
 *    a concurrent completion/cancel, or a job under review, is never clobbered.
 *    The surface (and the refund-only-on-true contract) is unchanged.
 *  - `refundJobCredits` — exposes the worker-layer refund to routes. Falsy
 *    usageLogId is a no-op (reserve never happened / already aborted).
 *  - `hasWaivingRecastRun` — the direction gate's re-take waiver predicate,
 *    as ONE dedicated query (the generic select mirror can't express it, and
 *    `maybeSingle()` would ERROR on a user with ≥2 completed runs — hence
 *    `.limit(1)`, asserted here as a regression net).
 *
 * Mocking convention mirrors toolkit-jobs.test.ts: full-replace only the
 * modules the members under test call, via a thenable chain recorder.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type ChainResult = { data: unknown; error: { message: string } | null }

const { state, mockSharedRefund } = vi.hoisted(() => {
  const state = { result: { data: null, error: null } as ChainResult, chains: [] as any[] }
  return { state, mockSharedRefund: vi.fn() }
})

/** A thenable supabase query-builder recorder: every method returns the chain,
 *  awaiting it resolves the configured result, calls are inspectable. */
function makeChain() {
  const chain: Record<string, any> = {}
  for (const m of ["update", "select", "eq", "in", "or", "limit", "maybeSingle", "single"]) {
    chain[m] = vi.fn(() => chain)
  }
  chain.then = (resolve: (v: ChainResult) => unknown) => Promise.resolve(state.result).then(resolve)
  state.chains.push(chain)
  return chain
}

vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, hasCredits: () => true }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => makeChain()) },
}))

vi.mock(import("@/workers/shared.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, refundJobCredits: mockSharedRefund }
})

import { buildToolkit } from "../toolkit.js"
import type { PluginToolkit } from "../types.js"

function lastChain() {
  return state.chains[state.chains.length - 1]!
}

describe("tk.jobs revise-lane members", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    vi.clearAllMocks()
    state.chains.length = 0
    state.result = { data: null, error: null }
    tk = buildToolkit()
  })

  describe("markJobFailed", () => {
    it("CAS-flips a live row to failed with the message and reports true", async () => {
      state.result = { data: [{ id: "job-1" }], error: null }

      await expect(tk.jobs.markJobFailed!("job-1", "revision_unusable")).resolves.toBe(true)

      const chain = lastChain()
      const update = chain.update.mock.calls[0]![0] as Record<string, unknown>
      expect(update.status).toBe("failed")
      expect(update.error_message).toBe("revision_unusable")
      expect(typeof update.completed_at).toBe("string")
      expect(chain.eq).toHaveBeenCalledWith("id", "job-1")
      // Live-status CAS — a completed/cancelled/failed row is never clobbered,
      // and neither is a `pending_review` one. "queued" is newly failable: the
      // old hand-rolled copy could not fail a queued row at all (spec D11).
      expect(chain.in).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
    })

    it("returns false when the row was already terminal (no rows flipped)", async () => {
      state.result = { data: [], error: null }
      await expect(tk.jobs.markJobFailed!("job-2", "x")).resolves.toBe(false)
    })
  })

  describe("refundJobCredits", () => {
    it("delegates to the worker-layer refund with the usage log, job, and reason", async () => {
      await tk.jobs.refundJobCredits!("ul-1", "job-1", "revision_unusable")
      expect(mockSharedRefund).toHaveBeenCalledWith("ul-1", "job-1", "revision_unusable")
    })

    it("no-ops on an empty usageLogId (reserve never landed)", async () => {
      await tk.jobs.refundJobCredits!("", "job-1", "reserve-aborted")
      expect(mockSharedRefund).not.toHaveBeenCalled()
    })
  })

  describe("hasWaivingRecastRun", () => {
    const q = {
      userId: "u-1",
      workflowId: "wf-1",
      analysisJobId: "aj-1",
      cutoverIso: "2026-08-03T16:00:00.000Z",
    }

    it("true when one qualifying completed planning run exists — and never uses maybeSingle (≥2 rows must not throw)", async () => {
      state.result = { data: [{ id: "job-9" }], error: null }

      await expect(tk.jobs.hasWaivingRecastRun!(q)).resolves.toBe(true)

      const chain = lastChain()
      // The full predicate, every arm — a dropped filter is the S2 bypass class.
      expect(chain.eq).toHaveBeenCalledWith("user_id", "u-1")
      expect(chain.eq).toHaveBeenCalledWith("workflow_id", "wf-1")
      expect(chain.eq).toHaveBeenCalledWith("app_slug", "recast")
      expect(chain.eq).toHaveBeenCalledWith("status", "completed")
      // Planning rows only — a `recast-revise` row must never disarm the gate.
      expect(chain.eq).toHaveBeenCalledWith("input_data->>type", "recast")
      expect(chain.eq).toHaveBeenCalledWith("input_data->>analysisJobId", "aj-1")
      // Pre-cutover OR carried-direction — the waiver's two arms in one .or().
      const orArg = chain.or.mock.calls[0]![0] as string
      expect(orArg).toContain(`created_at.lt.${q.cutoverIso}`)
      expect(orArg).toContain("input_data->direction.not.is.null")
      expect(chain.limit).toHaveBeenCalledWith(1)
      expect(chain.maybeSingle).not.toHaveBeenCalled()
      expect(chain.single).not.toHaveBeenCalled()
    })

    it("false when no row qualifies", async () => {
      state.result = { data: [], error: null }
      await expect(tk.jobs.hasWaivingRecastRun!(q)).resolves.toBe(false)
    })
  })
})
