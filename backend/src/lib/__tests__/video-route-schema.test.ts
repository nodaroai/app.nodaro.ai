// @test-units-by-name it names no node unit
// @test-watches backend/src/ee/billing/cleanup-cron.ts
/**
 * The schema check (lib/video-route-schema.ts): on a database without the
 * routed-video columns the server says so once and keeps the behaviour it had
 * before they existed, instead of failing every send and every cancel.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  error: null as { code: string; message: string } | null, probes: 0, updates: 0,
  state: { data: { missing: [] as string[] } as unknown, error: null as { code?: string; message: string } | null }, stateCalls: 0,
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: async () => (h.stateCalls++, h.state),
    from: () => ({
      select: () => ({ limit: async () => (h.probes++, { data: [], error: h.error }) }),
      update: () => (h.updates++, { eq: () => ({ in: () => ({ select: async () => ({ data: [{ id: "j" }], error: null }) }) }) }),
    }),
  },
}))

const { videoRouteSchemaReady, videoRouteSchemaMissing, videoRouteSchemaState, stopRuleSelect, _resetVideoRouteSchemaForTests, VIDEO_ROUTE_SCHEMA_RECHECK_MS } = await import("../video-route-schema.js")
const { STOP_RULE_COLUMNS } = await import("../stop-rule.js")
const { markVideoSendStarted } = await import("../video-send-start.js")

beforeEach(() => {
  _resetVideoRouteSchemaForTests()
  h.error = null
  h.probes = 0
  h.updates = 0
  h.state = { data: { missing: [] }, error: null }
  h.stateCalls = 0
})

describe("videoRouteSchemaMissing — the whole schema, asked once", () => {
  it("a whole schema is asked once per process and says nothing", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await videoRouteSchemaMissing()).toEqual([])
    expect(await videoRouteSchemaMissing()).toEqual([])
    expect(h.stateCalls).toBe(1)
    expect(alert).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it("names each missing piece in one alert: a trigger that is not attached, the index", async () => {
    h.state = { data: { missing: ["trigger recover_video_allowance on deployment_user_allowances", "index jobs_video_assembly_due_idx"] }, error: null }
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await videoRouteSchemaMissing()).toEqual(["trigger recover_video_allowance on deployment_user_allowances", "index jobs_video_assembly_due_idx"])
    await videoRouteSchemaMissing()
    expect(alert).toHaveBeenCalledTimes(1)
    expect(String(alert.mock.calls[0]?.[0])).toMatch(/incomplete\. Missing: trigger recover_video_allowance on deployment_user_allowances; index jobs_video_assembly_due_idx/)
    alert.mockRestore()
  })

  it("a read of the check that fails proves nothing and is asked again", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    h.state = { data: null, error: { code: "57014", message: "statement timeout" } }
    expect(await videoRouteSchemaMissing()).toEqual([])
    expect(await videoRouteSchemaMissing()).toEqual([])
    expect(h.stateCalls).toBe(2)
    expect(alert).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it("the check function not installed: the tables and the job's columns are probed, nothing is PROVEN missing, and the schema is unverified (not whole)", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    h.state = { data: null, error: { code: "PGRST202", message: "function not found" } }
    expect(await videoRouteSchemaMissing()).toEqual([])
    // Four tables and four job columns, one empty read each.
    expect(h.probes).toBe(8)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(String(alert.mock.calls[0]?.[0])).toMatch(/schema check function not installed.*all there.*triggers and the index could not be verified/)
    // Remembered for a few minutes: not probed again meanwhile.
    await videoRouteSchemaMissing()
    expect(h.probes).toBe(8)
    // Not whole: the triggers and the index could not be seen.
    expect(await videoRouteSchemaState()).toEqual({ status: "unverified", missing: [], checkInstalled: false })
    alert.mockRestore()
  })

  it("without the check function, a piece PROVEN missing is still named (here: the job's columns)", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    h.state = { data: null, error: { code: "42883", message: "function does not exist" } }
    h.error = { code: "42703", message: "column does not exist" }
    expect(await videoRouteSchemaMissing()).toEqual(["column jobs.video_send_started_at", "column jobs.metadata", "column jobs.video_route_addons_base", "column jobs.video_assembly_recovery"])
    expect(alert.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/schema check function not installed[\s\S]*incomplete\. Missing: column jobs\.video_send_started_at/)
    alert.mockRestore()
  })

  it("the first column probe starts it", async () => {
    await videoRouteSchemaReady()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.stateCalls).toBe(1)
  })
})

describe("videoRouteSchemaState — whole, incomplete or unverified, never kept for the life of the process", () => {
  it("whole only when the check function answers with nothing missing", async () => {
    expect(await videoRouteSchemaState()).toEqual({ status: "whole", missing: [], checkInstalled: true })
    h.state = { data: { missing: ["trigger block_unpaid_video_reservation on usage_logs"] }, error: null }
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await videoRouteSchemaState({ fresh: true })).toEqual({ status: "incomplete", missing: ["trigger block_unpaid_video_reservation on usage_logs"], checkInstalled: true })
    alert.mockRestore()
  })

  it("a check that cannot be asked is unverified and never kept: the next call asks again", async () => {
    h.state = { data: null, error: { code: "57014", message: "statement timeout" } }
    expect(await videoRouteSchemaState()).toEqual({ status: "unverified", missing: [] })
    h.state = { data: { missing: [] }, error: null }
    expect(await videoRouteSchemaState()).toEqual({ status: "whole", missing: [], checkInstalled: true })
    expect(h.stateCalls).toBe(2)
  })

  it("the fallback answer (no check function) is re-asked after a few minutes, so a process picks the function up without a restart", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    const t0 = Date.parse("2026-11-27T10:00:00Z")
    h.state = { data: null, error: { code: "PGRST202", message: "function not found" } }
    expect((await videoRouteSchemaState({ now: t0 })).status).toBe("unverified")
    expect((await videoRouteSchemaState({ now: t0 + 60_000 })).status).toBe("unverified")
    expect(h.stateCalls).toBe(1)
    // The function is applied meanwhile.
    h.state = { data: { missing: [] }, error: null }
    expect(await videoRouteSchemaState({ now: t0 + VIDEO_ROUTE_SCHEMA_RECHECK_MS + 1 })).toEqual({ status: "whole", missing: [], checkInstalled: true })
    expect(h.stateCalls).toBe(2)
    // One alert for the unverified state; none for the same state re-checked, none for "whole".
    expect(alert).toHaveBeenCalledTimes(1)
    alert.mockRestore()
  })

  it("an answer that does not list what is missing is unverified (not whole), says nothing, and is never kept", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const data of [null, {}, { missing: null }, { missing: "none" }, { missing: [1, 2] }, { missing: ["index jobs_video_assembly_due_idx", 3] }, []]) {
      h.state = { data, error: null }
      expect(await videoRouteSchemaState()).toEqual({ status: "unverified", missing: [], checkInstalled: true })
    }
    // Each one asked again: none was kept.
    expect(h.stateCalls).toBe(7)
    h.state = { data: { missing: [] }, error: null }
    expect(await videoRouteSchemaState()).toEqual({ status: "whole", missing: [], checkInstalled: true })
    expect(h.stateCalls).toBe(8)
    expect(alert).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it("the billing cron of every Cloud server asks it every minute, outside the once-per-environment lease, and never lets it throw", () => {
    const cron = readFileSync(join(__dirname, "..", "..", "ee", "billing", "cleanup-cron.ts"), "utf8")
    const line = cron.split("\n").find((l) => l.includes("videoRouteSchemaState("))
    expect(line).toBeDefined()
    expect(line).toMatch(/cron\.schedule\("\* \* \* \* \*", \(\) => \{ void videoRouteSchemaState\(\)\.catch\(\(\) => \{\}\) \}\)/)
    expect(line).not.toContain("runOncePerEnvironment")
    // Not a fresh ask: a tick between re-checks reads nothing.
    expect(line).not.toContain("fresh")
  })

  it("a fresh ask always goes to the database (what a save asks)", async () => {
    await videoRouteSchemaState()
    await videoRouteSchemaState({ fresh: true })
    await videoRouteSchemaState({ fresh: true })
    expect(h.stateCalls).toBe(3)
  })
})

describe("videoRouteSchemaReady", () => {
  it("probes once and remembers: the columns are there", async () => {
    expect(await videoRouteSchemaReady()).toBe(true)
    expect(await videoRouteSchemaReady()).toBe(true)
    expect(h.probes).toBe(1)
    expect(await stopRuleSelect(`id, ${STOP_RULE_COLUMNS}`)).toBe(`id, ${STOP_RULE_COLUMNS}`)
  })

  it("a missing column is said ONCE, loudly, and the callers keep the behaviour from before the columns existed", async () => {
    h.error = { code: "42703", message: "column jobs.video_send_started_at does not exist" }
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await videoRouteSchemaReady()).toBe(false)
    expect(await videoRouteSchemaReady()).toBe(false)
    expect(h.probes).toBe(1)
    expect(err.mock.calls.filter((c) => String(c[0]).startsWith("[ALERT]"))).toHaveLength(1)
    // A cancel reads without the marker.
    const select = await stopRuleSelect(`id, ${STOP_RULE_COLUMNS}`)
    expect(select).not.toContain("video_send_started_at")
    expect(select).toContain("provider_task_id")
    // A send is not marked (and does not throw on the missing column).
    await expect(markVideoSendStarted("job-1")).resolves.toBeUndefined()
    expect(h.updates).toBe(0)
    err.mockRestore()
  })

  it("a probe that fails for another reason proves nothing: the columns are assumed there, and it probes again", async () => {
    h.error = { code: "57014", message: "statement timeout" }
    expect(await videoRouteSchemaReady()).toBe(true)
    h.error = null
    expect(await videoRouteSchemaReady()).toBe(true)
    expect(h.probes).toBe(2)
    await markVideoSendStarted("job-1")
    expect(h.updates).toBe(1)
  })
})
