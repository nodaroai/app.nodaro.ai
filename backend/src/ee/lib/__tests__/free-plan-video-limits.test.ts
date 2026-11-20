import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * What the free plan states of the free-credit video limits before sign-in
 * (`GET /v1/billing/plans`): the settings an account that never paid gets them
 * at, and off wherever the account decision (`freeVideoLimitsApply`) never
 * applies them.
 */

const h = vi.hoisted(() => ({ getFreeVideoLimits: vi.fn(), deploymentPayerActive: vi.fn() }))

vi.mock("@/ee/lib/free-video-config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/lib/free-video-config.js")>()),
  getFreeVideoLimits: h.getFreeVideoLimits,
}))
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deployment-payer.js")>()),
  deploymentPayerActive: h.deploymentPayerActive,
}))

import { freePlanVideoLimits } from "../free-plan-video-limits.js"
import { freeVideoLimitsApply } from "../free-video-limits-for.js"
import { FREE_VIDEO_LIMITS_DEFAULTS } from "../../billing/free-video-limits.js"

beforeEach(() => {
  vi.clearAllMocks()
  h.deploymentPayerActive.mockReturnValue(false)
})

describe("freePlanVideoLimits", () => {
  it("is the settings, as an account that never paid runs under them", async () => {
    h.getFreeVideoLimits.mockResolvedValue({ enabled: true, maxSeconds: 6 })
    expect(await freePlanVideoLimits()).toEqual({ enabled: true, maxSeconds: 6 })
  })

  it("is off when the settings turn the limits off", async () => {
    h.getFreeVideoLimits.mockResolvedValue({ enabled: false, maxSeconds: 4 })
    expect(await freePlanVideoLimits()).toEqual({ enabled: false, maxSeconds: 4 })
  })

  it("is off on a deployment-payer instance, where the account decision never applies them", async () => {
    h.deploymentPayerActive.mockReturnValue(true)
    h.getFreeVideoLimits.mockResolvedValue({ enabled: true, maxSeconds: 4 })
    expect(await freePlanVideoLimits()).toEqual({ enabled: false, maxSeconds: 4 })
    expect(await freeVideoLimitsApply("user-1", "free", undefined)).toBe(false)
  })

  it("hands out a fresh object, never the settings cache's own", async () => {
    const cached = { enabled: true, maxSeconds: 4 }
    h.getFreeVideoLimits.mockResolvedValue(cached)
    const stated = await freePlanVideoLimits()
    expect(stated).toEqual(cached)
    expect(stated).not.toBe(cached)
  })
})

describe("freePlanVideoLimits never holds the public plans route", () => {
  it("states the defaults once the settings take longer than the wait, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    h.getFreeVideoLimits.mockReturnValue(new Promise(() => {}))
    const started = Date.now()
    expect(await freePlanVideoLimits(20)).toEqual(FREE_VIDEO_LIMITS_DEFAULTS)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("took over 20 ms"))
    warn.mockRestore()
  })

  it("states the defaults when the settings read fails outright, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    h.getFreeVideoLimits.mockRejectedValue(new Error("boom"))
    expect(await freePlanVideoLimits()).toEqual(FREE_VIDEO_LIMITS_DEFAULTS)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not be read"), "boom")
    warn.mockRestore()
  })
})
