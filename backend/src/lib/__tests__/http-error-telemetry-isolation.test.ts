/**
 * A telemetry write must not land on a Supabase mock installed after it began.
 *
 * `sendInternalError` files a best-effort `app_reports` row and deliberately
 * does NOT await it: telemetry must never add latency to, or fail, the reply it
 * observes. The consequence in tests is that the write runs after the request
 * is answered — and route suites share ONE module-level `supabase.from` mock
 * that each test re-points at its own chain. A straggler therefore gets
 * recorded against whichever test happens to be running, as an `.insert()`
 * that test never made.
 *
 * That is what produced the long-standing "expected 4 calls, got 5" flake in
 * generate-character.test.ts: the two tests before it assert a 500, each fires
 * one report, and under full-suite load one landed inside the next test's
 * window. It reproduced roughly one run in three and never in isolation, and
 * 13 route suites assert a 500 AND count mock calls, so it was not confined to
 * that file.
 *
 * The fix is a real barrier: `__flushHttpErrorTelemetry()` settles the writes,
 * and `src/test/setup.ts` drains after every test. This pins the property that
 * barrier exists for — remove the drain and this test fails deterministically,
 * which the flake itself never did.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { supabase } from "../supabase.js"
import {
  sendInternalError,
  __flushHttpErrorTelemetry,
  __resetHttpErrorTelemetry,
} from "../http-errors.js"

function makeReply() {
  return {
    statusCode: 200 as number,
    status(code: number) {
      this.statusCode = code
      return this
    },
    send() {
      return this
    },
  }
}

function makeReq(): FastifyRequest {
  return {
    log: { error: vi.fn(), warn: vi.fn() },
    method: "POST",
    url: "/v1/things",
    routeOptions: { url: "/v1/things" },
    headers: {},
    userId: "00000000-0000-4000-8000-000000000042",
  } as unknown as FastifyRequest
}

/** One test's Supabase chain, as a route suite would install it. */
function installChain() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  vi.mocked(supabase.from).mockReturnValue({ insert } as never)
  return insert
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetHttpErrorTelemetry()
})

describe("http-error telemetry stays inside the test that started it", () => {
  it("lands on the chain that was current when the request failed, not a later one", async () => {
    const duringFailingRequest = installChain()
    sendInternalError(makeReply() as unknown as FastifyReply, makeReq(), new Error("boom"))

    // The barrier src/test/setup.ts puts at every test boundary.
    await __flushHttpErrorTelemetry()

    // The "next test" now installs its own chain and does its own work.
    const nextTestsChain = installChain()
    await new Promise((resolve) => setImmediate(resolve))

    expect(duringFailingRequest).toHaveBeenCalledTimes(1)
    expect(nextTestsChain).not.toHaveBeenCalled()
  })

  it("the row really is the app_reports telemetry row (not a job insert)", async () => {
    const insert = installChain()
    sendInternalError(makeReply() as unknown as FastifyReply, makeReq(), new Error("boom"))
    await __flushHttpErrorTelemetry()

    const row = insert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(row).toMatchObject({ node: "http-error-net", kind: "internal-error" })
    // The shape that gave the flake away: none of a jobs row's columns.
    expect(row).not.toHaveProperty("input_data")
    expect(row).not.toHaveProperty("workflow_id")
  })
})
