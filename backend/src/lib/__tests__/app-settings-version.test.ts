import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The shared app_settings version read (lib/app-settings-version.ts): the one
 * place every in-memory settings cache asks whether the settings moved since
 * it read them. A database the version cannot be read from (no table yet,
 * an error, a hang, an odd answer) must leave the caches exactly as they
 * were before the version existed: on their TTL.
 */
const db = vi.hoisted(() => ({
  answer: (): Promise<unknown> => Promise.resolve({ data: { version: 1 }, error: null }),
  reads: 0,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table !== "app_settings_version") throw new Error(`unexpected table ${table}`)
            db.reads += 1
            return db.answer()
          },
        }),
      }),
    }),
  },
}))

import { APP_SETTINGS_VERSION_MEMO_MS, APP_SETTINGS_VERSION_READ_TIMEOUT_MS } from "@/lib/app-settings-version.js"

type VersionModule = typeof import("@/lib/app-settings-version.js")
let appSettingsVersion: VersionModule["appSettingsVersion"]
let appSettingsChangedSince: VersionModule["appSettingsChangedSince"]
let forgetAppSettingsVersion: VersionModule["forgetAppSettingsVersion"]
let warn: ReturnType<typeof vi.spyOn>

// A fresh module per test: its memo and its "logged once" flag are process state.
beforeEach(async () => {
  vi.resetModules()
  ;({ appSettingsVersion, appSettingsChangedSince, forgetAppSettingsVersion } = await import("@/lib/app-settings-version.js"))
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-06T08:47:43Z"))
  db.reads = 0
  db.answer = () => Promise.resolve({ data: { version: 1 }, error: null })
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  warn.mockRestore()
})

describe("appSettingsVersion", () => {
  it("reads the version row", async () => {
    db.answer = () => Promise.resolve({ data: { version: 42 }, error: null })
    expect(await appSettingsVersion()).toBe(42)
    expect(db.reads).toBe(1)
  })

  it("remembers it for the memo window, then reads again", async () => {
    expect(await appSettingsVersion()).toBe(1)
    db.answer = () => Promise.resolve({ data: { version: 2 }, error: null })
    vi.advanceTimersByTime(APP_SETTINGS_VERSION_MEMO_MS - 1)
    expect(await appSettingsVersion()).toBe(1)
    expect(db.reads).toBe(1)
    vi.advanceTimersByTime(1)
    expect(await appSettingsVersion()).toBe(2)
    expect(db.reads).toBe(2)
  })

  it("shares one read between concurrent callers", async () => {
    const all = await Promise.all([appSettingsVersion(), appSettingsVersion(), appSettingsVersion()])
    expect(all).toEqual([1, 1, 1])
    expect(db.reads).toBe(1)
  })

  it("forgetAppSettingsVersion drops the memo: the next call reads at once", async () => {
    await appSettingsVersion()
    db.answer = () => Promise.resolve({ data: { version: 7 }, error: null })
    forgetAppSettingsVersion()
    expect(await appSettingsVersion()).toBe(7)
  })

  it("a read overtaken by forgetAppSettingsVersion is used once, never remembered", async () => {
    let release: (v: unknown) => void = () => {}
    db.answer = () => new Promise((r) => { release = r })
    const pending = appSettingsVersion()
    forgetAppSettingsVersion()
    release({ data: { version: 3 }, error: null })
    expect(await pending).toBe(3)
    db.answer = () => Promise.resolve({ data: { version: 4 }, error: null })
    expect(await appSettingsVersion()).toBe(4)
  })

  it.each([
    ["a database error (no table yet)", () => Promise.resolve({ data: null, error: { code: "PGRST205", message: "no table" } })],
    ["no row", () => Promise.resolve({ data: null, error: null })],
    ["a value that is not a number", () => Promise.resolve({ data: { version: "9" }, error: null })],
    ["an answer of the wrong shape", () => Promise.resolve([{ key: "ai_provider", value: "kie" }])],
    ["a rejected read", () => Promise.reject(new Error("socket hang up"))],
    ["a read that throws", () => { throw new TypeError("x.maybeSingle is not a function") }],
  ])("%s reads as unreadable (null), logged once", async (_label, answer) => {
    db.answer = answer as () => Promise<unknown>
    expect(await appSettingsVersion()).toBeNull()
    vi.advanceTimersByTime(APP_SETTINGS_VERSION_MEMO_MS)
    expect(await appSettingsVersion()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("a read slower than the timeout reads as unreadable, without waiting for it", async () => {
    db.answer = () => new Promise(() => {})
    const pending = appSettingsVersion()
    vi.advanceTimersByTime(APP_SETTINGS_VERSION_READ_TIMEOUT_MS)
    expect(await pending).toBeNull()
  })

  it("logs again after the version became readable and then failed again", async () => {
    db.answer = () => Promise.resolve({ data: null, error: { message: "down" } })
    await appSettingsVersion()
    db.answer = () => Promise.resolve({ data: { version: 5 }, error: null })
    vi.advanceTimersByTime(APP_SETTINGS_VERSION_MEMO_MS)
    expect(await appSettingsVersion()).toBe(5)
    db.answer = () => Promise.resolve({ data: null, error: { message: "down again" } })
    vi.advanceTimersByTime(APP_SETTINGS_VERSION_MEMO_MS)
    await appSettingsVersion()
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe("appSettingsChangedSince", () => {
  it("false while the version is the one the cache was read at", async () => {
    expect(await appSettingsChangedSince(1)).toBe(false)
  })

  it("true once it moved", async () => {
    db.answer = () => Promise.resolve({ data: { version: 2 }, error: null })
    expect(await appSettingsChangedSince(1)).toBe(true)
  })

  it("true for a cache read while the version was unreadable, once it can be read", async () => {
    expect(await appSettingsChangedSince(null)).toBe(true)
  })

  it("false while the version cannot be read: the cache's own TTL decides, as before", async () => {
    db.answer = () => Promise.resolve({ data: null, error: { message: "down" } })
    expect(await appSettingsChangedSince(1)).toBe(false)
    expect(await appSettingsChangedSince(null)).toBe(false)
  })
})
