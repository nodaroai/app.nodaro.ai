/**
 * `POST /v1/llm-chat/generate` sent as a plugin's worker child request with an
 * `idempotency-key` (decided 2026-11-01, `lib/llm-chat-keyed.ts`): the same
 * payer and key answer the first call's `{ jobId, generatedText }` and charge
 * once, whatever the body; a call still running is waited on, never run twice;
 * a key of another kind of job is refused 409; and without the header nothing
 * changes.
 *
 * The jobs table is an in-memory one, unique on (user_id, idempotency_key) as
 * the database is; the scope is the real `withJobSubmissionContext`, as
 * `tk.http.workerRequest` opens it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { llmChatRoutes } from "../llm-chat.js"
import { llmComplete } from "../../lib/llm-client.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"
import {
  KEYED_CHAT_POLL_MS,
  KEYED_WAIT_JOB_CANCELLED,
  KEYED_WAIT_WORKER_DRAINING,
  LLM_CHAT_KEY_REUSED,
  relayIdempotencyKey,
} from "../../lib/llm-chat-keyed.js"
import { IDEMPOTENCY_WINNER_GONE } from "../../lib/idempotent-insert.js"
import { runWithJobCancellation } from "../../lib/job-cancellation.js"
import { _resetWorkerDrainForTests, beginWorkerDrain } from "../../lib/worker-drain.js"

type Row = Record<string, unknown> & { id: string; user_id: string }

const fx = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown> & { id: string; user_id: string }>,
  next: 0,
  /** Hide every row from the keyed lookup: as if two first calls both passed it. */
  hideFromLookup: false,
  guardSawKey: [] as Array<string | undefined>,
  plainInserts: 0,
  keyedInserts: [] as boolean[],
  /** The call is relayed to the cloud (a keyless install with a connection). */
  proxy: false,
  proxiedHooks: [] as Array<Record<string, unknown> | undefined>,
  /** The insert lost its race to a row already gone. */
  winnerGone: false,
  /** How many of the next "completed" writes fail. */
  failCompletedWrites: 0,
}))

/** A row as `KEYED_CHAT_COLUMNS` reads it. */
const viewOf = (row: Row) => ({ ...row, run_type: (row.input_data as { type?: string } | undefined)?.type ?? null })

vi.mock("../../lib/insert-job.js", () => {
  const add = (row: Record<string, unknown>, key: string | null): Row => {
    const stored = { ...row, id: `job-${++fx.next}`, idempotency_key: key, created_at: new Date().toISOString() } as unknown as Row
    fx.jobs.push(stored)
    return stored
  }
  return {
    insertSyncJob: async (_req: unknown, row: Record<string, unknown>) => {
      fx.plainInserts++
      return { data: { id: add(row, null).id }, error: null }
    },
    insertSyncJobIdempotent: async (_req: unknown, row: Record<string, unknown> & { user_id: string }, key: string) => {
      if (fx.winnerGone) {
        const { IdempotencyWinnerGoneError } = await import("../../lib/idempotent-insert.js")
        throw new IdempotencyWinnerGoneError("jobs", row.user_id, key)
      }
      const existing = fx.jobs.find((j) => j.user_id === row.user_id && j.idempotency_key === key)
      fx.keyedInserts.push(!existing)
      if (existing) return { row: viewOf(existing), created: false }
      return { row: viewOf(add({ started_at: new Date().toISOString(), ...row }, key)), created: true }
    },
  }
})

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const filters: Array<[string, unknown]> = []
        const builder = {
          eq: (col: string, val: unknown) => { filters.push([col, val]); return builder },
          maybeSingle: async () => {
            if (fx.hideFromLookup && filters.some(([c]) => c === "idempotency_key")) return { data: null, error: null }
            const row = fx.jobs.find((j) => filters.every(([c, v]) => j[c] === v))
            return { data: row ? viewOf(row) : null, error: null }
          },
          // The worker's ambient cancellation check reads its job's status this way.
          single: async () => {
            const row = fx.jobs.find((j) => filters.every(([c, v]) => j[c] === v))
            return row ? { data: row, error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
          },
        }
        return builder
      },
      update: (payload: Record<string, unknown>) => {
        let id: unknown
        const chain = {
          eq: (col: string, val: unknown) => { if (col === "id") id = val; return chain },
          in: () => chain,
          select: () => chain,
          then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
            if (payload.status === "completed" && fx.failCompletedWrites > 0) {
              fx.failCompletedWrites--
              return resolve({ data: null, error: { message: "write failed" } })
            }
            const row = fx.jobs.find((j) => j.id === id)
            if (row) Object.assign(row, payload)
            resolve({ data: row ? [{ id }] : [], error: null })
          },
        }
        return chain
      },
    }),
  },
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async (req: { headers: Record<string, unknown> }) => {
    fx.guardSawKey.push(req.headers["idempotency-key"] as string | undefined)
  },
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "ul-1" })),
}))

