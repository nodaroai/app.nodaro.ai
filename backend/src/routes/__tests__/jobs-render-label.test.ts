import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The Preview label of a render recorded before it was stored (decided
 * 2026-10-05): every job READ the editor restores a result from, and the
 * Executions tab shows, fills `output_data.quality` from the order's quality
 * with the one rule (`jobRowStamp`). The stored row is never written, and a
 * lean route stays lean (no `job_type`, no helper column in its answer).
 *
 * The fake `jobs` table PROJECTS to the columns the route selected, aliases
 * (`alias:column->>key`) included, exactly as PostgREST would — a mock that
 * hands back whole seed rows hides a route that never asked for a column.
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/workflow-delete.js", () => ({ deleteJobWithPrivateMedia: vi.fn() }))

import { jobRoutes } from "../jobs.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"

type Row = Record<string, unknown>

function project(row: Row, select: string): Row {
  const out: Row = {}
  for (const raw of select.split(",").map((c) => c.trim()).filter(Boolean)) {
    const alias = /^(\w+):(\w+)->>(\w+)$/.exec(raw)
    if (alias) {
      const src = row[alias[2]!]
      const v = src && typeof src === "object" ? (src as Row)[alias[3]!] : undefined
      out[alias[1]!] = v === undefined ? null : v
    } else if (raw in row) {
      out[raw] = row[raw]
    }
  }
  return out
}

let selects: string[] = []

function seed(rows: Row[]) {
  selects = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "usage_logs") {
      return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) } as never
    }
    if (table !== "jobs") throw new Error(`unexpected table ${table}`)
    let select = ""
    const result = () => rows.map((r) => project(r, select))
    const proxy: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => res({ data: result(), error: null })
        if (prop === "single") return () => Promise.resolve({ data: result()[0] ?? null, error: null })
        if (prop === "select") return (s: string) => { select = s; selects.push(s); return proxy }
        return () => proxy
      },
    })
    return proxy as never
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, string | undefined> | undefined
    if (q?.__userId) { req.userId = q.__userId; req.userRole = undefined }
  })
  await app.register(async (i) => { await jobRoutes(i) })
  await app.ready()
})
afterEach(async () => { await app.close() })

const OLD_PREVIEW: Row = {
  id: "job-old",
  user_id: USER,
  status: "completed",
  progress: 100,
  job_type: "apply-edl",
  input_data: { quality: "proxy", edl: { clips: [] } },
  output_data: { videoUrl: "https://cdn/cut.mp4" },
  error_message: null,
  created_at: "2026-09-01T00:00:00Z",
  completed_at: "2026-09-01T00:01:00Z",
}
const OLD_FINAL: Row = { ...OLD_PREVIEW, id: "job-final", input_data: { quality: "final" } }
const NOT_A_RENDER: Row = {
  ...OLD_PREVIEW, id: "job-img", job_type: "generate-image", input_data: { quality: "proxy" }, output_data: { imageUrl: "https://cdn/i.png" },
}
const STORED: Row = { ...OLD_PREVIEW, id: "job-new", output_data: { videoUrl: "https://cdn/n.mp4", quality: "final" } }

describe("GET /v1/jobs/:id/status (the lean read a reopened or finished node restores from)", () => {
  it("fills the label from the order, and stays lean", async () => {
    seed([OLD_PREVIEW])
    const res = await app.inject({ method: "GET", url: `/v1/jobs/job-old/status?__userId=${USER}` })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.output_data).toEqual({ videoUrl: "https://cdn/cut.mp4", quality: "proxy" })
    expect(data).not.toHaveProperty("job_type")
    expect(data).not.toHaveProperty("input_quality")
    expect(data).not.toHaveProperty("input_data")
  })

  it("labels a final order a final, keeps a stored label, leaves another node type alone", async () => {
    for (const [row, expected] of [
      [OLD_FINAL, { videoUrl: "https://cdn/cut.mp4", quality: "final" }],
      [STORED, { videoUrl: "https://cdn/n.mp4", quality: "final" }],
      [NOT_A_RENDER, { imageUrl: "https://cdn/i.png" }],
    ] as const) {
      seed([row])
      const res = await app.inject({ method: "GET", url: `/v1/jobs/${String(row.id)}/status?__userId=${USER}` })
      expect(res.json().data.output_data).toEqual(expected)
    }
  })
})

describe("GET /v1/jobs/status?ids= (the light batch poll)", () => {
  it("fills each render's label and stays lean", async () => {
    seed([OLD_PREVIEW, NOT_A_RENDER])
    const res = await app.inject({ method: "GET", url: `/v1/jobs/status?ids=job-old,job-img&__userId=${USER}` })
    expect(res.statusCode).toBe(200)
    const jobs = res.json().jobs as Row[]
    expect((jobs[0]!.output_data as Row).quality).toBe("proxy")
    expect((jobs[1]!.output_data as Row).quality).toBeUndefined()
    for (const j of jobs) {
      expect(j).not.toHaveProperty("job_type")
      expect(j).not.toHaveProperty("input_quality")
    }
  })
})

describe("POST /v1/jobs/batch-status (the reopen restore)", () => {
  it("fills each render's label and stays lean", async () => {
    seed([OLD_PREVIEW, OLD_FINAL, NOT_A_RENDER])
    const res = await app.inject({
      method: "POST",
      url: `/v1/jobs/batch-status?__userId=${USER}`,
      payload: { jobIds: ["job-old", "job-final", "job-img"] },
    })
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Row[]
    expect(data.map((j) => (j.output_data as Row).quality)).toEqual(["proxy", "final", undefined])
    for (const j of data) {
      expect(j).not.toHaveProperty("job_type")
      expect(j).not.toHaveProperty("input_quality")
    }
  })
})

describe("GET /v1/jobs/:id (the Executions tab's job)", () => {
  it("fills the label from the order and still names its job type", async () => {
    seed([OLD_PREVIEW])
    const res = await app.inject({ method: "GET", url: `/v1/jobs/job-old?__userId=${USER}` })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.output_data.quality).toBe("proxy")
    expect(data.job_type).toBe("apply-edl")
    expect(data).not.toHaveProperty("input_quality")
  })
})

describe("GET /v1/jobs (Recent Activity)", () => {
  it("fills each render's label from the order", async () => {
    seed([OLD_PREVIEW, OLD_FINAL, NOT_A_RENDER])
    const res = await app.inject({ method: "GET", url: `/v1/jobs?__userId=${USER}` })
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Row[]
    expect(data.map((j) => (j.output_data as Row).quality)).toEqual(["proxy", "final", undefined])
  })
})

describe("the fill is a read-time answer only", () => {
  it("never writes the label into the stored row", async () => {
    seed([OLD_PREVIEW])
    await app.inject({ method: "GET", url: `/v1/jobs/job-old/status?__userId=${USER}` })
    expect((OLD_PREVIEW.output_data as Row).quality).toBeUndefined()
    // and nothing but reads reached the table
    const calls = vi.mocked(supabase.from).mock.calls.map((c) => c[0])
    expect(calls.every((t) => t === "jobs" || t === "usage_logs")).toBe(true)
  })
})
