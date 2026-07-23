import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import rateLimit from "@fastify/rate-limit"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

// The update chain is `.update(...).eq(...).is(...).select(...)`, where only the
// terminal `.select()` resolves. `vi.hoisted` keeps the refs initialized before
// the vi.mock factory first runs.
const { selectMock, isMock, eqMock, updateMock, fromMock } = vi.hoisted(() => {
  const selectMock = vi.fn()
  const isMock = vi.fn()
  const eqMock = vi.fn()
  const updateMock = vi.fn()
  // Captures the TABLE name too — a mock that swallows it cannot catch a write
  // aimed at the wrong table.
  const fromMock = vi.fn(() => ({ update: updateMock }))
  return { selectMock, isMock, eqMock, updateMock, fromMock }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: fromMock },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { profileAttributionRoutes } from "../profile-attribution.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  // Default: the conditional update matches one row (first touch wins).
  updateMock.mockReturnValue({ eq: eqMock })
  eqMock.mockReturnValue({ is: isMock })
  isMock.mockReturnValue({ select: selectMock })
  selectMock.mockResolvedValue({ data: [{ id: TEST_USER_ID }], error: null })

  app = await makeApp()
})

/**
 * The rate-limit plugin is registered here deliberately (mirroring
 * oauth-register.test.ts): a bare `Fastify()` silently ignores a route's
 * `config.rateLimit`, so the route's only abuse control would have zero
 * coverage while appearing configured.
 */
async function makeApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  await instance.register(rateLimit, {
    global: false,
    keyGenerator: (req) => (req.query as { userId?: string })?.userId ?? req.ip ?? "unknown",
  })

  // Bypass auth — set userId (and optionally a programmatic-token marker) from
  // the query, mirroring storage-status.test.ts.
  instance.addHook("preHandler", async (req) => {
    const query = req.query as Record<string, unknown> | undefined
    if (typeof query?.userId === "string") req.userId = query.userId
    if (query?.apiToken === "1") {
      ;(req as { apiToken?: unknown }).apiToken = { id: "tok-1" }
    }
    if (query?.oauth === "1") {
      ;(req as { appAuthorization?: unknown }).appAuthorization = { id: "app-1" }
    }
  })

  await instance.register(async (i) => {
    await profileAttributionRoutes(i)
  })
  await instance.ready()
  return instance
}

describe("POST /v1/profile/attribution", () => {
  it("stores a valid channel on first write", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/profile/attribution?userId=${TEST_USER_ID}`,
      payload: { channel: "producthunt" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ stored: true })
  })

  it("scopes the write to the authenticated user and only while NULL", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/profile/attribution?userId=${TEST_USER_ID}`,
      payload: { channel: "producthunt" },
    })
    // Tenant scope and the first-touch-wins guard are the two things that must
    // never regress: without the first a user could overwrite someone else's
    // attribution, without the second the "first" in first-touch is a lie.
    expect(eqMock).toHaveBeenCalledWith("id", TEST_USER_ID)
    expect(isMock).toHaveBeenCalledWith("first_touch_channel", null)
  })

  it("writes the expected columns to the profiles table", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/profile/attribution?userId=${TEST_USER_ID}`,
      payload: { channel: "producthunt" },
    })

    expect(fromMock).toHaveBeenCalledWith("profiles")

    // The SET payload itself was previously unasserted — `first_touch_at` was
    // named in no test at all, so dropping it would have gone unnoticed.
    const payload = updateMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.first_touch_channel).toBe("producthunt")
    expect(typeof payload.first_touch_at).toBe("string")
    expect(Number.isNaN(Date.parse(payload.first_touch_at as string))).toBe(false)
    // Nothing else may be written — this row also holds credits and role.
    expect(Object.keys(payload).sort()).toEqual(["first_touch_at", "first_touch_channel"])
  })

  it.each([
    ["a personal API token", "apiToken"],
    ["a third-party OAuth token", "oauth"],
  ])("rejects %s — the write is one-shot and browser-only", async (_label, flag) => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/profile/attribution?userId=${TEST_USER_ID}&${flag}=1`,
      payload: { channel: "producthunt" },
    })
    // Without this gate a programmatic caller could permanently consume the
    // user's single attribution slot with a value of its choosing.
    expect(res.statusCode).toBe(403)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("rate-limits after 5 requests in the window", async () => {
    const url = `/v1/profile/attribution?userId=${TEST_USER_ID}`
    for (let i = 0; i < 5; i++) {
      const ok = await app.inject({ method: "POST", url, payload: { channel: "producthunt" } })
      expect(ok.statusCode).toBe(200)
    }
    const blocked = await app.inject({ method: "POST", url, payload: { channel: "producthunt" } })
    expect(blocked.statusCode).toBe(429)
  })

  it("reports stored:false when a value already exists", async () => {
    selectMock.mockResolvedValue({ data: [], error: null })
    const res = await app.inject({
      method: "POST",
      url: `/v1/profile/attribution?userId=${TEST_USER_ID}`,
      payload: { channel: "hackernews" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ stored: false })
  })

  it.each([
    ["uppercase and spaces", "Product Hunt"],
    ["punctuation", "reddit!"],
    ["leading hyphen", "-reddit"],
    ["empty", ""],
    ["over 40 chars", "a".repeat(41)],
  ])("rejects a malformed channel (%s)", async (_label, channel) => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/profile/attribution?userId=${TEST_USER_ID}`,
      payload: { channel },
    })
    expect(res.statusCode).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/profile/attribution",
      payload: { channel: "reddit" },
    })
    expect(res.statusCode).toBe(401)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("surfaces a database failure as a 500", async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: "boom" } })
    const res = await app.inject({
      method: "POST",
      url: `/v1/profile/attribution?userId=${TEST_USER_ID}`,
      payload: { channel: "tiktok" },
    })
    expect(res.statusCode).toBe(500)
  })
})
