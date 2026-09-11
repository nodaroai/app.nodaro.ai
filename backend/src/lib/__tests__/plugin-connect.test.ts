import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Map-backed stand-in for the three ioredis calls the store makes. TTL is
// deliberately NOT modelled here — expiry is asserted through the record's own
// `expiresAt`, which is what a status change re-derives the Redis TTL from.
const store = new Map<string, string>()
vi.mock("../queue.js", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return "OK"
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  },
}))

import { redis } from "../queue.js"
import {
  PLUGIN_CONNECT_TTL_SECONDS,
  USER_CODE_MAX_ATTEMPTS,
  confirmUserCode,
  createSession,
  holdGrant,
  markDenied,
  normalizeUserCode,
  peekSession,
  pollSession,
} from "../plugin-connect.js"

const GRANT = { appId: "app-1", userId: "user-1", scopes: ["jobs:read"] }
const USER_CODE_RE = /^[BCDFGHJKMNPQRSTVWXYZ23456789]{4}-[BCDFGHJKMNPQRSTVWXYZ23456789]{4}$/

/** A session the consent screen has already come back for. */
async function heldSession() {
  const session = await createSession("figma")
  expect(await holdGrant(session.sessionId, GRANT)).toBe(true)
  return session
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("opening a session", () => {
  it("issues a public id, a separate poll key, and a readable user code", async () => {
    const session = await createSession("figma")
    expect(session.sessionId).toMatch(/^pcs_[0-9a-f]{48}$/)
    expect(session.pollKey).not.toBe(session.sessionId)
    expect(session.pollKey.length).toBeGreaterThanOrEqual(43)
    expect(session.userCode).toMatch(USER_CODE_RE)
    expect(session.expiresIn).toBe(PLUGIN_CONNECT_TTL_SECONDS)
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "pending" })
    await expect(peekSession(session.sessionId)).resolves.toEqual({ client: "figma", status: "pending", attempts: 0 })
  })

  it("stores neither secret in the clear, and sets the Redis TTL from the record's expiry", async () => {
    const session = await createSession("figma")
    const raw = store.get(`plugin-connect:${session.sessionId}`) ?? ""
    expect(raw).not.toContain(session.pollKey)
    expect(raw).not.toContain(session.userCode)
    expect(raw).not.toContain(normalizeUserCode(session.userCode))
    const set = vi.mocked(redis.set)
    expect(set.mock.calls[0]?.[2]).toBe("EX")
    expect(set.mock.calls[0]?.[3]).toBe(PLUGIN_CONNECT_TTL_SECONDS)
  })
})

describe("the poll key", () => {
  it("answers a wrong key exactly like an unknown session, without consuming anything", async () => {
    const session = await createSession("figma")
    await expect(pollSession(session.sessionId, "not-the-key")).resolves.toEqual({ status: "unknown" })
    await expect(pollSession("pcs_" + "0".repeat(48), session.pollKey)).resolves.toEqual({ status: "unknown" })
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "pending" })
  })
})

describe("holding the grant until the code is typed", () => {
  it("moves a pending session to awaiting_code, which the plugin still sees as pending", async () => {
    const session = await heldSession()
    await expect(peekSession(session.sessionId)).resolves.toMatchObject({ status: "awaiting_code" })
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "pending" })
  })

  it("refuses to hold twice, or to hold an unknown session", async () => {
    const session = await heldSession()
    await expect(holdGrant(session.sessionId, GRANT)).resolves.toBe(false)
    await expect(holdGrant("pcs_" + "0".repeat(48), GRANT)).resolves.toBe(false)
  })
})

