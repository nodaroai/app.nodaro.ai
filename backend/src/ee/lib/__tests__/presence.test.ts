/**
 * Presence notes: a signed-in request notes its user, surface, address,
 * country and browser — at most once per user and surface per 30 s, in the
 * background, never throwing — and the orchestrator's own hop never counts as
 * its owner being here.
 */
import { describe, expect, it, vi } from "vitest"
import type { FastifyRequest } from "fastify"
import { createPresenceRecorder, presenceOf, type PresenceEntry, type PresenceStore } from "../presence.js"

const USER = "00000000-0000-4000-8000-0000000000aa"

function request(over: { userId?: string; internal?: boolean; headers?: Record<string, string>; appId?: string; body?: unknown } = {}): FastifyRequest {
  return {
    userId: "userId" in over ? over.userId : USER,
    isInternalCall: over.internal ?? false,
    appAuthorization: over.appId ? { appId: over.appId, authorizationId: "auth", scopes: [] } : undefined,
    headers: { origin: "https://app.nodaro.ai", "user-agent": "Mozilla/5.0 Chrome/141", ...over.headers },
    body: over.body,
    socket: { remoteAddress: "203.0.113.7" },
  } as unknown as FastifyRequest
}

function memoryStore(): PresenceStore & { entries: PresenceEntry[] } {
  const entries: PresenceEntry[] = []
  return { entries, put: async (entry) => void entries.push(entry), since: async () => entries }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("presenceOf", () => {
  it("names the user, the surface, the address, the country and the browser", () => {
    expect(presenceOf(request({ headers: { "cf-ipcountry": "IL" } }), 1_000)).toEqual({
      userId: USER,
      source: "web",
      detail: "app.nodaro.ai",
      address: "203.0.113.7",
      country: "IL",
      userAgent: "Mozilla/5.0 Chrome/141",
      lastSeenAt: 1_000,
    })
  })

  it("the extension, a developer app, an MCP client and the CLI are surfaces of their own", () => {
    expect(presenceOf(request({ headers: { origin: "chrome-extension://abcdefghijklmnop" } }), 1)).toMatchObject({ source: "extension", detail: "abcdefghijklmnop" })
    expect(presenceOf(request({ appId: "app-1" }), 1)).toMatchObject({ source: "app", detail: "app-1" })
    expect(presenceOf(request({ body: { mcp_client: "claude-ai" } }), 1)).toMatchObject({ source: "mcp", detail: "claude-ai" })
    expect(presenceOf(request({ headers: { origin: "", "x-nodaro-client": "cli/1.4.0" } }), 1)).toMatchObject({ source: "cli", detail: "cli/1.4.0" })
  })

  it("the main app's same-origin GET — no Origin header — is the site at its Host, not 'api'", () => {
    const sameOrigin = { origin: "", "sec-fetch-site": "same-origin", host: "app.nodaro.ai" }
    expect(presenceOf(request({ headers: sameOrigin }), 1)).toMatchObject({ source: "web", detail: "app.nodaro.ai" })
    expect(presenceOf(request({ headers: { ...sameOrigin, host: "NEXT.nodaro.ai" } }), 1)).toMatchObject({ source: "web", detail: "next.nodaro.ai" })
    // Without the browser's same-origin mark, a caller without Origin is still a raw API call.
    expect(presenceOf(request({ headers: { origin: "", host: "app.nodaro.ai" } }), 1)).toMatchObject({ source: "api", detail: null })
    expect(presenceOf(request({ headers: { ...sameOrigin, host: "<script>" } }), 1)).toMatchObject({ source: "api" })
  })

  it("nobody signed in, or the orchestrator's own hop with its owner's id, is not a person here", () => {
    expect(presenceOf(request({ userId: undefined }), 1)).toBeNull()
    expect(presenceOf(request({ internal: true }), 1)).toBeNull()
  })

  it("a country Cloudflare does not know, or Tor, is no country", () => {
    expect(presenceOf(request({ headers: { "cf-ipcountry": "XX" } }), 1)?.country).toBeNull()
    expect(presenceOf(request({ headers: { "cf-ipcountry": "T1" } }), 1)?.country).toBeNull()
    expect(presenceOf(request({ headers: { "cf-ipcountry": "<b>" } }), 1)?.country).toBeNull()
    expect(presenceOf(request(), 1)?.country).toBeNull()
  })
})

describe("createPresenceRecorder", () => {
  it("one note per user and surface per 30 s; another surface is its own", async () => {
    let now = 0
    const store = memoryStore()
    const record = createPresenceRecorder(async () => store, { now: () => now })
    record(request(), 200)
    now = 29_999
    record(request(), 200)
    await settle()
    expect(store.entries).toHaveLength(1)
    record(request({ headers: { origin: "https://studio.nodaro.ai" } }), 200)
    now = 30_000
    record(request(), 200)
    await settle()
    expect(store.entries.map((e) => [e.detail, e.lastSeenAt])).toEqual([
      ["app.nodaro.ai", 0],
      ["studio.nodaro.ai", 29_999],
      ["app.nodaro.ai", 30_000],
    ])
  })

  it("a store that fails is said once and never thrown; one that is not there costs nothing", async () => {
    const log = vi.fn()
    let now = 0
    const failing = createPresenceRecorder(async () => ({ put: async () => Promise.reject(new Error("connection is closed")), since: async () => [] }), { now: () => now, log })
    expect(() => failing(request(), 200)).not.toThrow()
    now = 60_000
    failing(request(), 200)
    await settle()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toMatch(/connection is closed/)
    expect(() => createPresenceRecorder(async () => null)(request(), 200)).not.toThrow()
  })

  it("a refused request — a blocked account, a lapsed session — is not someone here", async () => {
    const store = memoryStore()
    const record = createPresenceRecorder(async () => store)
    record(request(), 403)
    record(request({ headers: { origin: "https://studio.nodaro.ai" } }), 401)
    await settle()
    expect(store.entries).toEqual([])
  })

  it("a note that failed is tried again on the next request, not 30 s later", async () => {
    let now = 0
    let fail = true
    const store = memoryStore()
    const record = createPresenceRecorder(async () => ({ put: async (e) => (fail ? Promise.reject(new Error("not ready")) : store.put(e)), since: async () => [] }), {
      now: () => now,
      log: () => undefined,
    })
    record(request(), 200)
    await settle()
    fail = false
    now = 1_000
    record(request(), 200)
    await settle()
    expect(store.entries.map((e) => e.lastSeenAt)).toEqual([1_000])
  })

  it("past its limit, forgets the least recent pair first — and only that one", async () => {
    const store = memoryStore()
    const record = createPresenceRecorder(async () => store, { now: () => 0, maxTracked: 2 })
    record(request({ userId: "a" }), 200)
    record(request({ userId: "b" }), 200)
    record(request({ userId: "c" }), 200) // past the limit: "a" is forgotten
    record(request({ userId: "a" }), 200) // so it is written again at once, and "b" goes
    record(request({ userId: "c" }), 200) // still remembered: throttled
    await settle()
    expect(store.entries.map((e) => e.userId)).toEqual(["a", "b", "c", "a"])
  })
})
