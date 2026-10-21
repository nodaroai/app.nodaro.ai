/**
 * The cross-repo contract Cast Swap's Full Quality depends on: its plugin
 * quotes and runs the 1080p finalize of its Seedance edit CHILD job
 * (`parent_job_id` set — a job every caller-facing read hides from its owner)
 * through the plugin toolkit, and the platform must answer it.
 *
 * - The quote: `tk.http.internalRequest({ method: "POST", url:
 *   "/v1/credits/seedance-hd-estimate", userId, workspaceId?, payload: {
 *   sourceJobId } })` → 200 with credits, not 404.
 * - The run: `tk.http.workerRequest({ method: "POST", url: "/v1/video-upscale",
 *   userId, parentJobId, payload: { provider: "seedance-2-5-hd", sourceJobId }
 *   })` → accepted, not 404.
 *
 * And the same child named by anyone else — an MCP relay of a caller's body —
 * reads exactly as a draft that does not exist.
 *
 * Through the REAL auth hook, the REAL plugin toolkit and the REAL draft
 * resolver, over an in-memory `jobs` table.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const db = vi.hoisted(() => ({ jobs: [] as Array<Record<string, unknown>> }))

// `jobs` answers by the filters asked; every other table has no rows (so every
// price comes from the static catalog).
vi.mock("@/lib/supabase.js", () => {
  function from(table: string) {
    const filters: Array<[string, unknown]> = []
    const rows = () =>
      table === "jobs" ? db.jobs.filter((r) => filters.every(([c, v]) => r[c] === v)) : []
    const q: Record<string, unknown> = {}
    for (const m of ["select", "order", "range", "in", "is", "not", "or", "filter", "gte", "lte"]) q[m] = () => q
    q.eq = (c: string, v: unknown) => (filters.push([c, v]), q)
    q.limit = async () => ({ data: rows(), error: null })
    q.single = async () => {
      const r = rows()
      return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
    }
    q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve)
    return q
  }
  return {
    supabase: {
      from: vi.fn(from),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
    },
  }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 0 }) }))
// The REAL config (the auth hook checks its internal secret), on Nodaro Cloud.
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/config.js")>()),
  hasCredits: () => true,
}))
// The run's reservation and job row are not this contract's business: what
// matters is that the finalize gate let the child through.
vi.mock("@/middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middleware/credit-guard.js")>()),
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/insert-job.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/insert-job.js")>()),
  insertJob: vi.fn().mockResolvedValue({ data: { id: "job-upscale" }, error: null }),
}))
vi.mock("@/lib/kie-task-ownership.js", () => ({ kieTaskOwnedByAnother: vi.fn().mockResolvedValue(false) }))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/video/ffmpeg-utils.js")>()),
  assertSafeProbeSource: async () => {},
  getVideoStreamDuration: async () => 6,
}))

import { registerAuthHook } from "../middleware/auth.js"
import { registerSeedanceHdEstimate } from "../ee/routes/seedance-hd-estimate.js"
import { videoUpscaleRoutes } from "../routes/video-upscale.js"
import { buildToolkit } from "../lib/private-plugins/toolkit.js"
import { mcpInject } from "../lib/mcp/internal-request.js"
import { newSession } from "../lib/mcp/session.js"
import type { Scope } from "../lib/scopes.js"

const USER = "00000000-0000-4000-8000-0000000000a1"
const DRAFT_RUN = "11111111-1111-4111-8111-111111111111"
const EDIT_CHILD = "22222222-2222-4222-8222-222222222222"
const FULL_QUALITY = "44444444-4444-4444-8444-444444444444"
const MISSING = "33333333-3333-4333-8333-333333333333"

let app: FastifyInstance

beforeAll(async () => {
  db.jobs = [
    {
      // The Seedance edit child of a draft Cast Swap run: a finished 480p draft.
      id: EDIT_CHILD,
      user_id: USER,
      parent_job_id: DRAFT_RUN,
      status: "completed",
      provider_task_id: "task-edit",
      provider_kind: "kie-standard",
      relay_job_id: null,
      input_data: {
        type: "text-to-video",
        provider: "seedance-2-5",
        draft: true,
        referenceVideoUrls: ["https://media.example.test/private/source.mp4"],
        refVideoDurationsSec: [6],
      },
      output_data: { videoUrl: "https://media.example.test/out/edit.mp4", draftRenderSec: 6 },
    },
  ]
  app = Fastify({ logger: false })
  registerAuthHook(app)
  registerSeedanceHdEstimate(app)
  await app.register(async (i) => {
    await videoUpscaleRoutes(i)
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe("Cast Swap Full Quality: the plugin's own requests about its edit child", () => {
  it("the quote — tk.http.internalRequest to /v1/credits/seedance-hd-estimate — is priced", async () => {
    const tk = buildToolkit()
    const res = await tk.http.internalRequest!(app, {
      method: "POST",
      url: "/v1/credits/seedance-hd-estimate",
      userId: USER,
      payload: { sourceJobId: EDIT_CHILD },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { data: { credits: number; minimum: boolean } }
    expect(body.data.minimum).toBe(false)
    expect(body.data.credits).toBeGreaterThan(0)
  })

  it("the run — tk.http.workerRequest to /v1/video-upscale with its parent job — is accepted", async () => {
    const tk = buildToolkit({ workerApp: async () => app })
    const res = await tk.http.workerRequest!({
      method: "POST",
      url: "/v1/video-upscale",
      userId: USER,
      parentJobId: FULL_QUALITY,
      payload: { provider: "seedance-2-5-hd", sourceJobId: EDIT_CHILD },
    })
    expect(res.statusCode, res.body).toBeLessThan(300)
    expect(res.body).not.toContain("draft_not_found")
  })
})

describe("anyone else naming the edit child", () => {
  it.each(["/v1/credits/seedance-hd-estimate", "/v1/video-upscale"])(
    "an MCP relay to %s reads it exactly as a missing draft",
    async (url) => {
      const session = newSession({ userId: USER, scopes: ["workflows:execute"] as Scope[], clientName: "Claude" })
      const payload = (sourceJobId: string) => (url === "/v1/video-upscale" ? { provider: "seedance-2-5-hd", sourceJobId } : { sourceJobId })
      const child = await mcpInject(app, session, { method: "POST", url, payload: payload(EDIT_CHILD) })
      const missing = await mcpInject(app, session, { method: "POST", url, payload: payload(MISSING) })
      expect(child.statusCode).toBe(404)
      expect(JSON.parse(child.body)).toEqual(JSON.parse(missing.body))
    },
  )
})