vi.mock("../../lib/llm-client.js", () => ({
  llmComplete: vi.fn(async () => ({ text: "the answer", usage: { inputTokens: 1, outputTokens: 1 } })),
  llmStream: vi.fn(),
}))

vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: { commitCredits: vi.fn(async () => undefined), refundCredits: vi.fn(async () => undefined) },
}))

// The tier lane (the rollback): one reservation per run, counted below. The
// keyed answer is given before any reservation on either lane.
vi.mock("../../lib/config.js", () => ({
  config: { KIE_API_KEY: "kie", ANTHROPIC_API_KEY: "ant", LLM_TIER_PRICING_ROLLBACK: true },
  hasAdmin: () => false,
  hasCredits: () => true,
  llmMeteredPricing: () => false,
}))

vi.mock("../../lib/cloud-llm-proxy.js", () => ({
  shouldProxyLlmToCloud: async () => fx.proxy,
  maybeProxyLlmRouteToCloud: async (
    _req: unknown,
    reply: { send: (b: unknown) => void },
    _path: string,
    _type: string,
    hooks?: Record<string, unknown>,
  ) => {
    if (!fx.proxy) return false
    fx.proxiedHooks.push(hooks)
    reply.send({ jobId: "mirror-1", generatedText: "from the cloud" })
    return true
  },
}))

vi.mock("../../lib/reconcile/persistence.js", () => ({ markProviderCallStart: vi.fn(async () => undefined) }))

const URL = "/v1/llm-chat/generate"
const PARENT = "11111111-2222-4333-8444-555555555555"
const KEY = "plugin-step-key-0001"
const BODY = { systemPrompt: "You are terse.", userInput: "Describe the shot." }

async function buildApp() {
  const app = Fastify()
  app.addHook("onRequest", async (req, reply) => {
    ;(req.raw as { setTimeout: (ms: number) => void }).setTimeout = () => {}
    ;(reply.raw as { setTimeout: (ms: number) => void }).setTimeout = () => {}
  })
  app.addHook("preHandler", async (req) => { (req as { userId?: string }).userId = "u1" })
  await app.register(llmChatRoutes)
  return app
}

/** A call as `tk.http.workerRequest` sends it: inside a scope naming the parent job. */
function childCall(app: Awaited<ReturnType<typeof buildApp>>, opts: { key?: string; body?: object; parent?: string | null } = {}) {
  const headers = opts.key === undefined ? {} : { "idempotency-key": opts.key }
  const inject = () => app.inject({ method: "POST", url: URL, headers, payload: opts.body ?? BODY })
  if (opts.parent === null) return inject()
  return withJobSubmissionContext({ userId: "u1", method: "POST", url: URL, parentJobId: opts.parent ?? PARENT }, inject)
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  fx.jobs = []
  fx.next = 0
  fx.hideFromLookup = false
  fx.guardSawKey = []
  fx.plainInserts = 0
  fx.keyedInserts = []
  fx.proxy = false
  fx.proxiedHooks = []
  fx.winnerGone = false
  fx.failCompletedWrites = 0
  _resetWorkerDrainForTests()
})

