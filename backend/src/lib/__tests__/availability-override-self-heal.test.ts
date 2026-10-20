/**
 * A process that never booted the app must still see the admin switch.
 *
 * `loadAvailabilityOverrides()` used to be called by app.ts alone, and the lazy
 * refresh in `availabilityOverride()` was gated on "already loaded once". The
 * STANDALONE orchestrator (orchestrator.ts) never builds the app, so its cache
 * stayed null forever: the switch did not exist for any execution it picked
 * up — and it shares its queue with the API's in-process worker, so whether a
 * run honoured the switch came down to which process got the job.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const db = vi.hoisted(() => ({
  select: vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: [], error: null })),
}))
vi.mock("../supabase.js", () => ({ supabase: { from: () => ({ select: db.select }) } }))
// A load awaits the node universe before it touches the database. The real
// registry drags the whole credits graph in — seconds on a loaded machine, long
// enough to outlive a test and land in the next one. Two rows keep it instant.
vi.mock("../node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", category: "ai-image" },
    { type: "instagram-scrape", category: "input" },
  ],
}))

import {
  availabilityOverride,
  loadAvailabilityOverridesForScript,
  __resetAvailabilityOverridesForTests,
  __awaitAvailabilityRefreshForTests,
} from "../availability-override.js"

/** The self-heal is skipped under the test runner on purpose; these cases are
 *  about a REAL process, so they lift that guard for their own duration. */
let savedVitest: string | undefined
beforeEach(() => {
  __resetAvailabilityOverridesForTests()
  db.select.mockClear()
  savedVitest = process.env.VITEST
  delete process.env.VITEST
})
afterEach(async () => {
  process.env.VITEST = savedVitest
  // Let a load this test kicked LAND before resetting, so it cannot arrive in
  // the middle of the next test and hand it a cache it never asked for.
  await new Promise((resolve) => setTimeout(resolve, 20))
  await __awaitAvailabilityRefreshForTests()
  __resetAvailabilityOverridesForTests()
  vi.restoreAllMocks()
})

describe("availabilityOverride — a process that never called loadAvailabilityOverrides()", () => {
  it("answers from the factory on its first ask, loads in the background, and honours the switch from then on", async () => {
    db.select.mockResolvedValueOnce({ data: [{ kind: "nodes", enabled: ["generate-image"] }], error: null })

    expect(availabilityOverride("nodes")).toBeNull()
    await vi.waitFor(() => expect(db.select).toHaveBeenCalledTimes(1), { timeout: 5000 })
    await __awaitAvailabilityRefreshForTests()

    const loaded = availabilityOverride("nodes")
    expect(loaded?.has("generate-image")).toBe(true)
    expect(loaded?.has("instagram-scrape")).toBe(false)
  })

  it("retries a failing load on the refresh cadence, not on every predicate call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    db.select.mockResolvedValue({ data: null, error: { message: "db down" } })

    availabilityOverride("nodes")
    await vi.waitFor(() => expect(db.select).toHaveBeenCalledTimes(1), { timeout: 5000 })
    await __awaitAvailabilityRefreshForTests()
    for (let i = 0; i < 50; i++) availabilityOverride("nodes")
    // A kicked load only becomes `inflight` after it has awaited the node
    // universe, so give any wrongly-kicked load real time to reach the database
    // before counting — awaiting `inflight` straight away would see nothing yet.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await __awaitAvailabilityRefreshForTests()

    expect(db.select).toHaveBeenCalledTimes(1)
    expect(availabilityOverride("nodes")).toBeNull()
  })

  it("stays inert under the test runner — a pristine cache must not reach for a database", () => {
    process.env.VITEST = "true"
    availabilityOverride("nodes")
    availabilityOverride("models")
    expect(db.select).not.toHaveBeenCalled()
  })
})

describe("the standalone orchestrator loads the admin switch at boot", () => {
  it("orchestrator.ts awaits loadAvailabilityOverrides() before it starts consuming executions", () => {
    const src = readFileSync(fileURLToPath(new URL("../../orchestrator.ts", import.meta.url)), "utf8")
    const load = src.indexOf("await loadAvailabilityOverrides()")
    const start = src.indexOf("createOrchestratorWorker()")
    expect(load, "orchestrator.ts no longer loads the availability override").toBeGreaterThan(-1)
    expect(start).toBeGreaterThan(-1)
    expect(load).toBeLessThan(start)
  })
})

describe("a one-off script waits for the overrides (a listing backfill prices for everyone)", () => {
  it("resolves true only once the read has landed, with the switch in the cache", async () => {
    db.select.mockResolvedValueOnce({ data: [{ kind: "nodes", enabled: ["generate-image"] }], error: null })
    expect(await loadAvailabilityOverridesForScript()).toBe(true)
    expect(availabilityOverride("nodes")).toEqual(new Set(["generate-image"]))
  })
  it("resolves false when the read fails: the caller must refuse, not price on the factory sets", async () => {
    db.select.mockResolvedValueOnce({ data: null, error: { message: "down" } })
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(await loadAvailabilityOverridesForScript()).toBe(false)
    error.mockRestore()
  })
})
