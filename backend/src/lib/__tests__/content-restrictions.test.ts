/**
 * Content restrictions (lib/content-restrictions.ts) over an in-memory store
 * that stands in for the database functions: restricting a file hands the
 * function its keys, hash and source; restricting a job hands it the keys of
 * the job's OWN outputs (held ones included) and refuses an unfinished job
 * before asking; the functions' refusals become this module's errors; the
 * proxies' question reads the active keys once a minute, by pages, decoding
 * what an address names.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mem = vi.hoisted(() => ({
  assets: [] as Array<Record<string, unknown>>,
  jobs: [] as Array<Record<string, unknown>>,
  restrictions: [] as Array<Record<string, unknown>>,
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  rpcError: null as null | { code: string; message: string },
  setReads: 0,
  pageSize: 500,
  seq: 0,
}))

vi.mock("../config.js", () => ({ config: { R2_PUBLIC_URL: "https://cdn.example.test", R2_PUBLIC_FALLBACK_DOMAIN: "fallback.example.test" } }))
vi.mock("../supabase.js", () => {
  const record = (over: Record<string, unknown>) => ({
    id: `r-${++mem.seq}`,
    asset_id: null,
    job_id: null,
    r2_keys: [],
    content_hash: null,
    asset_ids: [],
    job_ids: [],
    source_url: null,
    owner_user_id: null,
    reason: "",
    complaint_id: null,
    restricted_by: null,
    restricted_at: new Date(Date.now() + mem.seq).toISOString(),
    lifted_by: null,
    lifted_at: null,
    lift_reason: null,
    ...over,
  })
  const rpc = async (name: string, args: Record<string, unknown>) => {
    mem.rpcCalls.push([name, args])
    if (mem.rpcError) return { data: null, error: mem.rpcError }
    if (name === "restrict_content") {
      const row = record({
        asset_id: args.p_asset_id,
        job_id: args.p_job_id,
        r2_keys: args.p_keys,
        content_hash: args.p_content_hash,
        source_url: args.p_source_url,
        owner_user_id: args.p_owner_user_id,
        reason: args.p_reason,
        complaint_id: args.p_complaint_id,
        restricted_by: args.p_admin_user_id,
      })
      mem.restrictions.push(row)
      return { data: row, error: null }
    }
    if (name === "lift_content_restriction") {
      const row = mem.restrictions.find((r) => r.id === args.p_id)
      if (!row) return { data: null, error: { code: "P0002", message: "no such restriction" } }
      if (row.lifted_at) return { data: null, error: { code: "23505", message: "lifted before" } }
      Object.assign(row, { lifted_at: new Date().toISOString(), lifted_by: args.p_admin_user_id, lift_reason: args.p_reason })
      return { data: row, error: null }
    }
    return { data: null, error: { code: "42883", message: "no such function" } }
  }
  const table = (name: string) => {
    const q: { eqs: Array<[string, unknown]>; nulls: string[]; range?: [number, number] } = { eqs: [], nulls: [] }
    const store = (): Array<Record<string, unknown>> => (name === "assets" ? mem.assets : name === "jobs" ? mem.jobs : name === "content_restrictions" ? mem.restrictions : [])
    const rows = () => store().filter((row) => q.eqs.every(([c, v]) => row[c] === v) && q.nulls.every((c) => row[c] === null || row[c] === undefined))
    const settle = () => {
      if (name === "content_restrictions") mem.setReads++
      const hit = rows()
      const paged = q.range ? hit.slice(q.range[0], q.range[1] + 1) : hit
      return { data: paged, error: null }
    }
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        q.eqs = [...q.eqs, [c, v]]
        return chain
      },
      is: (c: string, v: unknown) => {
        if (v === null) q.nulls = [...q.nulls, c]
        return chain
      },
      order: () => chain,
      limit: () => chain,
      range: (from: number, to: number) => {
        q.range = [from, to]
        return chain
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(settle()).then(resolve, reject),
    }
    return chain
  }
  return { supabase: { from: table, rpc } }
})

import {
  ContentRestrictionError,
  RESTRICTED_SET_TTL_MS,
  __resetRestrictedSetForTests,
  isRestrictedAddress,
  liftRestriction,
  listRestrictions,
  restrictAsset,
  restrictJob,
  restrictedKeyOfAddress,
} from "../content-restrictions.js"

const JOB = "0f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"

beforeEach(() => {
  mem.assets.length = 0
  mem.jobs.length = 0
  mem.restrictions.length = 0
  mem.rpcCalls.length = 0
  mem.rpcError = null
  mem.setReads = 0
  mem.seq = 0
  __resetRestrictedSetForTests()
  vi.useRealTimers()
  mem.assets.push({
    id: "a-1",
    user_id: "u1",
    r2_key: "videos/a.mp4",
    content_hash: "h1",
    metadata: { source_url: "https://youtube.com/watch?v=x", thumbnail_url: "https://cdn.example.test/thumbs/a.jpg" },
    restricted_at: null,
  })
  mem.jobs.push({
    id: JOB,
    user_id: "u1",
    status: "completed",
    output_data: { videoUrl: `https://cdn.example.test/videos/${JOB}.mp4`, inputUrl: "https://cdn.example.test/uploads/somebody-else.mp4", thumbnailUrl: "https://elsewhere.test/t.jpg" },
    held_output_data: null,
    restricted_at: null,
  })
})

describe("restrictAsset", () => {
  it("hands the function the file's keys (its thumbnail's too), hash, source and owner, and answers the record", async () => {
    const r = await restrictAsset("a-1", { reason: "complaint CR-1", complaintId: "c-1", adminUserId: "admin" })
    expect(mem.rpcCalls).toEqual([
      ["restrict_content", { p_asset_id: "a-1", p_job_id: null, p_keys: ["videos/a.mp4", "thumbs/a.jpg"], p_content_hash: "h1", p_source_url: "https://youtube.com/watch?v=x", p_owner_user_id: "u1", p_reason: "complaint CR-1", p_complaint_id: "c-1", p_admin_user_id: "admin" }],
    ])
    expect(r).toMatchObject({ assetId: "a-1", r2Keys: ["videos/a.mp4", "thumbs/a.jpg"], contentHash: "h1", reason: "complaint CR-1", complaintId: "c-1", restrictedBy: "admin", liftedAt: null })
  })

  it("refuses an unknown file and a file restricted already before asking the function", async () => {
    await expect(restrictAsset("nope", { reason: "x", adminUserId: null })).rejects.toMatchObject({ code: "not_found" })
    mem.assets[0]!.restricted_at = "2026-11-02T00:00:00Z"
    await expect(restrictAsset("a-1", { reason: "x", adminUserId: null })).rejects.toMatchObject({ code: "already_restricted" })
    expect(mem.rpcCalls).toEqual([])
  })

  it("maps the function's refusals: a restriction made meanwhile, an unknown complaint", async () => {
    mem.rpcError = { code: "23505", message: "already" }
    await expect(restrictAsset("a-1", { reason: "x", adminUserId: null })).rejects.toMatchObject({ code: "already_restricted" })
    mem.rpcError = { code: "23503", message: "fk" }
    await expect(restrictAsset("a-1", { reason: "x", complaintId: "nope", adminUserId: null })).rejects.toMatchObject({ code: "unknown_complaint" })
    mem.rpcError = { code: "XX000", message: "boom" }
    await expect(restrictAsset("a-1", { reason: "x", adminUserId: null })).rejects.not.toBeInstanceOf(ContentRestrictionError)
  })
})

describe("restrictJob", () => {
  it("hands the function the keys of the job's OWN outputs, held ones included, never an input's", async () => {
    mem.jobs[0]!.status = "pending_review"
    mem.jobs[0]!.held_output_data = { imageUrl: `https://cdn.example.test/images/${JOB}-1.png` }
    const r = await restrictJob(JOB, { reason: "complaint", adminUserId: "admin" })
    expect(mem.rpcCalls[0]![1]).toMatchObject({ p_asset_id: null, p_job_id: JOB, p_keys: [`videos/${JOB}.mp4`, `images/${JOB}-1.png`], p_owner_user_id: "u1" })
    expect(r.jobId).toBe(JOB)
  })

  it("refuses a job that is not finished, before asking the function", async () => {
    mem.jobs[0]!.status = "running"
    await expect(restrictJob(JOB, { reason: "x", adminUserId: null })).rejects.toMatchObject({ code: "job_not_finished" })
    expect(mem.rpcCalls).toEqual([])
    mem.rpcError = { code: "55P03", message: "not finished" }
    mem.jobs[0]!.status = "completed"
    await expect(restrictJob(JOB, { reason: "x", adminUserId: null })).rejects.toMatchObject({ code: "job_not_finished" })
  })
})

describe("liftRestriction and listRestrictions", () => {
  it("lifts through the function once, and maps an unknown or lifted record", async () => {
    const r = await restrictAsset("a-1", { reason: "x", adminUserId: "admin" })
    const lifted = await liftRestriction(r.id, { reason: "counter-notice", adminUserId: "admin2" })
    expect(lifted).toMatchObject({ id: r.id, liftedBy: "admin2", liftReason: "counter-notice" })
    expect(lifted.liftedAt).toBeTruthy()
    await expect(liftRestriction(r.id, { reason: null, adminUserId: null })).rejects.toMatchObject({ code: "already_lifted" })
    await expect(liftRestriction("nope", { reason: null, adminUserId: null })).rejects.toMatchObject({ code: "not_found" })
  })

  it("lists every record, or the active ones only", async () => {
    const a = await restrictAsset("a-1", { reason: "x", adminUserId: null })
    await restrictJob(JOB, { reason: "y", adminUserId: null })
    await liftRestriction(a.id, { reason: null, adminUserId: null })
    expect((await listRestrictions()).map((r) => r.id).sort()).toEqual([a.id, "r-2"].sort())
    expect((await listRestrictions({ active: true })).map((r) => r.id)).toEqual(["r-2"])
  })
})

describe("the proxies' question", () => {
  it("decodes what an address names: a display rendition, a media transform, the fallback host, percent-escapes; never another host", () => {
    expect(restrictedKeyOfAddress("https://cdn.example.test/videos/a.mp4?download=1")).toBe("videos/a.mp4")
    expect(restrictedKeyOfAddress("https://cdn.example.test/cdn-cgi/image/width=200/videos/a.jpg")).toBe("videos/a.jpg")
    expect(restrictedKeyOfAddress("https://cdn.example.test/cdn-cgi/media/time=1s/videos/a.mp4")).toBe("videos/a.mp4")
    expect(restrictedKeyOfAddress("https://fallback.example.test/videos/a.mp4")).toBe("videos/a.mp4")
    expect(restrictedKeyOfAddress("https://cdn.example.test/videos/%61%2Emp4")).toBe("videos/a.mp4")
    expect(restrictedKeyOfAddress("https://elsewhere.test/videos/a.mp4")).toBeNull()
    expect(restrictedKeyOfAddress("not a url")).toBeNull()
  })

  it("reads an http address of ours as the https one, and a transform whose source is a whole address of ours", () => {
    expect(restrictedKeyOfAddress("http://cdn.example.test/videos/a.mp4")).toBe("videos/a.mp4")
    expect(restrictedKeyOfAddress("https://cdn.example.test/cdn-cgi/image/width=4000/https://cdn.example.test/videos/a.jpg")).toBe("videos/a.jpg")
    expect(restrictedKeyOfAddress("https://cdn.example.test/cdn-cgi/media/time=1s/https%3A%2F%2Fcdn.example.test%2Fvideos%2Fa.mp4")).toBe("videos/a.mp4")
    expect(restrictedKeyOfAddress("https://cdn.example.test/cdn-cgi/image/width=10/https://elsewhere.test/videos/a.jpg")).toBeNull()
    // Bounded: a transform of a transform of a transform is not followed.
    const nested3 = "https://cdn.example.test/cdn-cgi/image/w=1/https://cdn.example.test/cdn-cgi/image/w=2/https://cdn.example.test/cdn-cgi/image/w=3/https://cdn.example.test/videos/a.jpg"
    expect(restrictedKeyOfAddress(nested3)).toBeNull()
  })

  it("answers from the active keys, read once a minute and again after a restriction or a lift", async () => {
    vi.useFakeTimers()
    expect(await isRestrictedAddress("https://cdn.example.test/videos/a.mp4")).toBe(false)
    expect(await isRestrictedAddress("https://cdn.example.test/videos/a.mp4")).toBe(false)
    expect(mem.setReads).toBe(1)
    const r = await restrictAsset("a-1", { reason: "x", adminUserId: null })
    expect(await isRestrictedAddress("https://cdn.example.test/videos/a.mp4")).toBe(true)
    expect(await isRestrictedAddress("https://fallback.example.test/thumbs/a.jpg")).toBe(true)
    expect(await isRestrictedAddress("https://cdn.example.test/videos/b.mp4")).toBe(false)
    expect(await isRestrictedAddress("https://elsewhere.test/videos/a.mp4")).toBe(false)
    const readsAfterRestrict = mem.setReads
    vi.advanceTimersByTime(RESTRICTED_SET_TTL_MS + 1)
    await isRestrictedAddress("https://cdn.example.test/videos/a.mp4")
    expect(mem.setReads).toBe(readsAfterRestrict + 1)
    await liftRestriction(r.id, { reason: null, adminUserId: null })
    expect(await isRestrictedAddress("https://cdn.example.test/videos/a.mp4")).toBe(false)
  })

  it("reads the active records by pages until a page comes back short", async () => {
    for (let i = 0; i < 1201; i++) mem.restrictions.push({ id: `p-${i}`, r2_keys: [`k/${i}`], lifted_at: null, restricted_at: "2026-11-02T00:00:00Z" })
    expect(await isRestrictedAddress("https://cdn.example.test/k/1200")).toBe(true)
    expect(mem.setReads).toBe(3)
  })
})
