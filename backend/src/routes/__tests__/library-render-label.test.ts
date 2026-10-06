import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * My Library and the editor library (both read GET /v1/library) label an Apply
 * EDL file from the label stored with it (`assets.metadata.quality`). Files made
 * before that was stored take it from the job that made them (decided
 * 2026-10-05): ONE batched lookup per page, none when no file needs it, and no
 * data rewrite.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://pub-test.r2.dev" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/storage.js", () => ({ deleteFromR2: vi.fn(), s3: {} }))
vi.mock("@/utils/file-validation.js", () => ({ updateStorageUsage: vi.fn() }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { libraryRoutes } from "../library.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"

type Row = Record<string, unknown>
let assetSelects: string[] = []
let jobCalls: Array<{ select: string; ids: string[]; jobTypes: string[] | null }> = []

function seed(assets: Row[], jobs: Row[]) {
  assetSelects = []
  jobCalls = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "assets") {
      const proxy: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: (v: unknown) => void) => res({ data: assets, error: null, count: assets.length })
          if (prop === "select") return (s: string) => { assetSelects.push(s); return proxy }
          return () => proxy
        },
      })
      return proxy as never
    }
    if (table === "jobs") {
      const call = { select: "", ids: [] as string[], jobTypes: null as string[] | null }
      jobCalls.push(call)
      const proxy: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: (v: unknown) => void) => res({ data: jobs, error: null })
          if (prop === "select") return (s: string) => { call.select = s; return proxy }
          if (prop === "in") return (c: string, vals: string[]) => { if (c === "job_type") call.jobTypes = vals; else call.ids = vals; return proxy }
          return () => proxy
        },
      })
      return proxy as never
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const asset = (over: Row = {}): Row => ({
  id: "a1", user_id: USER, type: "video", filename: "cut.mp4", mime_type: "video/mp4", size_bytes: 1,
  r2_key: "videos/j1.mp4", r2_url: "https://pub-test.r2.dev/videos/j1.mp4", job_id: "j1",
  metadata: { thumbnail_url: "https://t/1.jpg" }, is_library_item: false, upload_source: "generated",
  created_at: "2026-09-01T00:00:00Z", ...over,
})

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, unknown> | undefined
    if (typeof q?.userId === "string") req.userId = q.userId
  })
  await app.register(async (i) => { await libraryRoutes(i) })
  await app.ready()
})
afterEach(async () => { await app.close() })

describe("GET /v1/library — the Preview label of a render made before it was stored", () => {
  it("takes it from the job's order, with ONE batched lookup for the page", async () => {
    seed(
      [asset(), asset({ id: "a2", job_id: "j2" }), asset({ id: "a3", type: "audio", job_id: "j1" }), asset({ id: "a4", type: "image", job_id: "j3" })],
      [
        { id: "j1", job_type: "apply-edl", input_quality: "proxy", out_quality: null },
        { id: "j2", job_type: "apply-edl", input_quality: "final", out_quality: null },
      ],
    )
    const res = await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<{ id: string; metadata: Row }>
    expect(data.map((a) => a.metadata.quality)).toEqual(["proxy", "final", "proxy", undefined])
    expect(data[0]!.metadata.thumbnail_url).toBe("https://t/1.jpg")
    expect(jobCalls).toHaveLength(1)
    expect([...jobCalls[0]!.ids].sort()).toEqual(["j1", "j2"])
    // Restricted to render jobs (RENDER_NODE_TYPES): Apply EDL today.
    expect(jobCalls[0]!.jobTypes).toEqual(["apply-edl"])
  })

  it("asks the assets table for job_id (the link to the job)", async () => {
    seed([asset({ metadata: { quality: "proxy" } })], [])
    await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(assetSelects.some((s) => s.split(",").map((c) => c.trim()).includes("job_id"))).toBe(true)
  })

  it("makes no lookup when every file already has its label", async () => {
    seed([asset({ metadata: { quality: "proxy" } }), asset({ id: "a2", metadata: { quality: "final" } })], [])
    const res = await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(res.statusCode).toBe(200)
    expect(jobCalls).toHaveLength(0)
  })

  it("makes no lookup for uploads and images (no job, or not a render medium)", async () => {
    seed([asset({ job_id: null, upload_source: "manual_upload" }), asset({ id: "a2", type: "image" })], [])
    await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(jobCalls).toHaveLength(0)
  })

  it("does not expose job_id on the wire (the answer keeps its shape)", async () => {
    seed([asset()], [{ id: "j1", job_type: "apply-edl", input_quality: "proxy", out_quality: null }])
    const res = await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(res.json().data[0]).not.toHaveProperty("job_id")
    expect(res.json().data[0]).not.toHaveProperty("jobId")
  })
})
