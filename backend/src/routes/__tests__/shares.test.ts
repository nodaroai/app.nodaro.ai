/**
 * Share links (routes/shares.ts, migration 680).
 *
 * The owner routes: only the caller's own item (another person's id is a 404),
 * one row per item — off stamps `revoked_at`, on again clears it with the SAME
 * token — `allowCopy` kept when omitted, and a 422 `share_not_allowed` (with
 * its reason) for an item that may not be shown. The public routes: a 404 for
 * a link that is unknown, turned off, or whose item is gone; what is shown
 * carries no owner, charge, error, address in the settings or id; references
 * only with "allow copy"; a trend run shown as its trend. The items route: the
 * live, shareable items of the session only, a page at a time, and a project's
 * `sessionId` must be one of its own live sessions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { argOf, has, type QueryResult, type RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const STRANGER = "00000000-0000-4000-8000-000000000002"
const JOB = "00000000-0000-4000-8000-0000000000a1"
const SESSION = "00000000-0000-4000-8000-000000000020"
const OTHER_SESSION = "00000000-0000-4000-8000-000000000021"
const PROJECT = "00000000-0000-4000-8000-000000000030"
const UUID = "3f2b8a4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c"

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  shares: [] as Row[],
  jobs: [] as Row[],
  sessions: [] as Row[],
  projects: [] as Row[],
  items: [] as Row[],
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({ data: [] as unknown, error: null as unknown })),
  shareTableMissing: false,
}))

/** The value a query filters `col` on with `.eq` (or `.is`). */
function eqOf(q: RecordedQuery, col: string): unknown {
  const op = q.ops.find((o) => (o.m === "eq" || o.m === "is") && o.a[0] === col)
  return op ? op.a[1] : undefined
}

function matches(q: RecordedQuery, row: Row): boolean {
  return q.ops.every((o) => {
    if (o.m !== "eq" && o.m !== "is") return true
    const col = String(o.a[0])
    if (col.includes(".")) return true
    return (row[col] ?? null) === o.a[1]
  })
}

function respond(q: RecordedQuery): QueryResult {
  if (q.table === "share_links") {
    if (db.shareTableMissing) return { data: null, error: { code: "PGRST205", message: "no table" } }
    const insert = argOf(q, "insert")
    if (insert) {
      const row = { id: `share-${db.shares.length + 1}`, ...(insert[0] as Row) }
      db.shares.push(row)
      return { data: row, error: null }
    }
    const update = argOf(q, "update")
    if (update) {
      const row = db.shares.find((r) => r.id === eqOf(q, "id") && r.owner_id === eqOf(q, "owner_id"))
      if (!row) return { data: null, error: null }
      Object.assign(row, update[0])
      return { data: row, error: null }
    }
    return { data: db.shares.find((r) => matches(q, r)) ?? null, error: null }
  }
  const table = { jobs: db.jobs, generation_sessions: db.sessions, projects: db.projects }[q.table as "jobs" | "generation_sessions" | "projects"]
  if (table) {
    // A list read (the project's sessions) answers every match; a by-id read one row.
    if (argOf(q, "order")) return { data: table.filter((r) => matches(q, r)), error: null }
    return { data: table.find((r) => matches(q, r)) ?? null, error: null }
  }
  if (q.table === "session_items") {
    const keyset = String(argOf(q, "or")?.[0] ?? "")
    const at = /added_at.lt."([^"]+)"/.exec(keyset)?.[1]
    const id = /job_id.lt."([^"]+)"/.exec(keyset)?.[1]
    const after = (r: Row) => !at || String(r.added_at) < at || (String(r.added_at) === at && String(r.job_id) < String(id))
    const limit = Number(argOf(q, "limit")?.[0] ?? 1000)
    return { data: db.items.filter((r) => r.session_id === eqOf(q, "session_id") && after(r)).slice(0, limit), error: null }
  }
  return { data: null, error: null }
}

