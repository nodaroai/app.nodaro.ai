/**
 * The webhook dispatcher (lib/webhooks/dispatcher.ts): claim this
 * environment's due deliveries, build each body, sign it with the endpoint's
 * own secret, POST it, record the outcome — delivered, retried on the
 * schedule, failed for good, or skipped when its job is gone — in a pool that
 * never sends more than its capacity and claims again as places free up.
 *
 * The database calls are the migration-521 functions; what they do (the
 * lease, the per-endpoint and per-account shares, the closes, the
 * compare-and-set, the failure streak and switch-off) is proven against
 * Postgres in supabase/tests/webhooks.behavior.sql. Here: what the dispatcher
 * asks of them, what it sends, and how the pool schedules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  eventBodyFor: vi.fn(),
  postWebhook: vi.fn(),
  openSigningSecret: vi.fn(),
}))

vi.mock("../../supabase.js", () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock("../event.js", () => ({ eventBodyFor: mocks.eventBodyFor }))
vi.mock("../send.js", () => ({ postWebhook: mocks.postWebhook }))
vi.mock("../secret.js", () => ({ openSigningSecret: mocks.openSigningSecret }))

import { signPayload } from "../signature.js"
import {
  CAPACITY,
  LEASE_SECONDS,
  MIN_CLAIM,
  PER_ACCOUNT,
  PER_ENDPOINT,
  PRUNE_BATCH,
  PRUNE_BUDGET_MS,
  __resetDispatcherReports,
  claimDeliveries,
  processDelivery,
  pruneDeliveries,
  startDeliveryPool,
  startWebhookDispatcher,
  type ClaimBatch,
  type PoolDeps,
} from "../dispatcher.js"
import type { ClaimedDelivery } from "../event.js"
import { CIRCUIT_AFTER_NO_ANSWER, DISABLE_AFTER_FAILED_DELIVERIES, PLATFORM_RETRY_MS } from "../retry.js"

const SECRET = "whsec_unit_test_secret"
const NOW = Date.parse("2026-10-15T10:00:00.000Z")

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    delivery_id: "00000000-0000-4000-8000-0000000000d1",
    webhook_id: "00000000-0000-4000-8000-0000000000e1",
    user_id: "00000000-0000-4000-8000-000000000001",
    job_id: "00000000-0000-4000-8000-0000000000b1",
    event: "job.completed",
    payload: null,
    attempts: 1,
    created_at: "2026-10-15T09:59:59+00:00",
    url: "https://hooks.example.com/in",
    secret_ciphertext: "sealed",
    previous_secret_ciphertext: null,
    runtime_env: "production",
    closed_reason: null,
    ...overrides,
  }
}

function delivery(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    deliveryId: "00000000-0000-4000-8000-0000000000d1",
    webhookId: "00000000-0000-4000-8000-0000000000e1",
    userId: "00000000-0000-4000-8000-000000000001",
    jobId: "00000000-0000-4000-8000-0000000000b1",
    event: "job.completed",
    payload: null,
    attempts: 1,
    createdAt: "2026-10-15T09:59:59+00:00",
    url: "https://hooks.example.com/in",
    secretCiphertext: "sealed",
    previousSecretCiphertext: null,
    runtimeEnv: "production",
    ...overrides,
  }
}

/** The `rpc` mock: `claim` answers the claim; every record answers its status. */
function db(claim: Record<string, unknown>[] | { error: { code: string; message: string } }) {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "claim_webhook_deliveries") {
      return Array.isArray(claim) ? { data: claim, error: null } : { data: null, error: claim.error }
    }
    if (fn === "record_webhook_delivery_attempt") return { data: "pending", error: null }
    if (fn === "prune_webhook_deliveries") return { data: 0, error: null }
    return { data: null, error: { code: "PGRST202", message: "unknown" } }
  })
}

function recorded(): Array<Record<string, unknown>> {
  return mocks.rpc.mock.calls.filter(([fn]) => fn === "record_webhook_delivery_attempt").map(([, args]) => args)
}

