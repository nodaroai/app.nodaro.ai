import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A save on one process is seen by the next read on another.
 *
 * Two module instances of app-settings.ts stand for two processes (the API
 * that served an admin's save, a worker that runs the job): each has its own
 * in-memory cache, and both talk to one fake database. The fake moves the
 * version on every write, as migration 605's trigger does (that trigger is
 * proven against real Postgres by supabase/tests/app-settings-version.behavior.sql).
 *
 * The incident this pins (2026-11-06): the routed face mesh was saved at
 * 08:47:43 and a run that started at 08:47:56 still read it off, because the
 * worker's cache was up to 60 s old.
 */
const db = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  version: 0,
  /** false = the version table is not there (staging before the migration reaches main). */
  versionTable: true,
  /** true = the settings read itself fails. */
  rowsFail: false,
  rowReads: 0,
  versionReads: 0,
  /** When set, a settings read waits for it (to straddle a write). */
  gate: null as Promise<void> | null,
}))

vi.mock("@/lib/supabase.js", () => {
  const write = (row: { key: string; value: unknown }) => {
    db.rows.set(row.key, row.value)
    db.version += 1 // what the trigger does, per statement
    return Promise.resolve({ error: null })
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === "app_settings_version") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  db.versionReads += 1
                  return db.versionTable
                    ? { data: { version: db.version }, error: null }
                    : { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.app_settings_version'" } }
                },
              }),
            }),
          }
        }
        if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
        return {
          select: () => {
            const snapshot = async () => {
              db.rowReads += 1
              const rows = [...db.rows].map(([key, value]) => ({ key, value }))
              if (db.gate) await db.gate
              return db.rowsFail ? { data: null, error: { message: "connection reset" } } : { data: rows, error: null }
            }
            return { then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => snapshot().then(ok, ko) }
          },
          upsert: write,
        }
      },
    },
  }
})

type Settings = typeof import("@/lib/app-settings.js")
type Store = typeof import("@/lib/nodaro-motion-precise-style-route-store.js")

async function bootProcess(): Promise<{ settings: Settings; store: Store }> {
  vi.resetModules()
  const settings = await import("@/lib/app-settings.js")
  const store = await import("@/lib/nodaro-motion-precise-style-route-store.js")
  return { settings, store }
}

const KEY = "nodaro_motion_precise_style_route"
let api: { settings: Settings; store: Store }
let worker: { settings: Settings; store: Store }
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-06T08:47:00Z"))
  db.rows = new Map([[KEY, {}]])
  db.version = 1
  db.versionTable = true
  db.rowsFail = false
  db.gate = null
  db.rowReads = 0
  db.versionReads = 0
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  error = vi.spyOn(console, "error").mockImplementation(() => {})
  api = await bootProcess()
  worker = await bootProcess()
})

afterEach(() => {
  vi.useRealTimers()
  warn.mockRestore()
  error.mockRestore()
})

const faceMesh = async (p: { settings: Settings }) => (await p.settings.getAppSettings()).nodaro_motion_precise_style_route?.faceMesh === true

