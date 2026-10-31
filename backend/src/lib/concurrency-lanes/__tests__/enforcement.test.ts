// The `lanes_enforced` switch: its per-environment key, the 30-s mirror into
// the gate's Redis flag (and the provider ceilings), the off-transition wake,
// and the preconditions the Admin switch lists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate } from "../gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "./fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "./fake-lane-db.js"

const refs = vi.hoisted(() => ({ gate: null as unknown, db: null as unknown as { client: { from(t: string): unknown } }, credits: true, available: true }))

vi.mock("../../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.js")>()),
  hasCredits: () => refs.credits,
}))
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))
// The release lock (a constant in code) is read through this getter, so the
// switch's own behaviour stays testable; "while turning limits on is not
// available" below runs with the shipped value.
vi.mock("../enforcement-available.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../enforcement-available.js")>()
  return { get LANES_ENFORCEMENT_AVAILABLE() { return refs.available ?? real.LANES_ENFORCEMENT_AVAILABLE } }
})
vi.mock("../../supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))

const { config } = await import("../../config.js")
const enforcement = await import("../enforcement.js")
const {
  ENFORCEMENT_MIRROR_INTERVAL_MS, LANES_ENFORCED_KEY, enforcementPreconditions, lastMirroredEnforced, mirrorEnforcementOnce,
  LanesNotAvailableError, registerMeasureDaysReader, registerOffTransitionWaker, resetEnforcementHooksForTests, setLanesEnforced,
  startEnforcementMirror, unmetPreconditions,
} = enforcement
const { invalidateLaneConfigCache } = await import("../../../ee/concurrency-lanes/plan-sizes.js")
const { resetLastMirroredEnforcedForTests } = await import("../sizes.js")
const registry = await import("../registry.js")

let db: FakeLaneDb
let gate: ConcurrencyGate
const ADMIN = "00000000-0000-4000-8000-0000000000ad"

function setRow(value: unknown): void {
  db.tables.set("app_settings", [{ key: LANES_ENFORCED_KEY, value, updated_at: "2026-10-30T09:00:00.000Z" }])
}
const storedMap = () => db.rows("app_settings").find((r) => r.key === LANES_ENFORCED_KEY)?.value

beforeEach(() => {
  db = makeFakeLaneDb()
  refs.db = db
  refs.credits = true
  refs.available = true
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store), now: () => 1_000 })
  refs.gate = gate
  db.rows("profiles").push({ id: ADMIN })
  vi.stubEnv("RUNTIME_ENV", "production")
  config.LANES_ENFORCED = false
  invalidateLaneConfigCache()
  resetEnforcementHooksForTests()
  resetLastMirroredEnforcedForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
  config.LANES_ENFORCED = false
})