const deps = { now: () => NOW, random: () => 0.5, report: vi.fn(), fileReport: vi.fn(async () => true) }

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  deps.report.mockReset()
  deps.fileReport.mockClear()
  __resetDispatcherReports()
  mocks.openSigningSecret.mockReturnValue(SECRET)
  mocks.eventBodyFor.mockResolvedValue({ kind: "body", body: '{"id":"d1","type":"job.completed"}', fresh: true })
  mocks.postWebhook.mockResolvedValue({ ok: true, status: 200, body: "ok", durationMs: 42, error: null })
  db([])
  process.env.RUNTIME_ENV = "production"
})

afterEach(() => {
  delete process.env.RUNTIME_ENV
  vi.useRealTimers()
})

describe("claimDeliveries", () => {
  it("asks for this environment's due deliveries: as many as there is room for, the shares, the lease, the attempt limit", async () => {
    process.env.RUNTIME_ENV = "staging"
    const out = await claimDeliveries(7)
    expect(out).toEqual({ deliveries: [], closed: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith("claim_webhook_deliveries", {
      p_runtime_env: "staging",
      p_limit: 7,
      p_per_endpoint: PER_ENDPOINT,
      p_per_account: PER_ACCOUNT,
      p_lease_seconds: LEASE_SECONDS,
      p_max_attempts: 8,
    })
    expect(LEASE_SECONDS).toBeGreaterThan(10 * 2)
    expect(PER_ENDPOINT).toBeLessThanOrEqual(PER_ACCOUNT)
    expect(PER_ACCOUNT).toBeLessThan(CAPACITY)
  })

  it("hands out the leased rows and counts the ones the claim closed instead", async () => {
    db([
      claimRow({ delivery_id: "00000000-0000-4000-8000-0000000000d1" }),
      claimRow({ delivery_id: "00000000-0000-4000-8000-0000000000d2", closed_reason: "app_revoked", url: null, secret_ciphertext: null }),
      claimRow({ delivery_id: "00000000-0000-4000-8000-0000000000d3", closed_reason: "endpoint_disabled", url: null, secret_ciphertext: null }),
    ])
    const out = await claimDeliveries(25)
    expect(out.closed).toBe(2)
    expect(out.deliveries).toEqual([delivery()])
  })

  it("is idle, not failing, while the database has no webhook functions yet", async () => {
    db({ error: { code: "PGRST202", message: "Could not find the function public.claim_webhook_deliveries" } })
    expect(await claimDeliveries(25)).toEqual({ deliveries: [], closed: 0, unavailable: true })
  })

  it("throws on any other claim error, naming only its code", async () => {
    db({ error: { code: "57014", message: "canceling statement due to statement timeout" } })
    await expect(claimDeliveries(25)).rejects.toThrow(/claim failed \(57014\)/)
  })
})

describe("processDelivery", () => {
  it("signs with the endpoint's own secret, opened for its row and environment, and records the delivery", async () => {
    expect(await processDelivery(delivery(), deps)).toBe("delivered")

    expect(mocks.openSigningSecret).toHaveBeenCalledWith("sealed", {
      endpointId: "00000000-0000-4000-8000-0000000000e1",
      userId: "00000000-0000-4000-8000-000000000001",
      runtimeEnv: "production",
    })
    const [url, body, headers] = mocks.postWebhook.mock.calls[0]!
    expect(url).toBe("https://hooks.example.com/in")
    expect(body).toBe('{"id":"d1","type":"job.completed"}')
    const t = Math.floor(NOW / 1000)
    expect(headers).toMatchObject({
      "Nodaro-Event": "job.completed",
      "Nodaro-Delivery": "00000000-0000-4000-8000-0000000000d1",
      "Nodaro-Webhook": "00000000-0000-4000-8000-0000000000e1",
      "Nodaro-Attempt": "1",
      "Nodaro-Signature": `t=${t},v1=${signPayload(SECRET, t, body)}`,
      "User-Agent": "Nodaro-Webhooks/1",
    })

    expect(recorded()).toEqual([{
      p_delivery_id: "00000000-0000-4000-8000-0000000000d1",
      p_attempt: 1,
      p_outcome: "delivered",
      p_next_retry_at: null,
      p_payload: '{"id":"d1","type":"job.completed"}',
      p_response_status: 200,
      p_response_body: "ok",
      p_duration_ms: 42,
      p_error: null,
      p_disable_after: DISABLE_AFTER_FAILED_DELIVERIES,
      p_circuit_after: CIRCUIT_AFTER_NO_ANSWER,
    }])
  })

  it("during a rotation's grace, signs with both secrets — the new one first", async () => {
    mocks.openSigningSecret.mockImplementation((sealed: string) => (sealed === "sealed" ? SECRET : "whsec_replaced"))
    await processDelivery(delivery({ previousSecretCiphertext: "sealed-before" }), deps)
    expect(mocks.openSigningSecret).toHaveBeenCalledWith("sealed-before", {
      endpointId: "00000000-0000-4000-8000-0000000000e1",
      userId: "00000000-0000-4000-8000-000000000001",
      runtimeEnv: "production",
    })
    const [, body, headers] = mocks.postWebhook.mock.calls[0]!
    const t = Math.floor(NOW / 1000)
    expect(headers["Nodaro-Signature"]).toBe(
      `t=${t},v1=${signPayload(SECRET, t, body)},v1=${signPayload("whsec_replaced", t, body)}`,
    )
  })

  it("if the replaced secret cannot be opened, the new one signs alone", async () => {
    mocks.openSigningSecret.mockImplementation((sealed: string) => {
      if (sealed === "sealed") return SECRET
      throw new Error("Unsupported state or unable to authenticate data")
    })
    expect(await processDelivery(delivery({ previousSecretCiphertext: "sealed-before" }), deps)).toBe("delivered")
    const [, body, headers] = mocks.postWebhook.mock.calls[0]!
    const t = Math.floor(NOW / 1000)
    expect(headers["Nodaro-Signature"]).toBe(`t=${t},v1=${signPayload(SECRET, t, body)}`)
  })

  it("retries a failed attempt on the schedule, keeping the body it sent", async () => {
    mocks.postWebhook.mockResolvedValueOnce({ ok: false, status: 503, body: "busy", durationMs: 12, error: "http_503" })
    expect(await processDelivery(delivery(), deps)).toBe("retry")
    expect(recorded()[0]).toMatchObject({
      p_outcome: "retry",
      p_next_retry_at: new Date(NOW + 30_000).toISOString(),
      p_payload: '{"id":"d1","type":"job.completed"}',
      p_response_status: 503,
      p_response_body: "busy",
      p_error: "http_503",
    })
  })

  it("a retry sends the kept text again, signed anew", async () => {
    const kept = '{"id":"d1","type":"job.completed","data":{"job":{"id":"j"}}}'
    mocks.eventBodyFor.mockResolvedValueOnce({ kind: "body", body: kept, fresh: false })
    await processDelivery(delivery({ payload: kept, attempts: 4 }), deps)
    expect(mocks.postWebhook.mock.calls[0]![1]).toBe(kept)
    expect(mocks.postWebhook.mock.calls[0]![2]).toMatchObject({ "Nodaro-Attempt": "4" })
    expect(recorded()[0]).toMatchObject({ p_attempt: 4, p_payload: null })
  })

  it("fails for good after the last attempt", async () => {
    mocks.postWebhook.mockResolvedValueOnce({ ok: false, status: null, body: null, durationMs: 10_000, error: "timeout" })
    expect(await processDelivery(delivery({ attempts: 8 }), deps)).toBe("failed")
    expect(recorded()[0]).toMatchObject({ p_outcome: "failed", p_next_retry_at: null, p_error: "timeout" })
  })

  it("a test ping is tried once", async () => {
    mocks.postWebhook.mockResolvedValueOnce({ ok: false, status: 404, body: "", durationMs: 5, error: "http_404" })
    await processDelivery(delivery({ event: "ping", jobId: null }), deps)
    expect(recorded()[0]).toMatchObject({ p_outcome: "failed" })
  })

  it("records a refused address as a failed attempt (retried like any other)", async () => {
    mocks.postWebhook.mockResolvedValueOnce({ ok: false, status: null, body: null, durationMs: 3, error: "blocked_address" })
    await processDelivery(delivery(), deps)
    expect(recorded()[0]).toMatchObject({ p_outcome: "retry", p_error: "blocked_address", p_response_status: null })
  })

  it("skips a delivery whose job is gone, without sending", async () => {
    mocks.eventBodyFor.mockResolvedValueOnce({ kind: "missing" })
    expect(await processDelivery(delivery(), deps)).toBe("skipped")
    expect(mocks.postWebhook).not.toHaveBeenCalled()
    expect(recorded()[0]).toMatchObject({ p_outcome: "skipped", p_error: "job_deleted", p_payload: null })
  })

  it("what it cannot sign (Nodaro's side) is deferred — attempt given back, nothing counted — and reported", async () => {
    mocks.openSigningSecret.mockImplementationOnce(() => {
      throw new Error("Unsupported state or unable to authenticate data")
    })
    expect(await processDelivery(delivery({ attempts: 8 }), deps)).toBe("deferred")
    expect(mocks.postWebhook).not.toHaveBeenCalled()
    expect(recorded()[0]).toMatchObject({
      p_attempt: 8,
      p_outcome: "deferred",
      p_next_retry_at: new Date(NOW + PLATFORM_RETRY_MS).toISOString(),
      p_error: "signing_unavailable",
      p_payload: null,
      p_response_status: null,
    })
    expect(deps.report).toHaveBeenCalledWith(expect.stringContaining("signing secret could not be opened"))
    await vi.waitFor(() =>
      expect(deps.fileReport).toHaveBeenCalledWith(expect.objectContaining({
        node: "webhook-dispatcher", kind: "webhook-delivery-stalled", severity: "error",
      })),
    )
  })

  it("a job that could not be read is deferred too, and the report is not repeated for every delivery", async () => {
    mocks.eventBodyFor.mockRejectedValue(new Error("could not read the job"))
    await processDelivery(delivery(), deps)
    await processDelivery(delivery({ deliveryId: "00000000-0000-4000-8000-0000000000d2" }), deps)
    expect(mocks.postWebhook).not.toHaveBeenCalled()
    expect(recorded().map((r) => [r.p_outcome, r.p_error])).toEqual([
      ["deferred", "job_unreadable"],
      ["deferred", "job_unreadable"],
    ])
    await vi.waitFor(() => expect(deps.fileReport).toHaveBeenCalledTimes(1))
    expect(deps.report).toHaveBeenCalledTimes(1)
  })

  it("records the outcome without the receiver's answer when the database refuses the answer", async () => {
    mocks.postWebhook.mockResolvedValueOnce({ ok: true, status: 200, body: "odd answer", durationMs: 9, error: null })
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: "22P05", message: "unsupported Unicode escape sequence" } })
      .mockResolvedValueOnce({ data: "delivered", error: null })
    await processDelivery(delivery(), deps)
    expect(recorded()).toHaveLength(2)
    expect(recorded()[0]).toMatchObject({ p_outcome: "delivered", p_response_body: "odd answer" })
    expect(recorded()[1]).toMatchObject({ p_outcome: "delivered", p_response_body: null, p_response_status: 200 })
    expect(deps.report).not.toHaveBeenCalled()
  })

  it("logs nothing it sent: no address, no secret, no body", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom https://hooks.example.com/in" } })
    await processDelivery(delivery(), deps)
    const logged = deps.report.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toContain("XX000")
    expect(logged).not.toContain("hooks.example.com")
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain('"type":"job.completed"')
  })
})