describe("a keyed child chat call", () => {
  it("answers a repeat with the first call's answer and charges once", async () => {
    const app = await buildApp()
    const first = await childCall(app, { key: KEY })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toEqual({ jobId: "job-1", generatedText: "the answer" })

    const again = await childCall(app, { key: KEY })
    expect(again.statusCode).toBe(200)
    expect(again.body).toBe(first.body)
    expect(again.headers["x-dedup-hit"]).toBe("1")
    expect(first.headers["x-dedup-hit"]).toBeUndefined()

    expect(llmComplete).toHaveBeenCalledTimes(1)
    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(fx.jobs).toHaveLength(1)
    // The key and the body's fingerprint landed with the row itself.
    expect(fx.jobs[0]).toMatchObject({ idempotency_key: KEY, input_fingerprint: expect.any(String) })
    // The repeat never reached the credit guard; the first reached it without the key,
    // so the guard's own short `{ jobId, deduped }` answer can never be sent.
    expect(fx.guardSawKey).toEqual([undefined])
  })

  it("waits for a call still running under the key instead of running it again", async () => {
    const app = await buildApp()
    const answer = deferred<{ text: string; usage: { inputTokens: number; outputTokens: number } }>()
    vi.mocked(llmComplete).mockImplementationOnce(() => answer.promise as never)

    const first = childCall(app, { key: KEY })
    await vi.waitFor(() => expect(llmComplete).toHaveBeenCalledTimes(1))
    const second = childCall(app, { key: KEY })
    // The repeat is waiting on the running row.
    await new Promise((r) => setTimeout(r, KEYED_CHAT_POLL_MS + 50))
    answer.resolve({ text: "slow answer", usage: { inputTokens: 1, outputTokens: 1 } })

    const [a, b] = await Promise.all([first, second])
    expect(a.json()).toEqual({ jobId: "job-1", generatedText: "slow answer" })
    expect(b.statusCode).toBe(200)
    expect(b.body).toBe(a.body)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
  })

  it("answers the loser of a race at the insert from the winner's row, never running it twice", async () => {
    const app = await buildApp()
    const first = await childCall(app, { key: KEY })
    // The second call passed the lookup (as when both arrive at once); the
    // insert's unique key catches it.
    fx.hideFromLookup = true
    const second = await childCall(app, { key: KEY })
    expect(fx.keyedInserts).toEqual([true, false])
    expect(second.statusCode).toBe(200)
    expect(second.body).toBe(first.body)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
  })

  it("replays an answer the call recorded even while its row is left in flight for the sweep", async () => {
    const app = await buildApp()
    fx.jobs.push({
      id: "job-9", user_id: "u1", idempotency_key: KEY, status: "processing", input_data: { type: "llm-chat" },
      output_data: { generatedText: "already sent" }, started_at: new Date().toISOString(),
    })
    // A null fingerprint is judged the same request.
    const res = await childCall(app, { key: KEY })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-9", generatedText: "already sent" })
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("replays the first answer whatever the body: the key alone decides (re-uploaded picture addresses)", async () => {
    const app = await buildApp()
    const first = await childCall(app, { key: KEY, body: { ...BODY, referenceImageUrls: ["https://cdn.example/scratch-a.png"] } })
    expect(first.statusCode).toBe(200)
    const restarted = await childCall(app, { key: KEY, body: { ...BODY, referenceImageUrls: ["https://cdn.example/scratch-b.png"] } })
    expect(restarted.statusCode).toBe(200)
    expect(restarted.body).toBe(first.body)
    expect(restarted.headers["x-dedup-hit"]).toBe("1")
    expect(llmComplete).toHaveBeenCalledTimes(1)
    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(fx.jobs).toHaveLength(1)
  })

  it("waits on a running call whatever the body", async () => {
    const app = await buildApp()
    const answer = deferred<{ text: string; usage: { inputTokens: number; outputTokens: number } }>()
    vi.mocked(llmComplete).mockImplementationOnce(() => answer.promise as never)
    const first = childCall(app, { key: KEY })
    await vi.waitFor(() => expect(llmComplete).toHaveBeenCalledTimes(1))
    const second = childCall(app, { key: KEY, body: { ...BODY, userInput: "Same step, new scratch upload." } })
    await new Promise((r) => setTimeout(r, KEYED_CHAT_POLL_MS + 50))
    answer.resolve({ text: "one answer", usage: { inputTokens: 1, outputTokens: 1 } })
    const [a, b] = await Promise.all([first, second])
    expect(b.statusCode).toBe(200)
    expect(b.body).toBe(a.body)
    expect(llmComplete).toHaveBeenCalledTimes(1)
  })

  it("refuses a key that belongs to another kind of job with 409", async () => {
    const app = await buildApp()
    fx.jobs.push({ id: "job-img", user_id: "u1", idempotency_key: KEY, status: "completed", input_data: { type: "generate-image" }, output_data: {} })
    const res = await childCall(app, { key: KEY })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: LLM_CHAT_KEY_REUSED })
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("spends the key on a failure: a repeat answers the recorded 502 and runs nothing", async () => {
    const app = await buildApp()
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("upstream exploded"))
    const first = await childCall(app, { key: KEY })
    expect(first.statusCode).toBe(502)
    const again = await childCall(app, { key: KEY })
    expect(again.statusCode).toBe(502)
    expect(again.json()).toEqual({ error: { code: "llm_error", message: first.json().error.message } })
    expect(llmComplete).toHaveBeenCalledTimes(1)
    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
  })

  it("answers as the existing job, never running it, once the call is past its longest run", async () => {
    const app = await buildApp()
    fx.jobs.push({
      id: "job-stuck", user_id: "u1", idempotency_key: KEY, status: "processing", input_data: { type: "llm-chat" },
      output_data: null, started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })
    const res = await childCall(app, { key: KEY })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-stuck", deduped: true })
    expect(llmComplete).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})

describe("a key whose row disappears while it is waited on", () => {
  const inFlight = () => ({
    id: "job-gone", user_id: "u1", idempotency_key: KEY, status: "pending", input_data: { type: "llm-chat" },
    output_data: null, started_at: new Date().toISOString(),
  })
  const removeSoon = () => setTimeout(() => { fx.jobs = fx.jobs.filter((j) => j.id !== "job-gone") }, 50)

  it("runs the repeat itself when it was still before every check (the key is free)", async () => {
    const app = await buildApp()
    fx.jobs.push(inFlight())
    removeSoon()
    const res = await childCall(app, { key: KEY })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", generatedText: "the answer" })
    expect(res.headers["x-dedup-hit"]).toBeUndefined()
    expect(llmComplete).toHaveBeenCalledTimes(1)
    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
  })

  it("answers 503 Retry-After when it lost the insert race to the vanished row", async () => {
    const app = await buildApp()
    fx.jobs.push(inFlight())
    fx.hideFromLookup = true
    removeSoon()
    const res = await childCall(app, { key: KEY })
    expect(fx.keyedInserts).toEqual([false])
    expect(res.statusCode).toBe(503)
    expect(res.headers["retry-after"]).toBe("2")
    expect(res.json().error.code).toBe("dedup_race_winner_unresolvable")
    expect(llmComplete).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})

describe("the wait honours the calling job and the worker", () => {
  const running = () => ({
    id: "job-running", user_id: "u1", idempotency_key: KEY, status: "processing", input_data: { type: "llm-chat" },
    output_data: null, started_at: new Date().toISOString(),
  })
  const parentJob = (status: string) => ({ id: PARENT, user_id: "u1", status, stop_requested_at: null, input_data: { type: "cast-swap" } })
  /** The repeat as the plugin's handler sends it: inside its job's cancellation context. */
  const inParentJob = (app: Awaited<ReturnType<typeof buildApp>>) =>
    runWithJobCancellation(PARENT, "u1", () => childCall(app, { key: KEY }))

  it("ends at once with 409 job_cancelled when the calling job is already cancelled — no 202", async () => {
    const app = await buildApp()
    fx.jobs.push(running(), parentJob("cancelled"))
    const started = Date.now()
    const res = await inParentJob(app)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: KEYED_WAIT_JOB_CANCELLED })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("ends with 409 job_cancelled when the calling job is cancelled mid-wait (the ambient check reads at most every 4 s)", async () => {
    const app = await buildApp()
    const parent = parentJob("processing")
    fx.jobs.push(running(), parent)
    const res = inParentJob(app)
    await new Promise((r) => setTimeout(r, KEYED_CHAT_POLL_MS + 100))
    parent.status = "cancelled"
    const started = Date.now()
    const answer = await res
    expect(answer.statusCode).toBe(409)
    expect(answer.json()).toEqual({ error: KEYED_WAIT_JOB_CANCELLED })
    expect(Date.now() - started).toBeLessThan(5000)
  }, 10_000)

  it("ends with 503 worker_draining and Retry-After as soon as the worker drains — no 202", async () => {
    const app = await buildApp()
    fx.jobs.push(running())
    const res = childCall(app, { key: KEY })
    await new Promise((r) => setTimeout(r, 50))
    const started = Date.now()
    beginWorkerDrain()
    const answer = await res
    expect(answer.statusCode).toBe(503)
    expect(answer.headers["retry-after"]).toBe("2")
    expect(answer.json()).toEqual({ error: KEYED_WAIT_WORKER_DRAINING })
    expect(Date.now() - started).toBeLessThan(KEYED_CHAT_POLL_MS)
  })
})

describe("a keyless install that relays to the cloud", () => {
  it("claims nothing locally and forwards the key, namespaced by the local user: the cloud is the one dedupe point", async () => {
    fx.proxy = true
    const app = await buildApp()
    const res = await childCall(app, { key: KEY })
    expect(res.json()).toEqual({ jobId: "mirror-1", generatedText: "from the cloud" })
    expect(fx.proxiedHooks).toEqual([{ idempotencyKey: relayIdempotencyKey("u1", KEY) }])
    // Not the raw key, and another user's equal key is another key there.
    expect(relayIdempotencyKey("u1", KEY)).not.toBe(KEY)
    expect(relayIdempotencyKey("u2", KEY)).not.toBe(relayIdempotencyKey("u1", KEY))
    expect(fx.keyedInserts).toEqual([])
    expect(fx.guardSawKey).toEqual([undefined])
  })

  it("forwards no key for a call without one", async () => {
    fx.proxy = true
    const app = await buildApp()
    await childCall(app)
    expect(fx.proxiedHooks).toEqual([{}])
  })
})

describe("the insert and the rollback lane", () => {
  it("answers 503 Retry-After when the insert lost its race to a row already gone (never a 500)", async () => {
    fx.winnerGone = true
    const app = await buildApp()
    const res = await childCall(app, { key: KEY })
    expect(res.statusCode).toBe(503)
    expect(res.headers["retry-after"]).toBe("2")
    expect(res.json()).toEqual({ error: IDEMPOTENCY_WINNER_GONE })
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("tries a failed answer write once more", async () => {
    fx.failCompletedWrites = 1
    const app = await buildApp()
    const first = await childCall(app, { key: KEY })
    expect(first.statusCode).toBe(200)
    expect(fx.jobs[0]).toMatchObject({ status: "completed", output_data: { generatedText: "the answer" } })
    const again = await childCall(app, { key: KEY })
    expect(again.body).toBe(first.body)
  })

  it("fails the row when the answer cannot be written twice, so a repeat gets a prompt 502, not the whole wait", async () => {
    fx.failCompletedWrites = 2
    const app = await buildApp()
    const first = await childCall(app, { key: KEY })
    expect(first.statusCode).toBe(200)
    expect(first.json().generatedText).toBe("the answer")
    expect(fx.jobs[0]).toMatchObject({ status: "failed" })
    const started = Date.now()
    const again = await childCall(app, { key: KEY })
    expect(again.statusCode).toBe(502)
    expect(again.json().error.code).toBe("llm_error")
    expect(Date.now() - started).toBeLessThan(KEYED_CHAT_POLL_MS)
    expect(llmComplete).toHaveBeenCalledTimes(1)
  })
})

describe("every other call is unchanged", () => {
  it("without the header: a plain insert, the guard sees no key, every call runs", async () => {
    const app = await buildApp()
    const a = await childCall(app)
    const b = await childCall(app)
    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    expect([a.json().jobId, b.json().jobId]).toEqual(["job-1", "job-2"])
    expect(fx.plainInserts).toBe(2)
    expect(fx.keyedInserts).toEqual([])
    expect(llmComplete).toHaveBeenCalledTimes(2)
    expect(fx.guardSawKey).toEqual([undefined, undefined])
  })

  it("a keyed call with no parent job keeps the credit guard's own dedup (the header reaches it)", async () => {
    const app = await buildApp()
    const res = await childCall(app, { key: KEY, parent: null })
    expect(res.statusCode).toBe(200)
    expect(fx.guardSawKey).toEqual([KEY])
    expect(fx.plainInserts).toBe(1)
    expect(fx.keyedInserts).toEqual([])
  })

  it("a key shorter than the minimum is no key", async () => {
    const app = await buildApp()
    await childCall(app, { key: "short" })
    await childCall(app, { key: "short" })
    expect(fx.plainInserts).toBe(2)
    expect(llmComplete).toHaveBeenCalledTimes(2)
  })
})