describe("the mirror", () => {
  it("with enforcement off changes nothing: no row and LANES_ENFORCED unset → the flag is off", async () => {
    await gate.setEnforced(false)
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(false)
  })

  it("the mirror copies the setting into Redis and the env fallback applies without a row", async () => {
    // No row: LANES_ENFORCED decides.
    config.LANES_ENFORCED = true
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(true)

    // A row without this environment's key: still the env.
    setRow({ staging: false })
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(true)

    // This environment's boolean wins over the env.
    setRow({ staging: true, production: false })
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(false)

    config.LANES_ENFORCED = false
    setRow({ production: true })
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(true)

    // A value that is not a boolean is no setting: the env.
    setRow({ production: "yes" })
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(false)
  })

  it("a failed read of the setting leaves the flag as it is and wakes nobody", async () => {
    const waker = vi.fn(async () => 5)
    registerOffTransitionWaker(waker)
    await gate.setEnforced(true)
    db.failing.add("app_settings")
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(true)
    expect(waker).not.toHaveBeenCalled()
  })

  it("an off edge seen by the mirror wakes every waiter", async () => {
    // On here, then a DB edit (or another process's PUT) turns it off.
    setRow({ production: true })
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(true)

    const flagAtWake: boolean[] = []
    registerOffTransitionWaker(async () => {
      flagAtWake.push(await gate.isEnforced())
      return 3
    })
    setRow({ production: false })
    await mirrorEnforcementOnce()
    expect(flagAtWake).toEqual([false]) // the flag was off before anyone was woken
    // No edge on the next pass: nobody is woken again.
    await mirrorEnforcementOnce()
    expect(flagAtWake).toEqual([false])
  })

  it("an off edge after a boot is seen too (the previous state is Redis's, not the process's)", async () => {
    await gate.setEnforced(true) // set by an earlier process
    const waker = vi.fn(async () => 1)
    registerOffTransitionWaker(waker)
    await mirrorEnforcementOnce() // no row, env unset → off
    expect(waker).toHaveBeenCalledTimes(1)
  })

  it("two passes that both see the off apply it, and only one of them wakes", async () => {
    setRow({ production: true })
    await mirrorEnforcementOnce()
    const waker = vi.fn(async () => 2)
    registerOffTransitionWaker(waker)
    setRow({ production: false })
    // Two replicas' mirrors on the same Redis, at the same moment.
    await Promise.all([mirrorEnforcementOnce(), mirrorEnforcementOnce()])
    expect(await gate.isEnforced()).toBe(false)
    expect(waker).toHaveBeenCalledTimes(1)
  })

  it("a pass that read the setting before an admin's off never turns it back on", async () => {
    setRow({ production: true })
    await mirrorEnforcementOnce()
    const waker = vi.fn(async () => 4)
    registerOffTransitionWaker(waker)

    // The pass reads `on` (the row as it was), then stalls before writing Redis.
    const stale = { value: { production: true }, updated_at: "2026-10-30T09:00:00.000Z" }
    let resume!: () => void
    const held = new Promise<void>((r) => { resume = r })
    const real = db
    let first = true
    refs.db = {
      client: {
        from: (t: string) => {
          if (t !== "app_settings" || !first) return real.client.from(t)
          first = false
          const q = { select: () => q, eq: () => q, maybeSingle: async () => { await held; return { data: stale, error: null } } }
          return q
        },
      },
    }
    const pass = mirrorEnforcementOnce()
    // Meanwhile the admin turns lanes off: written, applied, everyone woken.
    expect(await setLanesEnforced(false, ADMIN)).toEqual({ woke: 4, mirrored: true })
    resume()
    await pass
    expect(await gate.isEnforced()).toBe(false)
    expect(lastMirroredEnforced()).toBe(false)
    expect(waker).toHaveBeenCalledTimes(1)
  })

  it("the mirror copies provider ceilings into the gate", async () => {
    const spy = vi.spyOn(gate, "setProviderCeilings")
    db.rows("lane_provider_ceilings").push({ provider: "kie", ceiling: 40 }, { provider: "replicate", ceiling: 8 })
    await mirrorEnforcementOnce()
    expect(spy).toHaveBeenLastCalledWith({ kie: 40, replicate: 8 })
  })

  it("a failed ceiling read leaves the gate's ceilings untouched, also on the next pass within the failed read's keep", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.rows("lane_provider_ceilings").push({ provider: "kie", ceiling: 40 })
    const spy = vi.spyOn(gate, "setProviderCeilings")
    await mirrorEnforcementOnce()
    expect(spy).toHaveBeenLastCalledWith({ kie: 40 })

    // A process with nothing good cached (a boot, or right after an admin edit) whose read fails.
    invalidateLaneConfigCache()
    db.failing.add("lane_provider_ceilings")
    spy.mockClear()
    await mirrorEnforcementOnce()
    await mirrorEnforcementOnce() // the failed entry is cached: still not a read
    expect(spy).not.toHaveBeenCalled()

    // Readable again: copied on the next pass after the keep.
    db.failing.delete("lane_provider_ceilings")
    invalidateLaneConfigCache()
    await mirrorEnforcementOnce()
    expect(spy).toHaveBeenLastCalledWith({ kie: 40 })
  })

  it("an empty ceiling table clears the gate's ceilings", async () => {
    db.rows("lane_provider_ceilings").push({ provider: "kie", ceiling: 40 })
    const spy = vi.spyOn(gate, "setProviderCeilings")
    await mirrorEnforcementOnce()
    db.tables.set("lane_provider_ceilings", [])
    invalidateLaneConfigCache()
    await mirrorEnforcementOnce()
    expect(spy).toHaveBeenLastCalledWith({})
  })

  it("keeps the value it copied in-process: false until the first copy, then the flag it set", async () => {
    expect(lastMirroredEnforced()).toBe(false)
    setRow({ production: true })
    await mirrorEnforcementOnce()
    expect(lastMirroredEnforced()).toBe(true)

    // A failed read of the setting copies nothing: the copy stays.
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.failing.add("app_settings")
    await mirrorEnforcementOnce()
    expect(lastMirroredEnforced()).toBe(true)
    db.failing.delete("app_settings")

    // A Redis write that fails is not a copy either.
    setRow({ production: false })
    const set = vi.spyOn(gate, "setEnforced").mockRejectedValueOnce(new Error("redis down"))
    await mirrorEnforcementOnce()
    expect(lastMirroredEnforced()).toBe(true)
    set.mockRestore()

    await mirrorEnforcementOnce()
    expect(lastMirroredEnforced()).toBe(false)

    // The admin switch updates it at once in the process that handled it.
    await setLanesEnforced(true, ADMIN)
    expect(lastMirroredEnforced()).toBe(true)
  })

  it("Community / Business: no ceilings, and the env switch", async () => {
    refs.credits = false
    config.LANES_ENFORCED = true
    const spy = vi.spyOn(gate, "setProviderCeilings")
    await mirrorEnforcementOnce()
    expect(spy).toHaveBeenLastCalledWith({})
    expect(await gate.isEnforced()).toBe(true)
  })

  it("a Redis error skips the step; the ceilings are still tried and the pass never throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(gate, "setEnforced").mockRejectedValue(new Error("redis down"))
    const ceilings = vi.spyOn(gate, "setProviderCeilings")
    await expect(mirrorEnforcementOnce()).resolves.toBeUndefined()
    expect(ceilings).toHaveBeenCalledTimes(1)
  })

  it("runs once at start, then every 30 s after the previous pass, and stops", async () => {
    vi.useFakeTimers()
    const pass = vi.spyOn(gate, "setProviderCeilings")
    const stop = startEnforcementMirror()
    await vi.advanceTimersByTimeAsync(0)
    expect(pass).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIRROR_INTERVAL_MS)
    expect(pass).toHaveBeenCalledTimes(2)
    // A failing pass does not stop the mirror.
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    pass.mockRejectedValueOnce(new Error("redis down"))
    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIRROR_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIRROR_INTERVAL_MS)
    expect(pass).toHaveBeenCalledTimes(4)
    stop()
    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIRROR_INTERVAL_MS * 3)
    expect(pass).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("setLanesEnforced", () => {
  it("the enforced setting is keyed by runtime environment", async () => {
    setRow({ production: false })
    vi.stubEnv("RUNTIME_ENV", "staging")
    await setLanesEnforced(true, ADMIN)
    expect(storedMap()).toEqual({ production: false, staging: true })
    expect(await gate.isEnforced()).toBe(true) // staging's own Redis

    // Production's mirror (its own Redis) reads its own key: off.
    const prodStore = makeFakeLaneStore()
    const prodGate = new ConcurrencyGate({ client: () => makeFakeLaneClient(prodStore), now: () => 1_000 })
    refs.gate = prodGate
    vi.stubEnv("RUNTIME_ENV", "production")
    await mirrorEnforcementOnce()
    expect(await prodGate.isEnforced()).toBe(false)
  })

  it("creates the row when there is none, and records who changed it", async () => {
    await setLanesEnforced(true, ADMIN)
    expect(db.rows("app_settings")).toEqual([expect.objectContaining({ key: LANES_ENFORCED_KEY, value: { production: true }, updated_by: ADMIN })])
  })

  it("never overwrites the other environment's key written meanwhile", async () => {
    setRow({ staging: false })
    let raced = false
    db.beforeUpdate = () => {
      if (raced) return
      raced = true
      // Staging writes between this read and this update.
      const row = db.rows("app_settings")[0]!
      row.value = { staging: true }
      row.updated_at = "2026-10-30T09:00:01.000Z"
    }
    await setLanesEnforced(true, ADMIN)
    expect(storedMap()).toEqual({ staging: true, production: true })
  })

  it("turning off wakes every waiter after the flag is off", async () => {
    await setLanesEnforced(true, ADMIN)
    const flagAtWake: boolean[] = []
    registerOffTransitionWaker(async () => {
      flagAtWake.push(await gate.isEnforced())
      return 7
    })
    expect(await setLanesEnforced(false, ADMIN)).toEqual({ woke: 7, mirrored: true })
    expect(flagAtWake).toEqual([false])
    expect(storedMap()).toEqual({ production: false })
  })

  it("a repeated admin off wakes again", async () => {
    // An admin's explicit off always wakes (waking is idempotent); only the mirror is edge-only.
    await setLanesEnforced(true, ADMIN)
    const waker = vi.fn(async () => 3)
    registerOffTransitionWaker(waker)
    expect(await setLanesEnforced(false, ADMIN)).toEqual({ woke: 3, mirrored: true })
    expect(await setLanesEnforced(false, ADMIN)).toEqual({ woke: 3, mirrored: true })
    expect(waker).toHaveBeenCalledTimes(2)
    // The mirror, seeing the same off, wakes nobody.
    await mirrorEnforcementOnce()
    expect(waker).toHaveBeenCalledTimes(2)
  })

  it("each write's version is newer than the row's, even when this clock is behind it", async () => {
    // The other environment, on a clock ahead of ours, wrote the row last.
    db.tables.set("app_settings", [{ key: LANES_ENFORCED_KEY, value: { production: true }, updated_at: "2099-01-01T00:00:00.000Z" }])
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(true)
    await setLanesEnforced(false, ADMIN)
    const row = db.rows("app_settings")[0]!
    expect(Date.parse(String(row.updated_at))).toBeGreaterThan(Date.parse("2099-01-01T00:00:00.000Z"))
    expect(await gate.isEnforced()).toBe(false)
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(false)
  })

  it("with no waker registered (nothing parks yet) turning off wakes nobody", async () => {
    await setLanesEnforced(true, ADMIN)
    expect(await setLanesEnforced(false, ADMIN)).toEqual({ woke: 0, mirrored: true })
  })

  it("a setting saved while Redis is unreachable says so; the mirror applies it later", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(gate, "setEnforced").mockRejectedValueOnce(new Error("redis down"))
    expect(await setLanesEnforced(true, ADMIN)).toEqual({ woke: 0, mirrored: false })
    expect(storedMap()).toEqual({ production: true })
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(true)
  })

  it("throws when the setting cannot be saved", async () => {
    db.failing.add("app_settings")
    await expect(setLanesEnforced(true, ADMIN)).rejects.toThrow(/lanes_enforced/)
  })
})

