/**
 * The daily-send limit reader.
 *
 * Its stated safety property is that a MISCONFIGURED row must not open the
 * gate: a missing key, a string where a number belongs, a negative, or a value
 * past the ceiling all fall back to the compiled default rather than being read
 * as "no limit". That property was only exercised indirectly through a mocked
 * route test, which is to say: not at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockFrom = vi.fn()
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a) },
}))

import {
  ADMIN_MESSAGES_DAILY_LIMIT_DEFAULT,
  ADMIN_MESSAGES_DAILY_LIMIT_KEY,
  ADMIN_MESSAGES_DAILY_LIMIT_MAX,
  dailyWindowStart,
  getAdminMessagesDailyLimit,
  invalidateAdminMessageConfigCache,
} from "../admin-message-config.js"

/** One `app_settings` answer, through the builder chain the module uses. */
function answer(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => result)
  mockFrom.mockReturnValue(chain)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateAdminMessageConfigCache()
})

afterEach(() => {
  invalidateAdminMessageConfigCache()
})

describe("getAdminMessagesDailyLimit", () => {
  it("reads an operator-set integer", async () => {
    answer({ data: { value: 12 }, error: null })
    expect(await getAdminMessagesDailyLimit()).toBe(12)
  })

  it("reads 0 as a real value — the off switch must be reachable", async () => {
    // 0 is the documented "nobody may send". A falsy-check would silently turn
    // the off switch into the default and keep sending.
    answer({ data: { value: 0 }, error: null })
    expect(await getAdminMessagesDailyLimit()).toBe(0)
  })

  it.each([
    ["a missing row", { data: null, error: null }],
    ["a missing table", { data: null, error: { code: "42P01", message: "does not exist" } }],
    ["a string", { data: { value: "50" }, error: null }],
    ["a float", { data: { value: 12.5 }, error: null }],
    ["a negative", { data: { value: -1 }, error: null }],
    ["past the ceiling", { data: { value: ADMIN_MESSAGES_DAILY_LIMIT_MAX + 1 }, error: null }],
    ["null", { data: { value: null }, error: null }],
    ["an object", { data: { value: { n: 5 } }, error: null }],
  ])("falls back to the compiled default on %s — never to 'no limit'", async (_label, result) => {
    answer(result)
    expect(await getAdminMessagesDailyLimit()).toBe(ADMIN_MESSAGES_DAILY_LIMIT_DEFAULT)
  })

  it("asks for the one key it owns", async () => {
    const chain = answer({ data: { value: 5 }, error: null })
    await getAdminMessagesDailyLimit()
    expect(mockFrom).toHaveBeenCalledWith("app_settings")
    expect(chain.eq).toHaveBeenCalledWith("key", ADMIN_MESSAGES_DAILY_LIMIT_KEY)
  })

  it("caches, and the invalidator actually invalidates", async () => {
    answer({ data: { value: 7 }, error: null })
    expect(await getAdminMessagesDailyLimit()).toBe(7)
    answer({ data: { value: 99 }, error: null })
    expect(await getAdminMessagesDailyLimit()).toBe(7) // still cached
    invalidateAdminMessageConfigCache()
    expect(await getAdminMessagesDailyLimit()).toBe(99)
  })

  it("shares one in-flight read rather than stampeding", async () => {
    answer({ data: { value: 3 }, error: null })
    const [a, b, c] = await Promise.all([
      getAdminMessagesDailyLimit(),
      getAdminMessagesDailyLimit(),
      getAdminMessagesDailyLimit(),
    ])
    expect([a, b, c]).toEqual([3, 3, 3])
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })
})

describe("dailyWindowStart", () => {
  it("is midnight UTC of the given instant", () => {
    expect(dailyWindowStart(new Date("2026-09-03T14:37:12.345Z"))).toBe("2026-09-03T00:00:00.000Z")
  })

  it("does not roll back a day for a late-evening UTC time", () => {
    expect(dailyWindowStart(new Date("2026-09-03T23:59:59.999Z"))).toBe("2026-09-03T00:00:00.000Z")
  })

  it("uses UTC, not the machine's timezone", () => {
    // The count, the `sent_at` column and any later audit query must all mean
    // the same day. A local-time window would make them disagree twice a year.
    const instant = new Date("2026-09-03T00:30:00.000Z")
    expect(dailyWindowStart(instant)).toBe("2026-09-03T00:00:00.000Z")
    expect(dailyWindowStart(instant)).not.toBe("2026-09-02T00:00:00.000Z")
  })

  it("is already exactly midnight for a midnight input", () => {
    expect(dailyWindowStart(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:00:00.000Z")
  })
})
