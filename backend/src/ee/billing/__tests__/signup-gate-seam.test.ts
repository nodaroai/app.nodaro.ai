import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PluginServices } from "../../../lib/private-plugins/types.js"

const h = vi.hoisted(() => ({ services: {} as PluginServices }))
vi.mock("../../../lib/private-plugins/load.js", () => ({ getPluginServices: () => h.services }))

import { compareWithPluginGate, signupGateService } from "../signup-gate-seam.js"

const USER = "00000000-0000-4000-8000-000000000001"
const input = { userId: USER, browserKey: "b".repeat(64), deviceKey: "d".repeat(64), ipHash: "i".repeat(64) }
const granted = { decision: "granted" as const, reasons: [] }
const withheld = { decision: "withheld" as const, reasons: ["browser_match"] }

function log() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
}

function gate(evaluate: (...args: unknown[]) => unknown) {
  return {
    evaluate,
    siblingTakeback: () => null,
    withheldForKeylessOnly: () => false,
    hasPurchase: async () => false,
    invalidateConfig: () => {},
  } as unknown as NonNullable<PluginServices["signupGate"]>
}

beforeEach(() => {
  h.services = {}
})

describe("signupGateService — the seam, member-probed", () => {
  it("is null without a plugin, and null for a plugin without the member", async () => {
    expect(await signupGateService()).toBeNull()
    h.services = { signupGate: {} as never }
    expect(await signupGateService()).toBeNull()
  })

  it("is the plugin's service when it answers", async () => {
    const g = gate(vi.fn())
    h.services = { signupGate: g }
    expect(await signupGateService()).toBe(g)
  })
})

describe("compareWithPluginGate — the transition's parity check", () => {
  it("does nothing without a plugin", async () => {
    const l = log()
    await compareWithPluginGate(input, granted, l)
    expect((l as { warn: ReturnType<typeof vi.fn> }).warn).not.toHaveBeenCalled()
  })

  it("asks the plugin with the same claim and logs the agreement — the positive signal, not silence", async () => {
    const evaluate = vi.fn().mockResolvedValue({ decision: "withheld", reasons: ["browser_match"] })
    h.services = { signupGate: gate(evaluate) }
    const l = log()
    await compareWithPluginGate(input, withheld, l)
    expect(evaluate).toHaveBeenCalledWith(input, l)
    expect((l as { warn: ReturnType<typeof vi.fn> }).warn).not.toHaveBeenCalled()
    expect((l as { info: ReturnType<typeof vi.fn> }).info).toHaveBeenCalledWith(
      { userId: USER, decision: "withheld" },
      "signup gate: the plugin agrees",
    )
  })

  it("logs both answers when they differ — the decision itself is the caller's and untouched", async () => {
    h.services = { signupGate: gate(vi.fn().mockResolvedValue(withheld)) }
    const l = log()
    const ours = { ...granted }
    await compareWithPluginGate(input, ours, l)
    expect(ours).toEqual(granted)
    expect((l as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledWith(
      { userId: USER, ours: granted, plugin: withheld },
      "signup gate: the plugin's decision differs from this repo's",
    )
  })

  it("a different reason list is a difference too", async () => {
    h.services = { signupGate: gate(vi.fn().mockResolvedValue({ decision: "withheld", reasons: ["browser_match", "ip_velocity"] })) }
    const l = log()
    await compareWithPluginGate(input, withheld, l)
    expect((l as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledTimes(1)
  })

  it("a plugin that throws is logged and changes nothing", async () => {
    h.services = { signupGate: gate(vi.fn().mockRejectedValue(new Error("boom"))) }
    const l = log()
    await expect(compareWithPluginGate(input, granted, l)).resolves.toBeUndefined()
    expect((l as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledWith(
      { err: expect.any(Error), userId: USER },
      "signup gate: the plugin's decision threw",
    )
  })
})
