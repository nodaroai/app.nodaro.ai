/**
 * Who may name a CHILD job (`parent_job_id` set) as the source of a job it
 * creates or prices (`mayUseChildJobAsSource`, lib/job-submission-context.ts).
 *
 * Only trusted plugin code reaching a route as the caller: the plugin
 * toolkit's own `tk.http.internalRequest` (Cast Swap's Full Quality quote of
 * its Seedance edit child) or a `workerRequest` with a parent job (its upscale
 * of that child). An internal hop that relays a caller's body — MCP's
 * `mcpInject` — and every public caller name a child as a missing job.
 *
 * `createsChildJob` (the stricter half: a parent job in the scope) is true
 * only for the `workerRequest` with a parent — the request whose job is a child.
 *
 * Through the REAL auth hook (the internal secret is checked, `authKind` set
 * by it), against a probe on the two routes Cast Swap uses.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
  },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))

import { registerAuthHook } from "../../middleware/auth.js"
import { createsChildJob, mayUseChildJobAsSource } from "../job-submission-context.js"
import { buildToolkit } from "../private-plugins/toolkit.js"
import { mcpInject } from "../mcp/internal-request.js"
import { newSession } from "../mcp/session.js"
import type { Scope } from "../scopes.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PARENT = "00000000-0000-4000-8000-0000000000b2"
const ROUTES = ["/v1/credits/seedance-hd-estimate", "/v1/video-upscale"] as const

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  registerAuthHook(app)
  for (const url of ROUTES) {
    app.post(url, async (req) => ({ userId: req.userId ?? null, authKind: req.authKind ?? null, mayUseChild: mayUseChildJobAsSource(req), createsChild: createsChildJob(req) }))
  }
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

const answer = (res: { statusCode: number; body: string }) => ({ status: res.statusCode, ...(JSON.parse(res.body) as Record<string, unknown>) })

describe.each(ROUTES)("%s", (url) => {
  it("the plugin toolkit's internalRequest may (trusted plugin code, as the caller)", async () => {
    const tk = buildToolkit()
    const res = await tk.http.internalRequest!(app, { method: "POST", url, userId: USER, payload: { sourceJobId: PARENT } })
    // Trusted, but the job it creates is the user's own, not a child.
    expect(answer(res)).toEqual({ status: 200, userId: USER, authKind: "internal", mayUseChild: true, createsChild: false })
  })

  it("a worker-side handler's own request for a child of its own may", async () => {
    const tk = buildToolkit({ workerApp: async () => app })
    const res = await tk.http.workerRequest!({ method: "POST", url, userId: USER, parentJobId: PARENT, payload: {} })
    expect(answer(res)).toMatchObject({ status: 200, authKind: "internal", mayUseChild: true, createsChild: true })
  })

  it("an MCP relay of the caller's body may not, though it is internal", async () => {
    const session = newSession({ userId: USER, scopes: ["workflows:execute"] as Scope[], clientName: "Claude" })
    const res = await mcpInject(app, session, { method: "POST", url, payload: { sourceJobId: PARENT } })
    expect(answer(res)).toEqual({ status: 200, userId: USER, authKind: "internal", mayUseChild: false, createsChild: false })
  })

  it("nothing a caller sends can claim the trust: a body or header flag is ignored", async () => {
    const res = await app.inject({
      method: "POST",
      url,
      headers: {
        "x-internal-orchestrator-secret": process.env.INTERNAL_ORCHESTRATOR_SECRET as string,
        "x-internal-user-id": USER,
        "x-trusted-plugin-caller": "true",
      },
      payload: { trustedPluginCaller: true, parentJobId: PARENT },
    })
    expect(answer(res)).toMatchObject({ authKind: "internal", mayUseChild: false, createsChild: false })
  })

  it("a public caller may not", async () => {
    const res = await app.inject({ method: "POST", url, headers: { "x-internal-user-id": USER }, payload: { sourceJobId: PARENT } })
    // No secret: not an internal call (anonymous here, refused or answered without trust).
    if (res.statusCode === 200) expect(answer(res)).toMatchObject({ mayUseChild: false, createsChild: false })
    else expect(res.statusCode).toBe(401)
  })
})