/* ---------------------------------------------------------------- the pool */

/** Sends that end when the test says so, counting how many ran at once. */
function deferredSends() {
  const pending: Array<() => void> = []
  let active = 0
  let most = 0
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        active++
        most = Math.max(most, active)
        pending.push(() => {
          active--
          resolve()
        })
      }),
  )
  return {
    send,
    get most() {
      return most
    },
    finish: async (n: number) => {
      for (let i = 0; i < n; i++) pending.shift()?.()
      await vi.advanceTimersByTimeAsync(0)
    },
  }
}

function deliveries(n: number, from = 0): ClaimedDelivery[] {
  return Array.from({ length: n }, (_, i) => delivery({ deliveryId: `d-${from + i}` }))
}

function poolDeps(overrides: Partial<PoolDeps>): PoolDeps {
  return {
    capacity: 10,
    minClaim: 5,
    idleMs: 5_000,
    unavailableMs: 60_000,
    claim: vi.fn(async (): Promise<ClaimBatch> => ({ deliveries: [], closed: 0 })),
    send: vi.fn(async () => {}),
    onError: vi.fn(),
    ...overrides,
  }
}

describe("startDeliveryPool", () => {
  it("never has more sends in flight than its capacity: each claim asks only for the room there is", async () => {
    vi.useFakeTimers()
    const sends = deferredSends()
    let next = 0
    const claim = vi.fn(async (want: number): Promise<ClaimBatch> => {
      const batch = deliveries(want, next)
      next += want
      return { deliveries: batch, closed: 0 }
    })
    const pool = startDeliveryPool(poolDeps({ capacity: 10, minClaim: 5, claim, send: sends.send }))
    await vi.advanceTimersByTimeAsync(0)
    expect(claim).toHaveBeenNthCalledWith(1, 10)
    expect(pool.inFlight).toBe(10)

    await sends.finish(4) // four free places: below the batch size, no claim yet
    expect(claim).toHaveBeenCalledTimes(1)
    await sends.finish(1) // five free: claim exactly five
    expect(claim).toHaveBeenNthCalledWith(2, 5)
    expect(pool.inFlight).toBe(10)

    await sends.finish(10)
    const stopping = pool.stop()
    await sends.finish(100)
    await stopping
    expect(sends.most).toBe(10)
  })

  it("claims again at once after a claim that handed out or closed something, and waits after one that found nothing", async () => {
    vi.useFakeTimers()
    const answers: ClaimBatch[] = [
      { deliveries: [], closed: 3 }, // closed rows: there may be more, claim again now
      { deliveries: deliveries(1), closed: 0 },
      { deliveries: [], closed: 0 }, // nothing due: wait
    ]
    const claim = vi.fn(async (): Promise<ClaimBatch> => answers.shift() ?? { deliveries: [], closed: 0 })
    const pool = startDeliveryPool(poolDeps({ capacity: 10, minClaim: 5, idleMs: 5_000, claim }))
    await vi.advanceTimersByTimeAsync(0)
    expect(claim).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(claim).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(claim).toHaveBeenCalledTimes(4)
    await pool.stop()
  })

  it("a send that ends looks for more before the idle wait is over", async () => {
    vi.useFakeTimers()
    const sends = deferredSends()
    const answers: ClaimBatch[] = [{ deliveries: deliveries(1), closed: 0 }, { deliveries: [], closed: 0 }]
    const claim = vi.fn(async (): Promise<ClaimBatch> => answers.shift() ?? { deliveries: [], closed: 0 })
    const pool = startDeliveryPool(poolDeps({ capacity: 10, minClaim: 5, idleMs: 5_000, claim, send: sends.send }))
    await vi.advanceTimersByTimeAsync(0)
    expect(claim).toHaveBeenCalledTimes(2)
    await sends.finish(1) // nothing in flight any more: claim now, not in five seconds
    expect(claim).toHaveBeenCalledTimes(3)
    await pool.stop()
  })

  it("reports a claim that failed and tries again after the idle wait; waits longer while the functions are missing", async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const answers: Array<ClaimBatch | Error> = [new Error("claim failed (57014)"), { deliveries: [], closed: 0, unavailable: true }]
    const claim = vi.fn(async (): Promise<ClaimBatch> => {
      const next = answers.shift() ?? { deliveries: [], closed: 0 }
      if (next instanceof Error) throw next
      return next
    })
    const pool = startDeliveryPool(poolDeps({ idleMs: 5_000, unavailableMs: 60_000, claim, onError }))
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "claim failed (57014)" }))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(claim).toHaveBeenCalledTimes(2) // the unavailable answer
    await vi.advanceTimersByTimeAsync(59_999)
    expect(claim).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(claim).toHaveBeenCalledTimes(3)
    await pool.stop()
  })

  it("a send that throws is reported and frees its place", async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const answers: ClaimBatch[] = [{ deliveries: deliveries(1), closed: 0 }]
    const claim = vi.fn(async (): Promise<ClaimBatch> => answers.shift() ?? { deliveries: [], closed: 0 })
    const send = vi.fn(async () => {
      throw new Error("unexpected")
    })
    const pool = startDeliveryPool(poolDeps({ claim, send, onError }))
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "unexpected" }))
    expect(pool.inFlight).toBe(0)
    await pool.stop()
  })

  it("stop waits for the sends in flight and claims nothing more", async () => {
    vi.useFakeTimers()
    const sends = deferredSends()
    const answers: ClaimBatch[] = [{ deliveries: deliveries(2), closed: 0 }]
    const claim = vi.fn(async (): Promise<ClaimBatch> => answers.shift() ?? { deliveries: [], closed: 0 })
    const pool = startDeliveryPool(poolDeps({ claim, send: sends.send }))
    await vi.advanceTimersByTimeAsync(0)
    const calls = claim.mock.calls.length
    let stopped = false
    const stopping = pool.stop().then(() => {
      stopped = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(stopped).toBe(false)
    await sends.finish(2)
    await stopping
    expect(stopped).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(claim.mock.calls.length).toBe(calls)
  })

  it("its production sizes: twenty-five places, claimed five or more at a time", () => {
    expect(CAPACITY).toBe(25)
    expect(MIN_CLAIM).toBe(5)
  })
})

