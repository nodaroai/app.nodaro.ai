// Which deployments fire scheduled workflows.
//
// Staging and production share one database, so a schedule cron running in
// both reads the same `workflow_triggers` rows and production users' runs get
// started by staging's build. The default therefore follows Railway's own
// environment name: on Railway only `production` fires; off Railway (every
// self-host and community install) schedules fire as they always have. An
// explicit SCHEDULE_TRIGGERS_ENABLED wins either way.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { resolveScheduleTriggersEnabled } from "../config.js"

describe("resolveScheduleTriggersEnabled — the default", () => {
  it("fires with nothing set (self-host, community, local dev)", () => {
    expect(resolveScheduleTriggersEnabled(undefined, undefined)).toBe(true)
  })

  it("fires on Railway's production environment with no new variable set", () => {
    expect(resolveScheduleTriggersEnabled(undefined, "production")).toBe(true)
  })

  it("does not fire on any other Railway environment (staging, PR environments)", () => {
    expect(resolveScheduleTriggersEnabled(undefined, "staging")).toBe(false)
    expect(resolveScheduleTriggersEnabled(undefined, "pr-123")).toBe(false)
  })

  it("a blank Railway name counts as unset", () => {
    expect(resolveScheduleTriggersEnabled(undefined, "  ")).toBe(true)
  })
})

describe("resolveScheduleTriggersEnabled — an explicit value wins", () => {
  it("false switches a production environment off", () => {
    expect(resolveScheduleTriggersEnabled(false, "production")).toBe(false)
    expect(resolveScheduleTriggersEnabled(false, undefined)).toBe(false)
  })

  it("true switches a non-production environment on", () => {
    expect(resolveScheduleTriggersEnabled(true, "staging")).toBe(true)
  })
})

describe("SCHEDULE_TRIGGERS_ENABLED strict parsing", () => {
  const ORIGINAL = process.env.SCHEDULE_TRIGGERS_ENABLED

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SCHEDULE_TRIGGERS_ENABLED
    else process.env.SCHEDULE_TRIGGERS_ENABLED = ORIGINAL
  })

  it.each([
    ["true", true],
    ["1", true],
    ["TRUE", true],
    ["false", false],
    ["0", false],
    [" false ", false],
  ])("parses %j as %s", async (raw, expected) => {
    process.env.SCHEDULE_TRIGGERS_ENABLED = raw
    const { config } = await import("../config.js")
    expect(config.SCHEDULE_TRIGGERS_ENABLED).toBe(expected)
  })

  it("unset and blank both mean 'use the default'", async () => {
    delete process.env.SCHEDULE_TRIGGERS_ENABLED
    expect((await import("../config.js")).config.SCHEDULE_TRIGGERS_ENABLED).toBeUndefined()
    vi.resetModules()
    process.env.SCHEDULE_TRIGGERS_ENABLED = ""
    expect((await import("../config.js")).config.SCHEDULE_TRIGGERS_ENABLED).toBeUndefined()
  })

  it("refuses to boot on anything else — a typo must not silently pick a side", async () => {
    process.env.SCHEDULE_TRIGGERS_ENABLED = "yes"
    await expect(import("../config.js")).rejects.toThrow(/SCHEDULE_TRIGGERS_ENABLED/)
  })
})