describe("enforcementPreconditions", () => {
  it("columns: present when every lane table and column answers, absent when one is missing", async () => {
    expect((await enforcementPreconditions()).columnsPresent).toBe(true)
    db.missingColumns.add("jobs.lane_wait_ms")
    expect((await enforcementPreconditions()).columnsPresent).toBe(false)
    db.missingColumns.clear()
    db.missingTables.add("lane_requeue_payloads")
    expect((await enforcementPreconditions()).columnsPresent).toBe(false)
  })

  it("the live ceiling is provisional, and days of data come from the registered reader (none until then)", async () => {
    const p = await enforcementPreconditions()
    expect(p.liveCeilingMeasured).toBe(false)
    expect(p.measureDays).toBe(0)
    registerMeasureDaysReader(async () => 9)
    expect((await enforcementPreconditions()).measureDays).toBe(9)
    registerMeasureDaysReader(async () => { throw new Error("no history") })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    expect((await enforcementPreconditions()).measureDays).toBe(0)
  })

  it("the plugin item is unmet until the loader recorded its types, and while one is undeclared", async () => {
    // Before the loader ran: nothing recorded, so "0 undeclared" proves nothing.
    let p = await enforcementPreconditions()
    expect(p.pluginTypesKnown).toBe(false)
    expect(p.undeclaredPluginTypes).toEqual([])
    expect(unmetPreconditions(p)).toContain("plugins")

    registry.notePluginJobTypes(["enforcement-test-type"])
    p = await enforcementPreconditions()
    expect(p.pluginTypesKnown).toBe(true)
    expect(p.undeclaredPluginTypes).toContain("enforcement-test-type")
    expect(unmetPreconditions(p)).toContain("plugins")

    registry.registerPluginJobLanes({ "enforcement-test-type": { kind: "leaf", lane: "provider" } })
    p = await enforcementPreconditions()
    expect(p.undeclaredPluginTypes).not.toContain("enforcement-test-type")
    expect(unmetPreconditions({ ...p, undeclaredPluginTypes: [] })).not.toContain("plugins")
  })

  it("a failed plugin load in this process leaves the plugin item unmet, and the preconditions say so", async () => {
    const met = { available: true, columnsPresent: true, pluginTypesKnown: true, undeclaredPluginTypes: [], liveCeilingMeasured: true, measureDays: 7 }
    expect(unmetPreconditions({ ...met, pluginLoadFailed: false })).toEqual([])
    expect(unmetPreconditions({ ...met, pluginLoadFailed: true })).toEqual(["plugins"])

    expect((await enforcementPreconditions()).pluginLoadFailed).toBe(false)
    registry.notePluginLoadFailed()
    expect((await enforcementPreconditions()).pluginLoadFailed).toBe(true)
  })

  it("unmetPreconditions lists each unmet item, and none when all are met", () => {
    const met = { available: true, columnsPresent: true, pluginTypesKnown: true, undeclaredPluginTypes: [], liveCeilingMeasured: true, measureDays: 7 }
    expect(unmetPreconditions(met)).toEqual([])
    expect(unmetPreconditions({ available: false, columnsPresent: false, pluginTypesKnown: true, undeclaredPluginTypes: ["x"], liveCeilingMeasured: false, measureDays: 6 }))
      .toEqual(["available", "columns", "plugins", "liveCeiling", "measureDays"])
  })
})

