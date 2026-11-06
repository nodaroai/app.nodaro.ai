import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The config readers kept beside getAppSettings (each its own app_settings
 * cache) see a save made through another process within the version memo,
 * not their 60 s TTL; while the version cannot be read they keep their TTL,
 * as before. The census that every such cache checks the version is
 * lib/__tests__/app-settings-caches-guard.test.ts; this pins that the check
 * works in each.
 */
const db = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  version: 1,
  versionTable: true,
}))

vi.mock("@/lib/supabase.js", () => {
  const rowsFor = (keys: string[]) => keys.filter((k) => db.rows.has(k)).map((key) => ({ key, value: db.rows.get(key) }))
  const thenable = (result: () => unknown) => ({ then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve().then(result).then(ok, ko) })
  return {
    supabase: {
      from: (table: string) => ({
        select: () => ({
          in: (_col: string, keys: string[]) => thenable(() => ({ data: rowsFor(keys), error: null })),
          eq: (_col: string, value: unknown) => ({
            maybeSingle: async () => {
              if (table === "app_settings_version") {
                return db.versionTable ? { data: { version: db.version }, error: null } : { data: null, error: { code: "PGRST205", message: "no table" } }
              }
              const [row] = rowsFor([String(value)])
              return { data: row ?? null, error: null }
            },
          }),
        }),
      }),
    },
  }
})

interface Case {
  name: string
  key: string
  before: unknown
  after: unknown
  read: () => Promise<unknown>
}

const cases: Array<Omit<Case, "read"> & { load: () => Promise<() => Promise<unknown>> }> = [
  {
    name: "free video limits",
    key: "free_video_max_seconds",
    before: 4,
    after: 10,
    load: async () => { const m = await import("../free-video-config.js"); return async () => (await m.getFreeVideoLimits()).maxSeconds },
  },
  {
    name: "signup grant",
    key: "signup_grant_cookie_rule",
    before: false,
    after: true,
    load: async () => { const m = await import("../signup-grant-config.js"); return async () => (await m.getSignupGrantConfig()).cookieRule },
  },
  {
    name: "welcome offer",
    key: "welcome_offer_enabled",
    before: false,
    after: true,
    load: async () => { const m = await import("../welcome-offer-config.js"); return async () => (await m.getWelcomeOfferConfig()).enabled },
  },
  {
    name: "consent",
    key: "consent_enabled",
    before: false,
    after: true,
    load: async () => { const m = await import("../consent-config.js"); return async () => (await m.getConsentConfig()).enabled },
  },
  {
    name: "notifications",
    key: "notify_digest_hour",
    before: 8,
    after: 17,
    load: async () => { const m = await import("../../notifications/notify-config.js"); return async () => (await m.getNotifyConfig()).digestHour },
  },
  {
    name: "admin messages daily limit",
    key: "admin_messages_daily_limit",
    before: 50,
    after: 7,
    load: async () => { const m = await import("../admin-message-config.js"); return () => m.getAdminMessagesDailyLimit() },
  },
]

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-06T08:47:00Z"))
  vi.resetModules()
  db.version = 1
  db.versionTable = true
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  warn.mockRestore()
})

/** Another process saved: the row changed and the database moved the version (migration 605's trigger). */
function saveElsewhere(key: string, value: unknown) {
  db.rows.set(key, value)
  db.version += 1
}

describe.each(cases)("$name", ({ key, before, after, load }) => {
  beforeEach(() => {
    db.rows = new Map([[key, before]])
  })

  it("sees a save made through another process within about a second", async () => {
    const read = await load()
    expect(await read()).toBe(before)
    saveElsewhere(key, after)
    vi.advanceTimersByTime(1_000)
    expect(await read()).toBe(after)
  })

  it("keeps serving its copy while the version has not moved", async () => {
    const read = await load()
    expect(await read()).toBe(before)
    db.rows.set(key, after) // a change the version did not see
    vi.advanceTimersByTime(30_000)
    expect(await read()).toBe(before)
    vi.advanceTimersByTime(30_000)
    expect(await read()).toBe(after) // the TTL still bounds it
  })

  it("without the version table, falls back to its TTL as before", async () => {
    db.versionTable = false
    const read = await load()
    expect(await read()).toBe(before)
    saveElsewhere(key, after)
    vi.advanceTimersByTime(59_000)
    expect(await read()).toBe(before)
    vi.advanceTimersByTime(1_000)
    expect(await read()).toBe(after)
  })
})