describe("the user code", () => {
  it("releases the grant on the right code, however it was typed", async () => {
    const session = await heldSession()
    const sloppy = ` ${session.userCode.toLowerCase().replace("-", " ")} `
    await expect(confirmUserCode(session.sessionId, sloppy)).resolves.toBe("granted")
    await expect(peekSession(session.sessionId)).resolves.toMatchObject({ status: "granted" })
  })

  it("is only accepted while a grant is being held", async () => {
    const pending = await createSession("figma")
    await expect(confirmUserCode(pending.sessionId, pending.userCode)).resolves.toBe("unknown")
    await expect(confirmUserCode("pcs_" + "0".repeat(48), "ABCD-EFGH")).resolves.toBe("unknown")
    const session = await heldSession()
    await confirmUserCode(session.sessionId, session.userCode)
    await expect(confirmUserCode(session.sessionId, session.userCode)).resolves.toBe("unknown")
  })

  it("counts wrong codes and settles the session as denied on the last one", async () => {
    const session = await heldSession()
    for (let i = 1; i < USER_CODE_MAX_ATTEMPTS; i++) {
      await expect(confirmUserCode(session.sessionId, "ZZZZ-ZZZZ")).resolves.toBe("wrong")
      await expect(peekSession(session.sessionId)).resolves.toMatchObject({ status: "awaiting_code", attempts: i })
    }
    await expect(confirmUserCode(session.sessionId, "ZZZZ-ZZZZ")).resolves.toBe("denied")
    // The held grant is gone with the denial — the right code is now too late.
    await expect(confirmUserCode(session.sessionId, session.userCode)).resolves.toBe("unknown")
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "denied" })
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "unknown" })
  })
})

describe("handing a settled session over", () => {
  it("returns a granted session once, then it is gone", async () => {
    const session = await heldSession()
    await confirmUserCode(session.sessionId, session.userCode)
    const first = await pollSession(session.sessionId, session.pollKey)
    expect(first).toMatchObject({ status: "granted", grant: GRANT })
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "unknown" })
    expect(store.size).toBe(0)
  })

  it("gives exactly one of two overlapping polls the grant", async () => {
    const session = await heldSession()
    await confirmUserCode(session.sessionId, session.userCode)
    const [a, b] = await Promise.all([
      pollSession(session.sessionId, session.pollKey),
      pollSession(session.sessionId, session.pollKey),
    ])
    const granted = [a, b].filter((r) => r.status === "granted")
    const unknown = [a, b].filter((r) => r.status === "unknown")
    expect(granted).toHaveLength(1)
    expect(unknown).toHaveLength(1)
  })

  it("can be put back if minting fails, so the plugin's next poll retries", async () => {
    const session = await heldSession()
    await confirmUserCode(session.sessionId, session.userCode)
    const first = await pollSession(session.sessionId, session.pollKey)
    expect(first.status).toBe("granted")
    if (first.status !== "granted") return
    await first.restore()
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toMatchObject({ status: "granted", grant: GRANT })
  })

  it("returns a denied session once, then it is gone", async () => {
    const session = await createSession("figma")
    await expect(markDenied(session.sessionId)).resolves.toBe(true)
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "denied" })
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "unknown" })
  })
})

describe("declining", () => {
  it("works while pending or while a grant is held, but not once settled", async () => {
    const pending = await createSession("figma")
    await expect(markDenied(pending.sessionId)).resolves.toBe(true)
    await expect(markDenied(pending.sessionId)).resolves.toBe(false)

    const held = await heldSession()
    await expect(markDenied(held.sessionId)).resolves.toBe(true)
    await expect(confirmUserCode(held.sessionId, held.userCode)).resolves.toBe("unknown")

    const granted = await heldSession()
    await confirmUserCode(granted.sessionId, granted.userCode)
    await expect(markDenied(granted.sessionId)).resolves.toBe(false)
    await expect(markDenied("pcs_" + "0".repeat(48))).resolves.toBe(false)
  })
})

describe("expiry", () => {
  it("keeps the original expiry across a status change rather than restarting the clock", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"))
    const session = await createSession("figma")
    vi.setSystemTime(new Date("2026-09-10T12:04:00Z"))
    await holdGrant(session.sessionId, GRANT)
    const set = vi.mocked(redis.set)
    expect(set.mock.calls.at(-1)?.[3]).toBe(PLUGIN_CONNECT_TTL_SECONDS - 4 * 60)
  })

  it("treats an expired record as unknown and removes it", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"))
    const session = await heldSession()
    await confirmUserCode(session.sessionId, session.userCode)
    vi.setSystemTime(new Date("2026-09-10T12:10:01Z"))
    await expect(pollSession(session.sessionId, session.pollKey)).resolves.toEqual({ status: "unknown" })
    expect(store.size).toBe(0)
  })

  it("treats a record it cannot parse as unknown and removes it", async () => {
    store.set("plugin-connect:pcs_" + "a".repeat(48), "{not json")
    await expect(pollSession("pcs_" + "a".repeat(48), "whatever")).resolves.toEqual({ status: "unknown" })
    expect(store.size).toBe(0)
  })
})