describe("while turning limits on is not available (this release)", () => {
  beforeEach(() => {
    refs.available = false
  })

  it("ships unavailable", async () => {
    const { LANES_ENFORCEMENT_AVAILABLE } = await vi.importActual<typeof import("../enforcement-available.js")>("../enforcement-available.js")
    expect(LANES_ENFORCEMENT_AVAILABLE).toBe(false)
    expect(enforcement.lanesEnforcementAvailable()).toBe(false)
  })

  it("setLanesEnforced(true) refuses before writing anything; off is still allowed", async () => {
    await expect(setLanesEnforced(true, ADMIN)).rejects.toBeInstanceOf(LanesNotAvailableError)
    await expect(setLanesEnforced(true, ADMIN)).rejects.toMatchObject({ code: "not_available_yet" })
    expect(db.rows("app_settings")).toEqual([])
    expect(await gate.isEnforced()).toBe(false)
    expect(await setLanesEnforced(false, ADMIN)).toEqual({ woke: 0, mirrored: true })
    expect(storedMap()).toEqual({ production: false })
  })

  it("LANES_ENFORCED cannot turn limits on: the mirror copies off, and an on the gate held at that version is replaced and wakes the waiters", async () => {
    config.LANES_ENFORCED = true
    // A self-host with the seeded row and the env var on: an earlier build put the gate on at the row's version.
    setRow({})
    await gate.setEnforced(true, Date.parse("2026-10-30T09:00:00.000Z"))
    const waker = vi.fn(async () => 2)
    registerOffTransitionWaker(waker)
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(false)
    expect(waker).toHaveBeenCalledTimes(1)
    expect(lastMirroredEnforced()).toBe(false)
    // No row at all: still off.
    db.tables.set("app_settings", [])
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(false)
  })

  it("the mirror writes off even when the setting row says on", async () => {
    setRow({ production: true })
    await gate.setEnforced(true, Date.parse("2026-10-30T09:00:00.000Z"))
    await mirrorEnforcementOnce()
    expect(await gate.isEnforced()).toBe(false)
    expect(await enforcement.readLanesEnforcedSetting()).toBe(false)
  })

  it("the preconditions say it is not available, and list it first among the unmet items", async () => {
    const p = await enforcementPreconditions()
    expect(p.available).toBe(false)
    expect(unmetPreconditions(p)[0]).toBe("available")
  })

  it("measuring goes on: an acquire over the limit with the flag off is granted as an over-limit lease", async () => {
    await mirrorEnforcementOnce()
    const meta = (jobId: string) => ({
      jobId, userId: "U", payer: "user:U" as const, lane: "provider" as const, provider: "kie", source: null, sourceDetail: null,
      jobType: "image-to-video", model: null, queue: "video-generation" as const, bullJobId: `bull-${jobId}`,
    })
    expect(await gate.acquire({ meta: meta("a"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })).toMatchObject({ granted: true, overLimit: false })
    expect(await gate.acquire({ meta: meta("b"), size: 1, mode: "fresh", leaseTtlMs: 60_000 }))
      .toMatchObject({ granted: true, overLimit: true, wouldWait: { lane: "provider", position: 1, limit: 1 } })
    expect((await gate.snapshot()).lines[0]!.lanes.provider).toMatchObject({ running: 2, overLimit: 1 })
  })
})