describe("pruneDeliveries", () => {
  it("asks the database to drop what is older than 30 days, batch after batch until one comes back short", async () => {
    const answers = [PRUNE_BATCH, PRUNE_BATCH, 12]
    mocks.rpc.mockImplementation(async () => ({ data: answers.shift() ?? 0, error: null }))
    expect(await pruneDeliveries()).toBe(PRUNE_BATCH * 2 + 12)
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
    expect(mocks.rpc).toHaveBeenCalledWith("prune_webhook_deliveries", { p_keep_days: 30, p_limit: PRUNE_BATCH })
  })

  it("stops when its time is up, however much is left", async () => {
    mocks.rpc.mockResolvedValue({ data: PRUNE_BATCH, error: null })
    let t = 0
    const clock = () => {
      t += PRUNE_BUDGET_MS / 2
      return t
    }
    await pruneDeliveries(clock)
    expect(mocks.rpc.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it("does nothing while the database has no prune function", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } })
    expect(await pruneDeliveries()).toBe(0)
  })
})

describe("startWebhookDispatcher", () => {
  it("claims at once, and stops cleanly", async () => {
    db([])
    const stop = startWebhookDispatcher(deps.report)
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("claim_webhook_deliveries", expect.objectContaining({ p_limit: CAPACITY })))
    await stop()
    const calls = mocks.rpc.mock.calls.length
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.rpc.mock.calls.length).toBe(calls)
  })
})