vi.mock("../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../lib/__tests__/fake-supabase-query.js")
  return {
    supabase: {
      from: makeFakeFrom(db.log, (q) => respond(q)),
      rpc: (fn: string, args: unknown) => db.rpc(fn, args),
    },
  }
})

const gates = vi.hoisted(() => ({ publicOutputs: true, blocked: new Set<string>(), restricted: new Set<string>() }))
vi.mock("../../lib/surface-profile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-profile.js")>()),
  surfaceAllowsPublicOutputs: () => gates.publicOutputs,
}))
vi.mock("../../lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: async (id: string) => gates.blocked.has(id),
}))
vi.mock("../../lib/content-restriction-set.js", () => ({ restrictedKeysNow: () => gates.restricted }))
vi.mock("../../lib/content-restriction-address.js", () => ({
  restrictedKeyOfAddress: (url: string) => (url.startsWith("https://cdn.example/") ? url.slice("https://cdn.example/".length) : null),
}))

import { shareRoutes } from "../shares.js"
import { __isPublicRouteForTest, isAnonymousRoute } from "../../middleware/auth.js"

function jobRow(over: Row = {}): Row {
  return {
    id: JOB,
    user_id: OWNER,
    status: "completed",
    job_type: "generate-image",
    created_at: "2026-11-19T10:00:00.000Z",
    parent_job_id: null,
    restricted_at: null,
    force_private: null,
    deleted_at: null,
    input_data: {
      type: "generate-image",
      userId: OWNER,
      usageLogId: UUID,
      sessionId: SESSION,
      userPrompt: "a red car",
      prompt: "a red car",
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      referenceImageUrls: ["https://cdn.example/uploads/ref.png"],
      webhookUrl: "https://hooks.example/x",
    },
    output_data: { imageUrl: "https://cdn.example/images/a1.png" },
    credits: 8,
    error_message: "secret words",
    ...over,
  }
}

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  db.shares.length = 0
  db.jobs.length = 0
  db.sessions.length = 0
  db.projects.length = 0
  db.items.length = 0
  db.shareTableMissing = false
  db.rpc.mockReset()
  db.rpc.mockResolvedValue({ data: [], error: null })
  gates.publicOutputs = true
  gates.blocked.clear()
  gates.restricted.clear()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") req.appAuthorization = { scopes: scopes.split(" ") } as never
  })
  await app.register(shareRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const as = { "x-user-id": OWNER }

async function put(body: Row, headers: Record<string, string> = as) {
  return app.inject({ method: "PUT", url: "/v1/shares", headers, payload: body })
}

async function shareJob(allowCopy?: boolean): Promise<string> {
  const res = await put({ kind: "job", targetId: JOB, shared: true, ...(allowCopy !== undefined ? { allowCopy } : {}) })
  expect(res.statusCode).toBe(200)
  return res.json().data.token as string
}

describe("the public routes are public, the owner routes are not", () => {
  it("only GET /v1/public/shares/… takes no credential", () => {
    expect(__isPublicRouteForTest("GET", "/v1/public/shares/abc")).toBe(true)
    expect(__isPublicRouteForTest("GET", "/v1/public/shares/abc/items?limit=5")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/public/shares/abc")).toBe(true)
    expect(__isPublicRouteForTest("POST", "/v1/public/shares/abc")).toBe(false)
    expect(__isPublicRouteForTest("GET", "/v1/shares")).toBe(false)
    expect(__isPublicRouteForTest("PUT", "/v1/shares")).toBe(false)
  })
})

describe("PUT /v1/shares — the owner turns a link on and off", () => {
  beforeEach(() => {
    db.jobs.push(jobRow())
  })

  it("the first on makes the link: a 43-character token, allowCopy false", async () => {
    const res = await put({ kind: "job", targetId: JOB, shared: true })
    expect(res.statusCode).toBe(200)
    const share = res.json().data
    expect(share).toMatchObject({ kind: "job", targetId: JOB, shared: true, allowCopy: false })
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(db.shares).toHaveLength(1)
    expect(db.shares[0]).toMatchObject({ owner_id: OWNER, kind: "job", target_id: JOB, revoked_at: null })
  })

  it("off stamps revoked_at, on again clears it with the SAME token", async () => {
    const token = await shareJob()
    const off = await put({ kind: "job", targetId: JOB, shared: false })
    expect(off.json().data).toMatchObject({ token, shared: false })
    expect(typeof db.shares[0]!.revoked_at).toBe("string")
    const on = await put({ kind: "job", targetId: JOB, shared: true })
    expect(on.json().data).toMatchObject({ token, shared: true })
    expect(db.shares).toHaveLength(1)
    expect(db.shares[0]!.revoked_at).toBeNull()
  })

  it("allowCopy omitted keeps its value; given, it changes", async () => {
    await shareJob(true)
    expect((await put({ kind: "job", targetId: JOB, shared: false })).json().data.allowCopy).toBe(true)
    expect((await put({ kind: "job", targetId: JOB, shared: true })).json().data.allowCopy).toBe(true)
    expect((await put({ kind: "job", targetId: JOB, shared: true, allowCopy: false })).json().data.allowCopy).toBe(false)
  })

  it("off on an item never shared makes no live link (a row off from birth)", async () => {
    const res = await put({ kind: "job", targetId: JOB, shared: false, allowCopy: true })
    expect(res.json().data).toMatchObject({ shared: false, allowCopy: true })
    expect(typeof db.shares[0]!.revoked_at).toBe("string")
  })

  it("another person's job is a 404, and no row is made", async () => {
    const res = await put({ kind: "job", targetId: JOB, shared: true }, { "x-user-id": STRANGER })
    expect(res.statusCode).toBe(404)
    expect(db.shares).toHaveLength(0)
    const read = db.log.find((q) => q.table === "jobs")!
    expect(has(read, "eq", "user_id", STRANGER)).toBe(true)
  })

  it("reads the job as a live, top-level job of the caller", async () => {
    await shareJob()
    const read = db.log.find((q) => q.table === "jobs")!
    expect(has(read, "eq", "id", JOB)).toBe(true)
    expect(has(read, "is", "deleted_at", null)).toBe(true)
    expect(has(read, "is", "parent_job_id", null)).toBe(true)
  })

  it.each([
    ["not_completed", { status: "processing" }],
    ["private_output", { force_private: true }],
    ["restricted", { restricted_at: "2026-11-19T11:00:00Z" }],
    ["content_filtered", { title: "nsfw" }],
    ["no_media", { output_data: { text: "x" } }],
  ])("a job that cannot be shared is a 422 (%s), and no row is made", async (reason, over) => {
    db.jobs.length = 0
    db.jobs.push(jobRow(over))
    const res = await put({ kind: "job", targetId: JOB, shared: true })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: "share_not_allowed", reason })
    expect(db.shares).toHaveLength(0)
  })

  it("a job whose output names restricted bytes is a 422 restricted", async () => {
    gates.restricted.add("images/a1.png")
    const res = await put({ kind: "job", targetId: JOB, shared: true })
    expect(res.json().error.reason).toBe("restricted")
  })

  it("turning off is allowed even when the job may no longer be shown", async () => {
    await shareJob()
    db.jobs[0]!.restricted_at = "2026-11-19T11:00:00Z"
    const res = await put({ kind: "job", targetId: JOB, shared: false })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.shared).toBe(false)
  })

  it("a deployment that does not allow public work refuses a link (sharing_disabled)", async () => {
    gates.publicOutputs = false
    const res = await put({ kind: "job", targetId: JOB, shared: true })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.reason).toBe("sharing_disabled")
  })

  it("a session or project of a workspace is a 422 workspace; a personal one is shared", async () => {
    db.sessions.push({ id: SESSION, user_id: OWNER, workspace_id: UUID })
    db.projects.push({ id: PROJECT, user_id: OWNER, workspace_id: null })
    expect((await put({ kind: "session", targetId: SESSION, shared: true })).json().error.reason).toBe("workspace")
    expect((await put({ kind: "project", targetId: PROJECT, shared: true })).json().data).toMatchObject({ kind: "project", shared: true })
    expect((await put({ kind: "project", targetId: PROJECT, shared: true }, { "x-user-id": STRANGER })).statusCode).toBe(404)
  })

  it("validates the body, asks for a sign-in, and an OAuth app needs assets:write AND jobs:read", async () => {
    expect((await put({ kind: "workflow", targetId: JOB, shared: true })).statusCode).toBe(400)
    expect((await put({ kind: "job", targetId: "nope", shared: true })).statusCode).toBe(400)
    expect((await put({ kind: "job", targetId: JOB, shared: true }, {})).statusCode).toBe(401)
    expect((await put({ kind: "job", targetId: JOB, shared: true }, { ...as, "x-app-scopes": "jobs:read" })).statusCode).toBe(403)
    // Write alone would hand an app a token that reads what it could not read itself.
    expect((await put({ kind: "job", targetId: JOB, shared: true }, { ...as, "x-app-scopes": "assets:write" })).statusCode).toBe(403)
    expect((await put({ kind: "job", targetId: JOB, shared: true }, { ...as, "x-app-scopes": "assets:write jobs:read" })).statusCode).toBe(200)
  })

  it("a job in the Trash: its link can be read and turned off, never turned on", async () => {
    await shareJob()
    db.jobs[0]!.deleted_at = "2026-11-19T12:00:00Z"
    expect((await app.inject({ method: "GET", url: `/v1/shares?kind=job&targetId=${JOB}`, headers: as })).json().data.shared).toBe(true)
    const off = await put({ kind: "job", targetId: JOB, shared: false })
    expect(off.statusCode).toBe(200)
    expect(off.json().data.shared).toBe(false)
    // Restored, it stays off until its owner turns it on.
    db.jobs[0]!.deleted_at = null
    expect(db.shares[0]!.revoked_at).not.toBeNull()
    db.jobs[0]!.deleted_at = "2026-11-19T12:00:00Z"
    expect((await put({ kind: "job", targetId: JOB, shared: true })).statusCode).toBe(404)
  })

  it("answers 503 not_available before the table reaches this database", async () => {
    db.shareTableMissing = true
    const res = await put({ kind: "job", targetId: JOB, shared: true })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })
})

