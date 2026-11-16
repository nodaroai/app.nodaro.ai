/**
 * A synchronous route tells the server code that called it the id of the job
 * it created, before it answers (`announceCreatedJob` → the caller's
 * `onJobCreated` in `withJobSubmissionContext`, which `mcpInject` passes on).
 *
 * The listener hears only THIS very request (the same active + method + url +
 * caller match as every other reader of the submission scope), a request nobody
 * listens to changes nothing, and a listener that throws never fails the route.
 */
import { describe, it, expect } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { announceCreatedJob, withJobSubmissionContext } from "../job-submission-context.js"
import { mcpInject } from "../mcp/internal-request.js"
import { newSession } from "../mcp/session.js"
import type { Scope } from "../scopes.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const ROUTE = "/v1/probe-sync"

/** A route that creates "job-1", announces it, then answers once `release` is called. */
function probeApp() {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const seen: { request?: FastifyRequest } = {}
  const app = Fastify()
  // The caller, as the auth hook records an internal request's (`x-internal-user-id`).
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = (req.headers["x-internal-user-id"] as string | undefined) ?? USER
  })
  app.post(ROUTE, async (req) => {
    seen.request = req
    announceCreatedJob(req, "job-1")
    await held
    return { jobId: "job-1", generatedText: "done" }
  })
  return { app: app as unknown as FastifyInstance, release: () => release(), seen }
}

const scope = (over: Partial<{ userId: string; method: string; url: string }> = {}) => ({ userId: USER, method: "POST", url: ROUTE, ...over })

describe("announceCreatedJob", () => {
  it("tells the caller the job's id before the route answers", async () => {
    const { app, release } = probeApp()
    const heard: string[] = []
    let answered = false
    const call = withJobSubmissionContext({ ...scope(), onJobCreated: (id) => heard.push(id) }, () => app.inject({ method: "POST", url: ROUTE })).then((res) => {
      answered = true
      return res
    })
    await expect.poll(() => heard).toEqual(["job-1"])
    expect(answered).toBe(false)
    release()
    expect((await call).statusCode).toBe(200)
    expect(heard).toEqual(["job-1"])
  })

  it.each([
    ["another route's scope", { url: "/v1/another-route" }],
    ["another method's scope", { method: "PUT" }],
    ["another caller's scope", { userId: OTHER }],
  ])("is not heard through %s", async (_name, over) => {
    const { app, release } = probeApp()
    const heard: string[] = []
    release()
    const res = await withJobSubmissionContext({ ...scope(over), onJobCreated: (id) => heard.push(id) }, () => app.inject({ method: "POST", url: ROUTE }))
    expect(res.statusCode).toBe(200)
    expect(heard).toEqual([])
  })

  it("changes nothing for a request nobody listens to, with a scope or without one", async () => {
    const { app, release } = probeApp()
    release()
    expect((await app.inject({ method: "POST", url: ROUTE })).statusCode).toBe(200)
    const scoped = await withJobSubmissionContext({ ...scope(), grant: null }, () => app.inject({ method: "POST", url: ROUTE }))
    expect(JSON.parse(scoped.body)).toEqual({ jobId: "job-1", generatedText: "done" })
  })

  it("a listener that throws never fails the route", async () => {
    const { app, release } = probeApp()
    release()
    const res = await withJobSubmissionContext(
      {
        ...scope(),
        onJobCreated: () => {
          throw new Error("the caller's own problem")
        },
      },
      () => app.inject({ method: "POST", url: ROUTE }),
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ jobId: "job-1", generatedText: "done" })
  })

  it("is not heard once the caller's scope has ended", async () => {
    const { app, release, seen } = probeApp()
    const heard: string[] = []
    release()
    await withJobSubmissionContext({ ...scope(), onJobCreated: (id) => heard.push(id) }, () => app.inject({ method: "POST", url: ROUTE }))
    expect(heard).toEqual(["job-1"])
    // The same request object, announced again after its caller's scope closed: nobody hears it.
    announceCreatedJob(seen.request!, "job-2")
    expect(heard).toEqual(["job-1"])
  })

  it("needs a caller: a listener with no user is refused before anything is sent", async () => {
    const { app } = probeApp()
    await expect(
      withJobSubmissionContext({ ...scope({ userId: " " }), onJobCreated: () => {} }, () => app.inject({ method: "POST", url: ROUTE })),
    ).rejects.toThrow("Invalid server job submission context")
  })
})

describe("mcpInject onJobCreated", () => {
  it("an MCP tool hears the job its route creates while the route is still working", async () => {
    const { app, release } = probeApp()
    const session = newSession({ userId: USER, scopes: ["workflows:execute"] as Scope[], clientName: "Claude" })
    const heard: string[] = []
    const call = mcpInject(app, session, { method: "POST", url: ROUTE, payload: { a: 1 }, onJobCreated: (id) => heard.push(id) })
    await expect.poll(() => heard).toEqual(["job-1"])
    release()
    expect((await call).statusCode).toBe(200)
  })

  it("a call that asks for none is sent as before", async () => {
    const { app, release } = probeApp()
    const session = newSession({ userId: USER, scopes: ["workflows:execute"] as Scope[], clientName: "Claude" })
    release()
    const res = await mcpInject(app, session, { method: "POST", url: ROUTE, payload: { a: 1 } })
    expect(JSON.parse(res.body)).toEqual({ jobId: "job-1", generatedText: "done" })
  })
})
