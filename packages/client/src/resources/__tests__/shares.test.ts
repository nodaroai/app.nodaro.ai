/**
 * `client.shares`: each method is the exact request its route takes, unwraps
 * the `{ data }` envelope where the route has one, and the public reads work
 * with no token at all.
 */
import { describe, it, expect, vi } from "vitest"
import { CallbackAuth, createClient, NodaroError, StaticTokenAuth } from "../../index.js"
import type { PublicShare, Share, SharedJob } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

const SHARE: Share = {
  token: "a".repeat(43),
  kind: "job",
  targetId: "00000000-0000-4000-8000-0000000000a1",
  shared: true,
  allowCopy: false,
  createdAt: "2026-11-19T10:00:00Z",
  updatedAt: "2026-11-19T10:00:00Z",
}

const JOB: SharedJob = {
  id: "00000000-0000-4000-8000-0000000000a1",
  type: "generate-image",
  mediaKind: "image",
  outputUrl: "https://cdn.example/images/a1.png",
  title: null,
  createdAt: "2026-11-19T10:00:00Z",
  prompt: "a red car",
  model: { id: "nano-banana-pro", name: "Nano Banana Pro" },
  settings: { aspectRatio: "16:9" },
}

function client(response: () => Promise<Response>, auth = new StaticTokenAuth("t")) {
  const fetchMock = vi.fn().mockImplementation(response)
  const c = createClient({ baseUrl: "https://api.example.com", auth, fetch: fetchMock })
  const call = (i = 0) => ({ url: new URL(fetchMock.mock.calls[i][0] as string), init: fetchMock.mock.calls[i][1] as RequestInit })
  return { c, call }
}

describe("client.shares", () => {
  it("get GETs /v1/shares with the item and unwraps the link (or null)", async () => {
    const { c, call } = client(() => mockOk({ data: SHARE }))
    expect(await c.shares.get({ kind: "job", targetId: SHARE.targetId })).toEqual(SHARE)
    const { url, init } = call()
    expect(url.pathname).toBe("/v1/shares")
    expect(init.method).toBe("GET")
    expect(Object.fromEntries(url.searchParams)).toEqual({ kind: "job", targetId: SHARE.targetId })

    const none = client(() => mockOk({ data: null }))
    expect(await none.c.shares.get({ kind: "session", targetId: SHARE.targetId })).toBeNull()
  })

  it("set PUTs the body as given and unwraps the link; allowCopy is sent only when given", async () => {
    const { c, call } = client(() => mockOk({ data: SHARE }))
    expect(await c.shares.set({ kind: "job", targetId: SHARE.targetId, shared: true })).toEqual(SHARE)
    expect(call().init.method).toBe("PUT")
    expect(call().url.pathname).toBe("/v1/shares")
    expect(JSON.parse(call().init.body as string)).toEqual({ kind: "job", targetId: SHARE.targetId, shared: true })
    await c.shares.set({ kind: "project", targetId: SHARE.targetId, shared: false, allowCopy: true })
    expect(JSON.parse(call(1).init.body as string)).toEqual({ kind: "project", targetId: SHARE.targetId, shared: false, allowCopy: true })
  })

  it("set surfaces a refusal as a NodaroError with its code", async () => {
    const { c } = client(() => mockErr(422, { error: { code: "share_not_allowed", reason: "not_completed", message: "Only a finished result can be shared." } }))
    const err = await c.shares.set({ kind: "job", targetId: SHARE.targetId, shared: true }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).status).toBe(422)
    expect((err as NodaroError).code).toBe("share_not_allowed")
  })

  it("getPublic reads a link signed out — no Authorization header — and unwraps it", async () => {
    const shown: PublicShare = { kind: "job", allowCopy: false, job: JOB }
    const { c, call } = client(() => mockOk({ data: shown }), new CallbackAuth(async () => null))
    expect(await c.shares.getPublic("tok/en")).toEqual(shown)
    expect(call().url.pathname).toBe("/v1/public/shares/tok%2Fen")
    expect((call().init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it("getPublic surfaces a turned-off link as a 404 NodaroError", async () => {
    const { c } = client(() => mockErr(404, { error: { code: "not_found", message: "Shared link not found" } }))
    const err = await c.shares.getPublic("x").catch((e: unknown) => e)
    expect((err as NodaroError).status).toBe(404)
  })

  it("publicItems GETs a page with its cursor, limit and session, and returns the page as is", async () => {
    const page = { data: [JOB], nextCursor: "next" }
    const { c, call } = client(() => mockOk(page))
    expect(await c.shares.publicItems("tok", { cursor: "abc", limit: 10, sessionId: "s1" })).toEqual(page)
    const { url } = call()
    expect(url.pathname).toBe("/v1/public/shares/tok/items")
    expect(Object.fromEntries(url.searchParams)).toEqual({ cursor: "abc", limit: "10", sessionId: "s1" })
    await c.shares.publicItems("tok")
    expect(call(1).url.search).toBe("")
  })
})