describe("GET /v1/shares — the owner's link for one item", () => {
  beforeEach(() => {
    db.jobs.push(jobRow())
  })

  it("null before it was ever shared, then the link", async () => {
    const before = await app.inject({ method: "GET", url: `/v1/shares?kind=job&targetId=${JOB}`, headers: as })
    expect(before.json()).toEqual({ data: null })
    const token = await shareJob()
    const after = await app.inject({ method: "GET", url: `/v1/shares?kind=job&targetId=${JOB}`, headers: as })
    expect(after.json().data).toMatchObject({ token, shared: true })
  })

  it("another person's item is a 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/shares?kind=job&targetId=${JOB}`, headers: { "x-user-id": STRANGER } })
    expect(res.statusCode).toBe(404)
  })

  it("reads as nothing shared before the table reaches this database", async () => {
    db.shareTableMissing = true
    const res = await app.inject({ method: "GET", url: `/v1/shares?kind=job&targetId=${JOB}`, headers: as })
    expect(res.json()).toEqual({ data: null })
  })
})

describe("GET /v1/public/shares/:token — a shared result", () => {
  beforeEach(() => {
    db.jobs.push(jobRow())
  })

  it("shows the result, the prompt and the settings, with no credential", async () => {
    const token = await shareJob()
    const res = await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe("no-store")
    const data = res.json().data
    expect(data).toMatchObject({
      kind: "job",
      allowCopy: false,
      job: {
        id: JOB,
        mediaKind: "image",
        outputUrl: "https://cdn.example/images/a1.png",
        prompt: "a red car",
        model: { id: "nano-banana-pro", name: "Nano Banana Pro" },
        settings: { aspectRatio: "16:9" },
      },
    })
    expect(data.job.references).toBeUndefined()
    const text = JSON.stringify(data)
    for (const forbidden of [OWNER, "user_id", "credits", "secret words", "hooks.example", "usageLogId", UUID, SESSION, "provider"]) {
      expect(text, forbidden).not.toContain(forbidden)
    }
  })

  it("hands out the references only with allow copy", async () => {
    const token = await shareJob(true)
    const res = await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })
    expect(res.json().data.job.references).toEqual([{ url: "https://cdn.example/uploads/ref.png", kind: "image" }])
  })

  it("404s an unknown, malformed or turned-off link", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${"x".repeat(43)}` })).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: "/v1/public/shares/short" })).statusCode).toBe(404)
    const token = await shareJob()
    await put({ kind: "job", targetId: JOB, shared: false })
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })).statusCode).toBe(404)
  })

  it("404s once the job is in the Trash, restricted, or kept private", async () => {
    const token = await shareJob()
    db.jobs[0]!.deleted_at = "2026-11-19T12:00:00Z"
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })).statusCode).toBe(404)
    db.jobs[0]!.deleted_at = null
    db.jobs[0]!.restricted_at = "2026-11-19T12:00:00Z"
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })).statusCode).toBe(404)
    db.jobs[0]!.restricted_at = null
    db.jobs[0]!.force_private = true
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })).statusCode).toBe(404)
    db.jobs[0]!.force_private = null
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })).statusCode).toBe(200)
  })

  it("404s every link of a blocked account, and every link where public work is not allowed", async () => {
    const token = await shareJob()
    gates.blocked.add(OWNER)
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })).statusCode).toBe(404)
    gates.blocked.clear()
    gates.publicOutputs = false
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })).statusCode).toBe(404)
  })

  it("only ever reads the link's owner's job", async () => {
    const token = await shareJob()
    db.log.length = 0
    await app.inject({ method: "GET", url: `/v1/public/shares/${token}`, headers: { "x-user-id": STRANGER } })
    const read = db.log.find((q) => q.table === "jobs")!
    expect(has(read, "eq", "user_id", OWNER)).toBe(true)
  })

  it("shows a trend run as its trend, with no prompt or settings", async () => {
    db.jobs.length = 0
    db.jobs.push(
      jobRow({
        input_data: { type: "cast-swap", trend: { id: UUID, slug: "office-dance", version: 2, name: "Office Dance" }, prompt: "platform wording", resolution: "720p" },
        output_data: { videoUrl: "https://cdn.example/videos/r.mp4" },
      }),
    )
    const token = await shareJob(true)
    const job = (await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })).json().data.job
    expect(job).toMatchObject({ prompt: null, settings: {}, trend: { slug: "office-dance", name: "Office Dance" }, model: { name: "Nodaro Prism" } })
    expect(job.references).toBeUndefined()
  })
})

describe("GET /v1/public/shares/:token — a shared session and a shared project", () => {
  beforeEach(() => {
    db.sessions.push(
      { id: SESSION, user_id: OWNER, project_id: PROJECT, workspace_id: null, archived_at: null, title: "Beach", tool: "create-image", created_at: "2026-11-01T00:00:00Z" },
      { id: OTHER_SESSION, user_id: OWNER, project_id: PROJECT, workspace_id: null, archived_at: null, title: "Empty", tool: "create-video", created_at: "2026-11-02T00:00:00Z" },
    )
    db.projects.push({ id: PROJECT, user_id: OWNER, workspace_id: null, name: "Holiday" })
    db.rpc.mockImplementation(async (_fn: string, args: unknown) => ({
      data: ((args as { p_session_ids: string[] }).p_session_ids).map((id) =>
        id === SESSION
          ? { session_id: id, item_count: 2, recent: [{ job_id: JOB, output_data: { imageUrl: "https://cdn.example/images/a1.png" } }] }
          : { session_id: id, item_count: 0, recent: [] },
      ),
      error: null,
    }))
  })

  it("a session: its title, tool and how many results the link shows", async () => {
    const token = (await put({ kind: "session", targetId: SESSION, shared: true })).json().data.token
    const res = await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })
    expect(res.json().data).toEqual({
      kind: "session",
      allowCopy: false,
      session: { title: "Beach", tool: "create-image", createdAt: "2026-11-01T00:00:00Z", itemCount: 2 },
    })
    const [fn, args] = db.rpc.mock.calls[0]!
    expect(fn).toBe("share_link_session_summaries")
    expect((args as { p_blocked_words: string[] }).p_blocked_words.length).toBeGreaterThan(0)
  })

  it("a project: its name and its sessions that show something, each with its cover", async () => {
    const token = (await put({ kind: "project", targetId: PROJECT, shared: true })).json().data.token
    const res = await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })
    expect(res.json().data).toEqual({
      kind: "project",
      allowCopy: false,
      project: { name: "Holiday", sessions: [{ id: SESSION, title: "Beach", tool: "create-image", itemCount: 2, coverUrl: "https://cdn.example/images/a1.png" }] },
    })
    const list = db.log.find((q) => q.table === "generation_sessions" && argOf(q, "order"))!
    expect(has(list, "eq", "project_id", PROJECT)).toBe(true)
    expect(has(list, "eq", "user_id", OWNER)).toBe(true)
    expect(has(list, "is", "archived_at", null)).toBe(true)
  })

  it("a cover on restricted bytes is no cover", async () => {
    gates.restricted.add("images/a1.png")
    const token = (await put({ kind: "project", targetId: PROJECT, shared: true })).json().data.token
    const res = await app.inject({ method: "GET", url: `/v1/public/shares/${token}` })
    expect(res.json().data.project.sessions[0].coverUrl).toBeNull()
  })

  it("404s a deleted session or project", async () => {
    const sessionToken = (await put({ kind: "session", targetId: SESSION, shared: true })).json().data.token
    const projectToken = (await put({ kind: "project", targetId: PROJECT, shared: true })).json().data.token
    db.sessions.length = 0
    db.projects.length = 0
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${sessionToken}` })).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${projectToken}` })).statusCode).toBe(404)
  })
})

describe("GET /v1/public/shares/:token/items — a session's results", () => {
  function item(jobId: string, addedAt: string, over: Row = {}): Row {
    return { session_id: SESSION, job_id: jobId, added_at: addedAt, job: jobRow({ id: jobId, ...over }) }
  }

  beforeEach(() => {
    db.sessions.push({ id: SESSION, user_id: OWNER, project_id: PROJECT, workspace_id: null, archived_at: null, title: "Beach", tool: "create-image", created_at: "2026-11-01T00:00:00Z" })
    db.projects.push({ id: PROJECT, user_id: OWNER, workspace_id: null, name: "Holiday" })
  })

  async function sessionToken(allowCopy = false): Promise<string> {
    return (await put({ kind: "session", targetId: SESSION, shared: true, allowCopy })).json().data.token
  }

  it("reads only live links of live, finished, top-level, unrestricted, public-able jobs of the owner", async () => {
    const token = await sessionToken()
    db.items.push(item("00000000-0000-4000-8000-0000000000b1", "2026-11-19T10:00:00.000000+00:00"))
    db.log.length = 0
    const res = await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items` })
    expect(res.statusCode).toBe(200)
    const q = db.log.find((r) => r.table === "session_items")!
    expect(has(q, "eq", "session_id", SESSION)).toBe(true)
    expect(has(q, "eq", "user_id", OWNER)).toBe(true)
    expect(has(q, "is", "removed_at", null)).toBe(true)
    expect(has(q, "is", "job.deleted_at", null)).toBe(true)
    expect(has(q, "eq", "job.user_id", OWNER)).toBe(true)
    expect(has(q, "eq", "job.status", "completed")).toBe(true)
    expect(has(q, "is", "job.parent_job_id", null)).toBe(true)
    expect(has(q, "is", "job.restricted_at", null)).toBe(true)
    expect(has(q, "not", "job.force_private", "is", true)).toBe(true)
    expect(String(argOf(q, "select")![0])).toContain("job:jobs!job_id!inner(")
    expect(res.json().data).toHaveLength(1)
  })

  it("leaves out an item the content filter keeps out, and its cursor is always a SHOWN result's", async () => {
    const token = await sessionToken()
    const ids = ["b1", "b2", "b3", "b4"].map((x) => `00000000-0000-4000-8000-0000000000${x}`)
    db.items.push(
      item(ids[0]!, "2026-11-19T10:00:04.000000+00:00"),
      item(ids[1]!, "2026-11-19T10:00:03.000000+00:00", { title: "nsfw" }),
      item(ids[2]!, "2026-11-19T10:00:02.000000+00:00"),
      item(ids[3]!, "2026-11-19T10:00:01.000000+00:00"),
    )
    const first = (await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?limit=2` })).json()
    expect(first.data.map((j: { id: string }) => j.id)).toEqual([ids[0], ids[2]])
    // The cursor names the last result shown, never the hidden one between.
    const decoded = Buffer.from(first.nextCursor, "base64url").toString("utf8")
    expect(decoded).toContain(ids[2])
    expect(decoded).not.toContain(ids[1])
    const second = (await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?limit=2&cursor=${first.nextCursor}` })).json()
    expect(second.data.map((j: { id: string }) => j.id)).toEqual([ids[3]])
    expect(second.nextCursor).toBeNull()
  })

  it("a page of nothing but hidden results gives no cursor that names one", async () => {
    const token = await sessionToken()
    db.items.push(item("00000000-0000-4000-8000-0000000000b9", "2026-11-19T10:00:00.000000+00:00", { title: "nsfw" }))
    const body = (await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?limit=1` })).json()
    expect(body).toEqual({ data: [], nextCursor: null })
  })

  it("the last page has no next cursor; a bad cursor is a 400", async () => {
    const token = await sessionToken()
    db.items.push(item("00000000-0000-4000-8000-0000000000b1", "2026-11-19T10:00:00.000000+00:00"))
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?limit=5` })).json().nextCursor).toBeNull()
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?cursor=nope` })).statusCode).toBe(400)
  })

  it("references only with allow copy", async () => {
    const off = await sessionToken(false)
    db.items.push(item("00000000-0000-4000-8000-0000000000b1", "2026-11-19T10:00:00.000000+00:00"))
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${off}/items` })).json().data[0].references).toBeUndefined()
    const on = await sessionToken(true)
    expect(on).toBe(off)
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${on}/items` })).json().data[0].references).toHaveLength(1)
  })

  it("a shared session takes no other session's id", async () => {
    const token = await sessionToken()
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?sessionId=${OTHER_SESSION}` })).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?sessionId=${SESSION}` })).statusCode).toBe(200)
  })

  it("a shared project needs a sessionId, and only one of its own live sessions", async () => {
    const token = (await put({ kind: "project", targetId: PROJECT, shared: true })).json().data.token
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items` })).statusCode).toBe(400)
    // A session of another project (or another owner) reads as not found.
    db.sessions.push({ id: OTHER_SESSION, user_id: OWNER, project_id: UUID, workspace_id: null, archived_at: null })
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?sessionId=${OTHER_SESSION}` })).statusCode).toBe(404)
    db.log.length = 0
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items?sessionId=${SESSION}` })).statusCode).toBe(200)
    const check = db.log.find((r) => r.table === "generation_sessions")!
    expect(has(check, "eq", "project_id", PROJECT)).toBe(true)
    expect(has(check, "is", "archived_at", null)).toBe(true)
  })

  it("a link to one result has no items", async () => {
    db.jobs.push(jobRow())
    const token = await shareJob()
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items` })).statusCode).toBe(404)
  })

  it("404s once the link is turned off", async () => {
    const token = await sessionToken()
    await put({ kind: "session", targetId: SESSION, shared: false })
    expect((await app.inject({ method: "GET", url: `/v1/public/shares/${token}/items` })).statusCode).toBe(404)
  })
})