describe("getAppSettings across processes", () => {
  it("a save on the API is seen by the worker's next run (the 08:47:43 → 08:47:56 incident)", async () => {
    expect(await faceMesh(worker)).toBe(false) // warm: the worker read the old value

    vi.setSystemTime(new Date("2026-11-06T08:47:43Z"))
    await api.store.saveNodaroMotionPreciseStyleRoute({ faceMesh: true, faceMeshParts: "contours" }, "admin-1")
    expect(await faceMesh(api)).toBe(true) // the saving process: at once

    vi.setSystemTime(new Date("2026-11-06T08:47:56Z"))
    const settings = await worker.settings.getAppSettings()
    expect(settings.nodaro_motion_precise_style_route).toMatchObject({ faceMesh: true, faceMeshParts: "contours" })
  })

  it("is seen by another process as soon as its version memo lapses, well inside the old 60 s", async () => {
    await faceMesh(worker)
    await api.store.saveNodaroMotionPreciseStyleRoute({ faceMesh: true }, "admin-1")
    vi.advanceTimersByTime(1_000)
    expect(await faceMesh(worker)).toBe(true)
  })

  it("an unchanged version serves the cache: one small version read, no settings read", async () => {
    await worker.settings.getAppSettings()
    const rowReads = db.rowReads
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1_000)
      await worker.settings.getAppSettings()
    }
    expect(db.rowReads).toBe(rowReads)
    expect(db.versionReads).toBeLessThanOrEqual(1 + 5 + 1) // one per memo window at most
  })

  it("concurrent reads share one version read and one settings read (stampede protection)", async () => {
    await worker.settings.getAppSettings()
    await api.store.saveNodaroMotionPreciseStyleRoute({ faceMesh: true }, "admin-1")
    vi.advanceTimersByTime(1_000)
    const before = { rows: db.rowReads, versions: db.versionReads }
    const all = await Promise.all(Array.from({ length: 10 }, () => faceMesh(worker)))
    expect(all.every(Boolean)).toBe(true)
    expect(db.rowReads - before.rows).toBe(1)
    expect(db.versionReads - before.versions).toBe(1)
  })

  it("a read that straddled a write elsewhere is read again, never kept as current", async () => {
    let release: () => void = () => {}
    db.gate = new Promise((r) => { release = r })
    const straddling = worker.settings.getAppSettings() // took the version, then reads the OLD rows
    await vi.advanceTimersByTimeAsync(0)
    await api.store.saveNodaroMotionPreciseStyleRoute({ faceMesh: true }, "admin-1") // moves the version under it
    db.gate = null
    release()
    expect((await straddling).nodaro_motion_precise_style_route?.faceMesh).not.toBe(true) // what it read
    vi.advanceTimersByTime(1_000)
    expect(await faceMesh(worker)).toBe(true) // filed under the old version: read again
  })

  it("a save during a read on the SAME process is not lost to that read", async () => {
    let release: () => void = () => {}
    db.gate = new Promise((r) => { release = r })
    const straddling = api.settings.getAppSettings()
    await vi.advanceTimersByTimeAsync(0)
    await api.store.saveNodaroMotionPreciseStyleRoute({ faceMesh: true }, "admin-1")
    db.gate = null
    release()
    await straddling
    expect(await faceMesh(api)).toBe(true) // no wait at all on the saving process
  })
})

describe("getAppSettings fallbacks", () => {
  it("without the version table (before the migration), it falls back to the TTL, logged once", async () => {
    db.versionTable = false
    await faceMesh(worker)
    await api.store.saveNodaroMotionPreciseStyleRoute({ faceMesh: true }, "admin-1")
    vi.advanceTimersByTime(59_000)
    expect(await faceMesh(worker)).toBe(false) // the cache stands, as before the version existed
    vi.advanceTimersByTime(1_000)
    expect(await faceMesh(worker)).toBe(true) // the 60 s TTL safety net
    const versionWarnings = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("app_settings_version"))
    expect(versionWarnings).toHaveLength(1)
  })

  it("the TTL still refreshes even when the version never moves (a safety net)", async () => {
    await worker.settings.getAppSettings()
    const rowReads = db.rowReads
    db.rows.set(KEY, { faceMesh: true }) // a change the version did not see
    vi.advanceTimersByTime(60_000)
    expect(await faceMesh(worker)).toBe(true)
    expect(db.rowReads).toBe(rowReads + 1)
  })

  it("a failed settings read still returns the stand-in defaults, flagged, and is not cached", async () => {
    db.rowsFail = true
    const failed = await worker.settings.getAppSettings()
    expect(worker.settings.settingsReadFailed(failed)).toBe(true)
    expect(failed.nodaro_motion_precise_style_route).toBeNull()
    expect(failed.ai_provider).toBe("replicate")

    db.rowsFail = false
    db.rows.set(KEY, { faceMesh: true })
    const next = await worker.settings.getAppSettings() // tried again at once, version unchanged or not
    expect(worker.settings.settingsReadFailed(next)).toBe(false)
    expect(next.nodaro_motion_precise_style_route?.faceMesh).toBe(true)
  })

  it("a version that becomes readable later re-reads a cache taken without it", async () => {
    db.versionTable = false
    await faceMesh(worker)
    db.versionTable = true
    db.rows.set(KEY, { faceMesh: true })
    vi.advanceTimersByTime(1_000)
    expect(await faceMesh(worker)).toBe(true)
  })
})
