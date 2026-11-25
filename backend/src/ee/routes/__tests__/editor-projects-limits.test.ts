import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import rateLimit from "@fastify/rate-limit"

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

import { db, seedProject, type ProjectRow } from "./editor-projects-fakes.js"
import { editorProjectRoutes } from "../editor-projects.js"
import { rateLimitKeyGenerator } from "../../../lib/rate-limit-key.js"
import { MAX_LIVE_PROJECTS } from "../editor-projects.js"
import { CUT_RATE_LIMIT } from "../editor-projects-versions.js"
import { SAVE_RATE_LIMIT } from "../editor-projects-file.js"
import { ME, OTHER, TAB, envelope, heldProject, json, putFile, readBack, saveWhole, sha, startApp, stopApp } from "./editor-projects-harness.js"

/**
 * What one user may cost an instance: one heavy request (save, cut, restore,
 * version read) at a time, the cuts a minute (asked for or carried by a
 * save), the reads and creates a minute, and the live projects one person
 * may hold.
 */

beforeEach(startApp)
afterEach(stopApp)

const cut = (p: ProjectRow, user = ME) => json("POST", `/v1/editor-projects/${p.id}/versions`, { label: "Manual edit", author: "you", holder: TAB }, user)
const restore = (p: ProjectRow, n: number) => json("POST", `/v1/editor-projects/${p.id}/versions/${n}/restore`, { holder: TAB })
const busy = (res: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }) => {
  expect(res.statusCode).toBe(429)
  expect(res.json()).toEqual({ error: "busy" })
  expect(res.headers["retry-after"]).toBe("1")
}

describe("one heavy request at a time per user", () => {
  it("a save while the same user's save runs is 429 busy (retry-after: 1); another user's save runs", async () => {
    const p = heldProject()
    const q = seedProject({ user_id: OTHER, holder_id: TAB, holder_seen_at: new Date().toISOString() })
    await saveWhole(p, { v: 1 })
    const second = envelope({ v: 2 })
    const theirs = envelope({ theirs: true })
    let inner: Awaited<ReturnType<typeof putFile>> | null = null
    let other: Awaited<ReturnType<typeof putFile>> | null = null
    db.beforeSave = async () => {
      inner = await putFile(p.id, second.gz, second.hash)
      other = await putFile(q.id, theirs.gz, theirs.hash, {}, OTHER)
    }
    const res = await putFile(p.id, envelope({ v: 3 }).gz, envelope({ v: 3 }).hash)
    expect(res.statusCode).toBe(200)
    busy(inner!)
    expect(other!.statusCode).toBe(200)
  })

  it("a cut, a restore and a version read are refused busy too, while the plain file read is not", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    const seen: Array<Awaited<ReturnType<typeof json>>> = []
    let plain: Awaited<ReturnType<typeof readBack>> | null = null
    db.beforeSave = async () => {
      seen.push(await cut(p), await restore(p, 1), await json("GET", `/v1/editor-projects/${p.id}/file?version=1`))
      plain = await readBack(p)
    }
    expect((await putFile(p.id, envelope({ v: 2 }).gz, envelope({ v: 2 }).hash)).statusCode).toBe(200)
    for (const res of seen) busy(res)
    expect(plain!.status).toBe(200)
  })

  it("the turn is given back on every outcome: a refused, a malformed and a not-found request each leave the next one free", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    expect((await putFile(p.id, e.gz, sha("not this"))).json()).toEqual({ error: "hash_mismatch" })
    expect((await putFile(p.id, e.gz, e.hash, { "x-holder": "!" })).json()).toEqual({ error: "invalid_holder" })
    expect((await putFile(p.id, Buffer.from("not gzip"), e.hash)).json()).toEqual({ error: "invalid_gzip" })
    expect((await json("GET", `/v1/editor-projects/${p.id}/file?version=7`)).statusCode).toBe(404)
    expect((await cut(p)).statusCode).toBe(404)
    expect((await putFile(p.id, e.gz, e.hash)).json()).toEqual({ revision: 1, saved: true })
  })
})

