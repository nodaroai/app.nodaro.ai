import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const USER = "00000000-0000-4000-8000-000000000001"
const ASSET = "11111111-1111-4111-8111-111111111111"
const SOURCE_JOB = "22222222-2222-4222-8222-222222222222"
const SOURCE_ASSET = "33333333-3333-4333-8333-333333333333"
const NEW_JOB = "44444444-4444-4444-8444-444444444444"
const STATE = "55555555-5555-4555-8555-555555555555"

const h = vi.hoisted(() => ({
  assets: new Map<string, Record<string, unknown>>(),
  jobs: new Map<string, Record<string, unknown>>(),
  updates: [] as { fields: Record<string, unknown>; filters: Record<string, unknown>; applied: boolean }[],
  insert: vi.fn(),
  complete: vi.fn(),
  judge: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => {
  function builder(table: string) {
    const filters: Record<string, unknown> = {}
    const rowOf = () => {
      const store = table === "assets" ? h.assets : h.jobs
      const row = store.get(String(filters.id))
      if (!row) return null
      if (filters.user_id !== undefined && row.user_id !== filters.user_id) return null
      if ("parent_job_id" in filters && filters.parent_job_id === null && row.parent_job_id != null) return null
      return row
    }
    let update: Record<string, unknown> | null = null
    // An update applies when awaited, to the one row its filters match.
    const applyUpdate = () => {
      const row = h.jobs.get(String(filters.id))
      const statuses = filters.status as string[] | undefined
      const matches = row && Object.entries(filters).every(([col, value]) => col === "status" ? statuses!.includes(String(row.status)) : row[col] === value)
      if (matches) h.jobs.set(String(filters.id), { ...row, ...update })
      h.updates.push({ fields: update!, filters: { ...filters }, applied: Boolean(matches) })
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b,
      update: (fields: Record<string, unknown>) => { update = fields; return b },
      eq: (col: string, value: unknown) => { filters[col] = value; return b },
      in: (col: string, values: unknown[]) => { filters[col] = values; return b },
      is: (col: string, value: unknown) => { filters[col] = value; return b },
      then: (resolve: (v: unknown) => unknown) => resolve(update ? applyUpdate() : { data: null, error: null }),
      maybeSingle: async () => ({ data: rowOf(), error: null }),
      single: async () => { const row = rowOf(); return row ? { data: row, error: null } : { data: null, error: { message: "0 rows" } } },
    }
    return b
  }
  return { supabase: { from: vi.fn((table: string) => builder(table)) } }
})

vi.mock("@/lib/insert-job.js", () => ({ insertSyncJobIdempotent: h.insert }))
vi.mock("@/workers/shared.js", () => ({ markJobCompletedDetailed: h.complete }))
vi.mock("@/lib/key-ownership.js", () => ({
  judgeUrlForRecording: h.judge,
  storageUrlPath: (url: string) =>
    url.startsWith("https://cdn.test/") ? { kind: "ours", path: url.slice("https://cdn.test/".length) } : { kind: "external" },
}))

import { jobsFromUploadRoutes } from "../jobs-from-upload.js"

let app: FastifyInstance

function post(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/v1/jobs/from-upload", payload, headers })
}

beforeEach(async () => {
  vi.clearAllMocks()
  h.assets.clear()
  h.jobs.clear()
  h.updates.length = 0
  h.assets.set(ASSET, {
    id: ASSET, user_id: USER, type: "image", mime_type: "image/png",
    r2_url: "https://cdn.test/uploads/images/edit.png", metadata: { thumbnail_url: "https://cdn.test/uploads/images/edit_thumb.png" },
  })
  h.assets.set(SOURCE_ASSET, { id: SOURCE_ASSET, user_id: USER, r2_url: "https://cdn.test/uploads/images/orig.png" })
  h.jobs.set(SOURCE_JOB, {
    id: SOURCE_JOB, user_id: USER, status: "completed",
    input_data: { type: "generate-object", attachToObjectId: "obj-1", prompt: "a lamp" },
    output_data: { imageUrl: "https://cdn.test/images/a.png", imageUrls: ["https://cdn.test/images/a.png", "https://cdn.test/images/b.png"] },
  })
  h.judge.mockResolvedValue({ kind: "owned", key: "uploads/images/edit.png", url: "https://cdn.test/uploads/images/edit.png" })
  h.insert.mockImplementation(async (_req: unknown, row: Record<string, unknown>) => {
    h.jobs.set(NEW_JOB, { id: NEW_JOB, ...row })
    return { row: { id: NEW_JOB, job_type: "image-edit", status: "pending" }, created: true }
  })
  h.complete.mockImplementation(async (id: string, fields: Record<string, unknown>) => {
    h.jobs.set(id, { ...h.jobs.get(id), ...fields, status: "completed" })
    return "completed"
  })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    if (req.headers["x-test-internal"] === "1") req.authKind = "internal"
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") {
      req.appAuthorization = { appId: "app", authorizationId: "auth", scopes: scopes.split(",") } as never
    }
  })
  await app.register(jobsFromUploadRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/jobs/from-upload", () => {
  it("records the upload as a completed, private, free image-edit job linked to its source", async () => {
    const res = await post({ assetId: ASSET, sourceJobId: SOURCE_JOB, sourceImageUrl: "https://cdn.test/images/b.png" })

    expect(res.statusCode).toBe(201)
    const [, row, key] = h.insert.mock.calls[0]!
    expect(key).toBe(`image-edit:${ASSET}`)
    expect(row).toEqual({
      user_id: USER,
      status: "pending",
      credits: 0,
      is_public: false,
      force_private: true,
      input_data: {
        type: "image-edit",
        assetId: ASSET,
        sourceJobId: SOURCE_JOB,
        sourceImageUrl: "https://cdn.test/images/b.png",
        attachToObjectId: "obj-1",
      },
    })
    // The source link is never a child-job link: that hides, cancels and deletes the edit with its source.
    expect(row).not.toHaveProperty("parent_job_id")
    expect(h.complete).toHaveBeenCalledWith(NEW_JOB, {
      output_data: { imageUrl: "https://cdn.test/uploads/images/edit.png", thumbnailUrl: "https://cdn.test/uploads/images/edit_thumb.png" },
    })
    expect(res.json().data).toMatchObject({ id: NEW_JOB, status: "completed" })
  })

  it("defaults the source image to the source job's imageUrl", async () => {
    await post({ assetId: ASSET, sourceJobId: SOURCE_JOB })
    expect(h.insert.mock.calls[0]![1].input_data.sourceImageUrl).toBe("https://cdn.test/images/a.png")
  })

  it("reads an upload source's url from the caller's own asset row", async () => {
    await post({ assetId: ASSET, sourceAssetId: SOURCE_ASSET })
    expect(h.insert.mock.calls[0]![1].input_data).toMatchObject({
      sourceAssetId: SOURCE_ASSET,
      sourceImageUrl: "https://cdn.test/uploads/images/orig.png",
    })
  })

  it("answers the same job for the same upload without completing it again", async () => {
    h.jobs.set(NEW_JOB, { id: NEW_JOB, user_id: USER, status: "completed", output_data: { imageUrl: "x" } })
    h.insert.mockResolvedValueOnce({ row: { id: NEW_JOB, job_type: "image-edit", status: "completed" }, created: false })

    const res = await post({ assetId: ASSET })

    expect(res.statusCode).toBe(200)
    expect(h.complete).not.toHaveBeenCalled()
    expect(res.json().data.id).toBe(NEW_JOB)
  })

  it("finishes a job whose first attempt died before completing it", async () => {
    h.jobs.set(NEW_JOB, { id: NEW_JOB, user_id: USER, status: "pending" })
    h.insert.mockResolvedValueOnce({ row: { id: NEW_JOB, job_type: "image-edit", status: "pending" }, created: false })

    const res = await post({ assetId: ASSET })

    expect(res.statusCode).toBe(200)
    expect(h.complete).toHaveBeenCalledOnce()
    expect(res.json().data.status).toBe("completed")
  })

  it("reopens and finishes a job a sweep failed after its first attempt died", async () => {
    h.jobs.set(NEW_JOB, {
      id: NEW_JOB, user_id: USER, job_type: "image-edit", credits: 0, status: "failed",
      error_message: "Job never started", error_hint: null,
    })
    h.insert.mockResolvedValueOnce({ row: { id: NEW_JOB, job_type: "image-edit", status: "failed" }, created: false })

    const res = await post({ assetId: ASSET })

    expect(res.statusCode).toBe(200)
    expect(h.updates).toEqual([{
      fields: { status: "pending", error_message: null, error_hint: null, completed_at: null },
      filters: { id: NEW_JOB, user_id: USER, job_type: "image-edit", credits: 0, status: ["failed", "cancelled"] },
      applied: true,
    }])
    expect(h.complete).toHaveBeenCalledOnce()
    expect(res.json().data.status).toBe("completed")
  })

  it("never answers success when the completion did not land", async () => {
    h.complete.mockResolvedValueOnce("lost_race")

    const res = await post({ assetId: ASSET })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("refuses a key that already names a job of another type", async () => {
    h.jobs.set(NEW_JOB, { id: NEW_JOB, user_id: USER, job_type: "generate-image", status: "completed" })
    h.insert.mockResolvedValueOnce({ row: { id: NEW_JOB, job_type: "generate-image", status: "completed" }, created: false })

    const res = await post({ assetId: ASSET })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("conflict")
    expect(h.complete).not.toHaveBeenCalled()
  })

  it("stores the design state's canonical url", async () => {
    await post({ assetId: ASSET, editStateUrl: `https://cdn.test/projects/${STATE}.json` })
    expect(h.insert.mock.calls[0]![1].input_data.editStateUrl).toMatch(new RegExp(`/projects/${STATE}\\.json$`))
  })

  it.each([
    ["another host", `https://evil.test/projects/${STATE}.json`],
    ["another folder of ours", `https://cdn.test/images/${STATE}.json`],
  ])("refuses a design state on %s", async (_label, editStateUrl) => {
    const res = await post({ assetId: ASSET, editStateUrl })
    expect(res.statusCode).toBe(400)
    expect(h.insert).not.toHaveBeenCalled()
  })

  it("is 404 for an asset that is not the caller's", async () => {
    h.assets.set(ASSET, { ...h.assets.get(ASSET), user_id: "someone-else" })
    const res = await post({ assetId: ASSET })
    expect(res.statusCode).toBe(404)
    expect(h.insert).not.toHaveBeenCalled()
  })

  it("refuses an asset that is not an image", async () => {
    h.assets.set(ASSET, { ...h.assets.get(ASSET), type: "video", mime_type: "video/mp4" })
    expect((await post({ assetId: ASSET })).statusCode).toBe(400)
  })

  it("refuses a row that names an object the caller did not make", async () => {
    h.judge.mockResolvedValueOnce({ kind: "refused" })
    const res = await post({ assetId: ASSET })
    expect(res.statusCode).toBe(400)
    expect(h.insert).not.toHaveBeenCalled()
  })

  it("is 404 for a source job that is not the caller's", async () => {
    h.jobs.set(SOURCE_JOB, { ...h.jobs.get(SOURCE_JOB), user_id: "someone-else" })
    expect((await post({ assetId: ASSET, sourceJobId: SOURCE_JOB })).statusCode).toBe(404)
  })

  it("a child job as the source reads exactly as a source that does not exist", async () => {
    h.jobs.set(SOURCE_JOB, { ...h.jobs.get(SOURCE_JOB), parent_job_id: "99999999-9999-4999-8999-999999999999" })
    const child = await post({ assetId: ASSET, sourceJobId: SOURCE_JOB })
    h.jobs.delete(SOURCE_JOB)
    const missing = await post({ assetId: ASSET, sourceJobId: SOURCE_JOB })
    expect(child.statusCode).toBe(404)
    expect(child.json()).toEqual(missing.json())
    expect(h.insert).not.toHaveBeenCalled()
  })

  it("an internal hop that relays a caller's body may not name a child source either", async () => {
    h.jobs.set(SOURCE_JOB, { ...h.jobs.get(SOURCE_JOB), parent_job_id: "99999999-9999-4999-8999-999999999999" })
    const res = await post({ assetId: ASSET, sourceJobId: SOURCE_JOB }, { "x-test-internal": "1" })
    expect(res.statusCode).toBe(404)
  })

  it("a worker-side handler's own request may name its child as the source", async () => {
    h.jobs.set(SOURCE_JOB, { ...h.jobs.get(SOURCE_JOB), parent_job_id: "99999999-9999-4999-8999-999999999999" })
    const { withJobSubmissionContext } = await import("../../lib/job-submission-context.js")
    const res = await withJobSubmissionContext(
      { userId: USER, method: "POST", url: "/v1/jobs/from-upload", parentJobId: "88888888-8888-4888-8888-888888888888" },
      () => post({ assetId: ASSET, sourceJobId: SOURCE_JOB }, { "x-test-internal": "1" }),
    )
    expect(res.statusCode).toBe(201)
  })

  it("refuses a source job with no finished image", async () => {
    h.jobs.set(SOURCE_JOB, { ...h.jobs.get(SOURCE_JOB), status: "processing" })
    expect((await post({ assetId: ASSET, sourceJobId: SOURCE_JOB })).statusCode).toBe(400)
  })

  it("refuses a sourceImageUrl the source job did not make", async () => {
    const res = await post({ assetId: ASSET, sourceJobId: SOURCE_JOB, sourceImageUrl: "https://cdn.test/images/other.png" })
    expect(res.statusCode).toBe(400)
  })

  it("refuses two sources at once", async () => {
    const res = await post({ assetId: ASSET, sourceJobId: SOURCE_JOB, sourceAssetId: SOURCE_ASSET })
    expect(res.statusCode).toBe(400)
  })

  it("answers 422 job_blocked when a job policy blocks the image", async () => {
    h.complete.mockImplementationOnce(async (id: string) => {
      h.jobs.set(id, { ...h.jobs.get(id), status: "failed", error_hint: { kind: "policy-block", reason: "Not allowed here", policyId: "p", hookPoint: "result" } })
      return "blocked"
    })
    const res = await post({ assetId: ASSET })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toEqual({ code: "job_blocked", message: "Not allowed here" })
  })

  it("answers the same 422 when a blocked image is sent again", async () => {
    h.jobs.set(NEW_JOB, {
      id: NEW_JOB, user_id: USER, status: "failed",
      error_hint: { kind: "policy-block", reason: "Not allowed here", policyId: "p", hookPoint: "result" },
    })
    h.insert.mockResolvedValueOnce({ row: { id: NEW_JOB, job_type: "image-edit", status: "failed" }, created: false })

    const res = await post({ assetId: ASSET })

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toEqual({ code: "job_blocked", message: "Not allowed here" })
    expect(h.complete).not.toHaveBeenCalled()
  })

  it("asks an OAuth app for assets:write", async () => {
    const res = await post({ assetId: ASSET }, { "x-app-scopes": "jobs:read" })
    expect(res.statusCode).toBe(403)
    expect(h.insert).not.toHaveBeenCalled()
    expect((await post({ assetId: ASSET }, { "x-app-scopes": "assets:write" })).statusCode).toBe(201)
  })
})
