// Lane sizes, settings and the enforcement flag: the per-tier code defaults,
// the env layer of Community/Business, and the Redis flag read through the gate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate } from "../gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "./fake-lane-redis.js"

const edition = vi.hoisted(() => ({ credits: false }))
const gateRef = vi.hoisted(() => ({ gate: null as unknown }))

vi.mock("../../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.js")>()),
  hasCredits: () => edition.credits,
}))
vi.mock("../instance.js", () => ({ concurrencyGate: () => gateRef.gate }))

const { config } = await import("../../config.js")
const { defaultLaneSizesForTier, laneSettings, laneSizesFor, lanesEnforced, providerCeilings } = await import("../sizes.js")
const { TIER_PARALLELISM } = await import("../../../ee/billing/stripe-config.js")

const subject = (tier: string | null) => ({ userId: "u1", payer: "user:u1" as const, tier })

describe("defaultLaneSizesForTier", () => {
  it("free is {provider 2, llm 4, local 4, run 2}", () => {
    expect(defaultLaneSizesForTier("free")).toEqual({ provider: 2, llm: 4, local: 4, run: 2 })
  })

  it("basic is {4, 8, 8, 4}", () => {
    expect(defaultLaneSizesForTier("basic")).toEqual({ provider: 4, llm: 8, local: 8, run: 4 })
  })

  it("standard and pro follow the formula", () => {
    expect(defaultLaneSizesForTier("standard")).toEqual({ provider: 6, llm: 12, local: 12, run: 6 })
    expect(defaultLaneSizesForTier("pro")).toEqual({ provider: 10, llm: 20, local: 20, run: 10 })
  })

  it("business is {12, 24, 24, 12}", () => {
    expect(defaultLaneSizesForTier("business")).toEqual({ provider: 12, llm: 24, local: 24, run: 12 })
  })

  it("payg equals basic", () => {
    expect(defaultLaneSizesForTier("payg")).toEqual(defaultLaneSizesForTier("basic"))
  })

  it("an unknown tier is sized as free", () => {
    expect(defaultLaneSizesForTier("no-such-tier")).toEqual(defaultLaneSizesForTier("free"))
  })

  it("returns a fresh object every call", () => {
    const a = defaultLaneSizesForTier("pro")
    a.provider = 99
    expect(defaultLaneSizesForTier("pro").provider).toBe(10)
  })
})

describe("TIER_PARALLELISM", () => {
  it("TIER_PARALLELISM is unchanged and has no enterprise key", () => {
    expect(TIER_PARALLELISM).toEqual({ free: 2, payg: 4, basic: 4, standard: 6, pro: 10, business: 12 })
    expect(Object.keys(TIER_PARALLELISM)).toEqual(["free", "payg", "basic", "standard", "pro", "business"])
    expect("enterprise" in TIER_PARALLELISM).toBe(false)
  })

  it("is the provider size of every tier", () => {
    for (const [tier, n] of Object.entries(TIER_PARALLELISM)) expect(defaultLaneSizesForTier(tier).provider).toBe(n)
  })
})

describe("laneSizesFor", () => {
  const saved = {
    provider: config.LANE_PROVIDER_PER_USER,
    llm: config.LANE_LLM_PER_USER,
    local: config.LANE_LOCAL_PER_USER,
    run: config.LANE_RUN_PER_USER,
  }
  afterEach(() => {
    edition.credits = false
    config.LANE_PROVIDER_PER_USER = saved.provider
    config.LANE_LLM_PER_USER = saved.llm
    config.LANE_LOCAL_PER_USER = saved.local
    config.LANE_RUN_PER_USER = saved.run
  })

  it("community defaults are 12 / 24 / 24 / 12", async () => {
    edition.credits = false
    expect(await laneSizesFor(subject("pro"))).toEqual({ provider: 12, llm: 24, local: 24, run: 12 })
  })

  it("community laneSizesFor returns the env values", async () => {
    edition.credits = false
    config.LANE_PROVIDER_PER_USER = 7
    config.LANE_LLM_PER_USER = 9
    config.LANE_LOCAL_PER_USER = 11
    config.LANE_RUN_PER_USER = 3
    expect(await laneSizesFor(subject("pro"))).toEqual({ provider: 7, llm: 9, local: 11, run: 3 })
  })

  it("Cloud sizes a line by its tier, and an unknown tier as free", async () => {
    edition.credits = true
    config.LANE_PROVIDER_PER_USER = 7
    expect(await laneSizesFor(subject("pro"))).toEqual(defaultLaneSizesForTier("pro"))
    expect(await laneSizesFor(subject(null))).toEqual(defaultLaneSizesForTier("free"))
  })
})

describe("providerCeilings", () => {
  it("has none in either edition", async () => {
    edition.credits = false
    expect(await providerCeilings()).toEqual({})
    edition.credits = true
    expect(await providerCeilings()).toEqual({})
    edition.credits = false
  })
})

