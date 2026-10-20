/**
 * `tk.http.workerRequest` — a worker-side handler reaching a `/v1` route.
 *
 * The worker process has no Fastify app of its own, so the toolkit is handed a
 * provider (`getWorkerApp`): the API app is built once, on the first call —
 * which the video worker makes at boot when plugins loaded (`video-worker.ts`)
 * — and every call after reuses it. The call itself is
 * `internalRequest` — the same internal headers, the same submission scope —
 * plus `parentJobId`, which rides in that scope (never on the wire) so the
 * child job's insert can be tied to the job that asked for it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const built = vi.hoisted(() => ({
  count: 0,
  make: null as null | (() => FastifyInstance),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/app.js", () => ({
  buildApp: vi.fn(async () => {
    built.count++
    if (!built.make) throw new Error("buildApp failed")
    return built.make()
  }),
}))

import { buildToolkit } from "../toolkit.js"
import { config } from "../../config.js"
import { jobSubmissionParentJobId } from "../../job-submission-context.js"

const CALLER = "00000000-0000-4000-8000-0000000000a1"
const PARENT = "00000000-0000-4000-8000-0000000000b2"

/** A fresh `worker-app.ts` per test — its memo is module state. */
async function freshWorkerApp() {
  vi.resetModules()
  return (await import("../worker-app.js")).getWorkerApp
}

beforeEach(() => {
  built.count = 0
  built.make = null
})

describe("tk.http.workerRequest", () => {
  it("workerRequest builds the app once and injects with internal headers", async () => {
    const inject = vi.fn().mockResolvedValue({ statusCode: 201, body: "{\"id\":\"job-1\"}" })
    const ready = vi.fn().mockResolvedValue(undefined)
    built.make = () => ({ inject, ready }) as unknown as FastifyInstance
    const tk = buildToolkit({ workerApp: await freshWorkerApp() })

    const call = () => tk.http.workerRequest!({
      method: "POST",
      url: "/v1/text-to-video",
      userId: CALLER,
      workspaceId: "ws-1",
      payload: { prompt: "a lighthouse at dawn" },
      headers: { "idempotency-key": "k-1", "x-internal-user-id": "someone-else" },
    })
    // Concurrent first calls (the worker runs jobs in parallel) and a later one.
    const replies = await Promise.all([call(), call()])
    await call()

    expect(built.count).toBe(1)
    expect(ready).toHaveBeenCalledTimes(1)
    expect(replies[0]).toEqual({ statusCode: 201, body: "{\"id\":\"job-1\"}" })
    expect(inject).toHaveBeenCalledTimes(3)
    expect(inject).toHaveBeenCalledWith({
      method: "POST",
      url: "/v1/text-to-video",
      headers: {
        "idempotency-key": "k-1",
        "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        "x-internal-user-id": CALLER,
        "x-nodaro-workspace": "ws-1",
      },
      payload: { prompt: "a lighthouse at dawn" },
    })
  })

  it("a failed build is not memoized — the next call builds again", async () => {
    const getWorkerApp = await freshWorkerApp()
    await expect(getWorkerApp()).rejects.toThrow("buildApp failed")

    const app = { ready: vi.fn().mockResolvedValue(undefined) } as unknown as FastifyInstance
    built.make = () => app
    await expect(getWorkerApp()).resolves.toBe(app)
    expect(built.count).toBe(2)
  })

  it("workerRequest forwards parentJobId into the submission context", async () => {
    built.make = () => {
      const app = Fastify()
      app.post("/v1/text-to-video", async (req) => {
        req.userId = req.headers["x-internal-user-id"] as string
        return { parentJobId: jobSubmissionParentJobId(req) ?? null, body: req.body }
      })
      return app
    }
    const getWorkerApp = await freshWorkerApp()
    const tk = buildToolkit({ workerApp: getWorkerApp })
    try {
      const reply = await tk.http.workerRequest!({
        method: "POST", url: "/v1/text-to-video", userId: CALLER,
        payload: { prompt: "p" }, parentJobId: PARENT,
      })
      expect(JSON.parse(reply.body)).toEqual({ parentJobId: PARENT, body: { prompt: "p" } })

      // Without one, nothing is inherited — and a public request can never set it.
      const plain = await tk.http.workerRequest!({ method: "POST", url: "/v1/text-to-video", userId: CALLER, payload: {} })
      expect(JSON.parse(plain.body).parentJobId).toBeNull()
      const forged = await (await getWorkerApp()).inject({
        method: "POST", url: "/v1/text-to-video",
        headers: { "x-internal-user-id": CALLER, "x-parent-job-id": PARENT },
        payload: { parentJobId: PARENT, parent_job_id: PARENT },
      })
      expect(forged.json().parentJobId).toBeNull()
    } finally {
      await (await getWorkerApp()).close()
    }
  })

  it("refuses a parentJobId that is not a job id, before the app is built", async () => {
    const workerApp = vi.fn(async () => ({ inject: vi.fn() }) as unknown as FastifyInstance)
    const tk = buildToolkit({ workerApp })
    await expect(tk.http.workerRequest!({ method: "POST", url: "/v1/text-to-video", userId: CALLER, parentJobId: "not-a-job" }))
      .rejects.toThrow("parentJobId must be a job id")
    expect(workerApp).not.toHaveBeenCalled()
  })

  it("a request that authenticated as someone else is refused the parent", async () => {
    built.make = () => {
      const app = Fastify()
      app.post("/v1/text-to-video", async (req) => {
        req.userId = (req.body as { userId: string }).userId
        return { parentJobId: jobSubmissionParentJobId(req) }
      })
      return app
    }
    const getWorkerApp = await freshWorkerApp()
    const tk = buildToolkit({ workerApp: getWorkerApp })
    try {
      const reply = await tk.http.workerRequest!({
        method: "POST", url: "/v1/text-to-video", userId: CALLER,
        payload: { userId: "00000000-0000-4000-8000-0000000000c3" }, parentJobId: PARENT,
      })
      expect(reply.statusCode).toBe(500)
      expect(reply.body).not.toContain(PARENT)
    } finally {
      await (await getWorkerApp()).close()
    }
  })

  it("is absent from a toolkit with no app to reach (?.-guarded by plugins)", () => {
    expect(buildToolkit().http.workerRequest).toBeUndefined()
  })

  it("binds to a given app without building one (the API process)", async () => {
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}" })
    const apiApp = { inject } as unknown as FastifyInstance
    const tk = buildToolkit({ workerApp: async () => apiApp })
    await tk.http.workerRequest!({ method: "GET", url: "/v1/jobs", userId: CALLER })
    expect(inject).toHaveBeenCalledTimes(1)
    expect(built.count).toBe(0)
  })
})
