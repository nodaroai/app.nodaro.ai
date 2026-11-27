// @test-units-by-name it names no node unit
/**
 * The schema check (lib/video-route-schema.ts): on a database without the
 * routed-video columns the server says so once and keeps the behaviour it had
 * before they existed, instead of failing every send and every cancel.
 */
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

const { videoRouteSchemaReady, videoRouteSchemaMissing, stopRuleSelect, _resetVideoRouteSchemaForTests } = await import("../video-route-schema.js")
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

  it("the check function not installed blocks nothing by itself: the tables and the job's columns are probed, and with all there nothing is missing", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    h.state = { data: null, error: { code: "PGRST202", message: "function not found" } }
    expect(await videoRouteSchemaMissing()).toEqual([])
    // Four tables and four job columns, one empty read each.
    expect(h.probes).toBe(8)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(String(alert.mock.calls[0]?.[0])).toMatch(/schema check function not installed.*all there.*triggers and the index could not be verified/)
    // Remembered: not probed again.
    await videoRouteSchemaMissing()
    expect(h.probes).toBe(8)
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
