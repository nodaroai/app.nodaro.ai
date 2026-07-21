import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

// The update chain is `.update(...).eq(...).is(...).select(...)`, where only the
// terminal `.select()` resolves. `vi.hoisted` keeps the refs initialized before
// the vi.mock factory first runs.
const { selectMock, isMock, eqMock, updateMock } = vi.hoisted(() => {
  const selectMock = vi.fn()
  const isMock = vi.fn()
  const eqMock = vi.fn()
  const updateMock = vi.fn()
  return { selectMock, isMock, eqMock, updateMock }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: () => ({ update: updateMock }) },
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

  app = Fastify({ logger: false })

  // Bypass auth — set userId from query, mirroring storage-status.test.ts.
  app.addHook("preHandler", async (req) => {
    const query = req.query as Record<string, unknown> | undefined
    const userId = query?.userId
    if (userId && typeof userId === "string") req.userId = userId
  })

  await app.register(async (instance) => {
    await profileAttributionRoutes(instance)
  })
  await app.ready()
})

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