describe("the cut limit, shared by POST /versions and x-cut-version", () => {
  it(`past ${CUT_RATE_LIMIT.max} cuts a minute, a save's x-cut-version is skipped and the save stands`, async () => {
    const p = heldProject()
    await saveWhole(p, { v: 0 })
    for (let i = 0; i < CUT_RATE_LIMIT.max; i++) expect((await cut(p)).statusCode).toBe(200)
    const next = envelope({ v: 1 })
    const res = await putFile(p.id, next.gz, next.hash, { "x-cut-version": "Exported" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ revision: 2, saved: true })
    expect(db.versions.filter((v) => v.project_id === p.id)).toHaveLength(1)
  })

  it("cuts carried by saves count: past the limit the POST is 429 in the rate-limit shape, for that user only", async () => {
    const p = heldProject()
    for (let i = 0; i < CUT_RATE_LIMIT.max; i++) {
      const e = envelope({ v: i })
      expect((await putFile(p.id, e.gz, e.hash, { "x-cut-version": `v${i}` })).json()).toMatchObject({ saved: true, version: i + 1 })
    }
    const res = await cut(p)
    expect(res.statusCode).toBe(429)
    expect(res.headers["retry-after"]).toMatch(/^[1-9][0-9]*$/)
    expect(res.json()).toMatchObject({ statusCode: 429, error: { code: "rate_limit_exceeded" } })
    const q = seedProject({ user_id: OTHER, holder_id: TAB, holder_seen_at: new Date().toISOString() })
    const theirs = envelope({ theirs: 1 })
    expect((await putFile(q.id, theirs.gz, theirs.hash, {}, OTHER)).statusCode).toBe(200)
    expect((await cut(q, OTHER)).json()).toEqual({ number: 1 })
  })

  it("a cut refused 404 or 409 uses none of the limit", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 0 })
    for (let i = 0; i < CUT_RATE_LIMIT.max; i++) {
      const res = await json("POST", `/v1/editor-projects/${p.id}/versions`, { label: "x", author: "you", holder: "tab-not-the-holder" })
      expect(res.json()).toEqual({ error: "not_holder" })
      expect((await json("POST", `/v1/editor-projects/00000000-0000-4000-8000-0000000000ff/versions`, { label: "x", author: "you", holder: TAB })).statusCode).toBe(404)
    }
    expect((await cut(p)).json()).toEqual({ number: 1 })
  })

  it("the count starts again after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const p = heldProject()
      await saveWhole(p, { v: 0 })
      for (let i = 0; i < CUT_RATE_LIMIT.max; i++) await cut(p)
      expect((await cut(p)).statusCode).toBe(429)
      vi.setSystemTime(Date.now() + 61_000)
      expect((await cut(p)).statusCode).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("live projects per person", () => {
  it(`creating past ${MAX_LIVE_PROJECTS} live projects is 409 too_many_projects; deleted ones do not count`, async () => {
    expect(MAX_LIVE_PROJECTS).toBe(500)
    for (let i = 0; i < MAX_LIVE_PROJECTS - 1; i++) seedProject({ user_id: ME })
    seedProject({ user_id: ME, deleted_at: new Date().toISOString() })
    seedProject({ user_id: OTHER })
    const last = await json("POST", "/v1/editor-projects", { name: "The 500th" })
    expect(last.statusCode, last.body).toBe(200)
    const over = await json("POST", "/v1/editor-projects", { name: "One too many" })
    expect(over.statusCode).toBe(409)
    expect(over.json()).toEqual({ error: "too_many_projects" })
    expect((await json("POST", "/v1/editor-projects", { name: "Theirs" }, OTHER)).statusCode).toBe(200)
  })
})

describe("rate limits, through the app's real limiter", () => {
  let app: FastifyInstance
  beforeEach(async () => {
    app = Fastify({ logger: false })
    await app.register(rateLimit, { global: false, keyGenerator: rateLimitKeyGenerator })
    app.addHook("preHandler", async (req) => {
      req.userId = ME
    })
    await app.register(editorProjectRoutes)
    await app.ready()
  })
  afterEach(async () => {
    await app.close()
  })
  const as = (url: string, method: "GET" | "POST" = "GET", payload?: object) =>
    app.inject({ method, url, headers: { authorization: "Bearer one" }, ...(payload ? { payload } : {}) })

  it("version reads are 60 a minute and current reads 120 a minute, in separate buckets", async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    expect((await cut(p)).json()).toEqual({ number: 1 })
    for (let i = 0; i < 60; i++) expect((await as(`/v1/editor-projects/${p.id}/file?version=1`)).statusCode).toBe(200)
    expect((await as(`/v1/editor-projects/${p.id}/file?version=1`)).statusCode).toBe(429)
    for (let i = 0; i < 120; i++) expect((await as(`/v1/editor-projects/${p.id}/file`)).statusCode).toBe(200)
    expect((await as(`/v1/editor-projects/${p.id}/file`)).statusCode).toBe(429)
  }, 60_000)

  it("creating projects is 30 a minute", async () => {
    for (let i = 0; i < 30; i++) expect((await as("/v1/editor-projects", "POST", { name: `p${i}` })).statusCode).toBe(200)
    expect((await as("/v1/editor-projects", "POST", { name: "one more" })).statusCode).toBe(429)
  })
})

describe("limits on the version routes", () => {
  it("the restore carries the saves' rate limit, the version POST 30 a minute", async () => {
    const seen: Record<string, unknown> = {}
    const probe = Fastify({ logger: false })
    probe.addHook("onRoute", (opts) => {
      if (opts.method === "POST" && String(opts.url).includes("/versions")) seen[opts.url] = opts.config
    })
    await probe.register(editorProjectRoutes)
    await probe.ready()
    await probe.close()
    expect(seen["/v1/editor-projects/:id/versions"]).toMatchObject({ rateLimit: { max: 30, timeWindow: "1 minute" } })
    expect(seen["/v1/editor-projects/:id/versions/:n/restore"]).toMatchObject({ rateLimit: SAVE_RATE_LIMIT })
  })

  it("a version request body over the limit is 413 too_large", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    const big = { label: "x", author: "you", holder: TAB, pad: "y".repeat(20_000) }
    const cutRes = await json("POST", `/v1/editor-projects/${p.id}/versions`, big)
    expect(cutRes.statusCode).toBe(413)
    expect(cutRes.json()).toEqual({ error: "too_large" })
    const restoreRes = await json("POST", `/v1/editor-projects/${p.id}/versions/1/restore`, big)
    expect(restoreRes.statusCode).toBe(413)
    expect(restoreRes.json()).toEqual({ error: "too_large" })
  })
})