describe("laneSettings", () => {
  it("laneSettings() defaults {queueTimeoutMs: 7_200_000, liveWaitLimitMs: 600_000}", async () => {
    expect(await laneSettings()).toEqual({ queueTimeoutMs: 7_200_000, liveWaitLimitMs: 600_000 })
  })

  it("reads the env minutes at call time", async () => {
    const saved = { q: config.LANE_QUEUE_TIMEOUT_MINUTES, l: config.LANE_LIVE_WAIT_MINUTES }
    try {
      config.LANE_QUEUE_TIMEOUT_MINUTES = 30
      config.LANE_LIVE_WAIT_MINUTES = 2
      expect(await laneSettings()).toEqual({ queueTimeoutMs: 1_800_000, liveWaitLimitMs: 120_000 })
    } finally {
      config.LANE_QUEUE_TIMEOUT_MINUTES = saved.q
      config.LANE_LIVE_WAIT_MINUTES = saved.l
    }
  })
})

describe("lanesEnforced", () => {
  beforeEach(() => {
    const store = makeFakeLaneStore()
    gateRef.gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  })

  it("is false while no Redis flag is set", async () => {
    expect(await lanesEnforced()).toBe(false)
  })

  it("lanesEnforced reads a Redis error as off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      gateRef.gate = { isEnforced: () => Promise.reject(new Error("ECONNREFUSED")) }
      expect(await lanesEnforced()).toBe(false)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"))
    } finally {
      warn.mockRestore()
    }
  })

  it("lanesEnforced reads a Redis that never answers as off, within the gate's call timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      // The BullMQ connection during an outage: eval sits in the offline queue and never settles.
      const hanging = { eval: () => new Promise(() => undefined), publish: () => new Promise(() => undefined) }
      gateRef.gate = new ConcurrencyGate({ client: () => hanging as never, callTimeoutMs: 3_000 })
      const settled = vi.fn()
      const p = lanesEnforced()
      p.then(settled)
      await vi.advanceTimersByTimeAsync(2_999)
      expect(settled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(await p).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it("follows the gate's Redis flag, not LANES_ENFORCED", async () => {
    const saved = config.LANES_ENFORCED
    try {
      config.LANES_ENFORCED = true
      expect(await lanesEnforced()).toBe(false)
      await (gateRef.gate as ConcurrencyGate).setEnforced(true)
      expect(await lanesEnforced()).toBe(true)
      await (gateRef.gate as ConcurrencyGate).setEnforced(false)
      expect(await lanesEnforced()).toBe(false)
    } finally {
      config.LANES_ENFORCED = saved
    }
  })
})

describe("config", () => {
  it("defaults the lane env vars", async () => {
    const { envSchema } = await import("../../config.js")
    const s = envSchema.shape
    expect(s.LANE_PROVIDER_PER_USER.parse(undefined)).toBe(12)
    expect(s.LANE_LLM_PER_USER.parse(undefined)).toBe(24)
    expect(s.LANE_LOCAL_PER_USER.parse(undefined)).toBe(24)
    expect(s.LANE_RUN_PER_USER.parse(undefined)).toBe(12)
    expect(s.LANE_QUEUE_TIMEOUT_MINUTES.parse(undefined)).toBe(120)
    expect(s.LANE_LIVE_WAIT_MINUTES.parse(undefined)).toBe(10)
    expect(s.LANES_ENFORCED.parse(undefined)).toBe(false)
    expect(s.ORCHESTRATOR_DISPATCH_WIDTH.parse(undefined)).toBe(50)
    expect(s.LANE_SERVER_COORDINATOR_SHARE.parse(undefined)).toBe(0.4)
    expect(s.LANE_SERVER_USER_SHARE.parse(undefined)).toBe(0.25)
  })

  it("holds the bounds", async () => {
    const { envSchema } = await import("../../config.js")
    const s = envSchema.shape
    for (const k of ["LANE_PROVIDER_PER_USER", "LANE_LLM_PER_USER", "LANE_LOCAL_PER_USER", "LANE_RUN_PER_USER", "ORCHESTRATOR_DISPATCH_WIDTH"] as const) {
      expect(s[k].safeParse("0").success, k).toBe(false)
      expect(s[k].safeParse("501").success, k).toBe(false)
      expect(s[k].parse("500"), k).toBe(500)
    }
    expect(s.LANE_SERVER_COORDINATOR_SHARE.safeParse("0.05").success).toBe(false)
    expect(s.LANE_SERVER_COORDINATOR_SHARE.parse("1")).toBe(1)
    expect(s.LANE_SERVER_USER_SHARE.safeParse("0.04").success).toBe(false)
    expect(s.LANE_SERVER_USER_SHARE.parse("0.05")).toBe(0.05)
    expect(s.LANE_QUEUE_TIMEOUT_MINUTES.safeParse("4").success).toBe(false)
    expect(s.LANE_QUEUE_TIMEOUT_MINUTES.parse("5")).toBe(5)
    expect(s.LANE_QUEUE_TIMEOUT_MINUTES.parse("1440")).toBe(1440)
    expect(s.LANE_QUEUE_TIMEOUT_MINUTES.safeParse("1441").success).toBe(false)
    expect(s.LANE_LIVE_WAIT_MINUTES.safeParse("0").success).toBe(false)
    expect(s.LANE_LIVE_WAIT_MINUTES.parse("1")).toBe(1)
    expect(s.LANE_LIVE_WAIT_MINUTES.parse("60")).toBe(60)
    expect(s.LANE_LIVE_WAIT_MINUTES.safeParse("61").success).toBe(false)
    expect(s.LANES_ENFORCED.parse("1")).toBe(true)
    expect(s.LANES_ENFORCED.parse("yes")).toBe(false)
  })
})
