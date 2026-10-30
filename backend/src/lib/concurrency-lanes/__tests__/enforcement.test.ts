// The `lanes_enforced` switch: its per-environment key, the 30-s mirror into
// the gate's Redis flag (and the provider ceilings), the off-transition wake,
// and the preconditions the Admin switch lists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate } from "../gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "./fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "./fake-lane-db.js"

const refs = vi.hoisted(() => ({ gate: null as unknown, db: null as unknown as { client: { from(t: string): unknown } }, credits: true }))

vi.mock("../../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.js")>()),
  hasCredits: () => refs.credits,
}))
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../../supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))

const { config } = await import("../../config.js")
const enforcement = await import("../enforcement.js")
const {
  ENFORCEMENT_MIRROR_INTERVAL_MS, LANES_ENFORCED_KEY, enforcementPreconditions, lastMirroredEnforced, mirrorEnforcementOnce,
  registerMeasureDaysReader, registerOffTransitionWaker, resetEnforcementHooksForTests, setLanesEnforced,
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
    vi.spyOn(gate, "isEnforced").mockRejectedValue(new Error("redis down"))
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

  it("unmetPreconditions lists each unmet item, and none when all are met", () => {
    const met = { columnsPresent: true, pluginTypesKnown: true, undeclaredPluginTypes: [], liveCeilingMeasured: true, measureDays: 7 }
    expect(unmetPreconditions(met)).toEqual([])
    expect(unmetPreconditions({ columnsPresent: false, pluginTypesKnown: true, undeclaredPluginTypes: ["x"], liveCeilingMeasured: false, measureDays: 6 }))
      .toEqual(["columns", "plugins", "liveCeiling", "measureDays"])
  })
})
