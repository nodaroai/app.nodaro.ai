// The upgrade hint of a waiting row (`queue.upgradeHint`), and the sentence
// the MCP job tools say it in, as the deployment's billing has them (decided
// 2026-11-15). With nothing configured (self-serve on) a payer's own full line
// below business carries "plan", a workspace's carries "workspace", exactly as
// before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refs = vi.hoisted(() => {
  process.env.NODARO_SURFACE_PROFILE = ""
  return { gate: null as unknown, tier: async (): Promise<string | null> => "free" }
})
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
}))
vi.mock("@/lib/concurrency-lanes/sizes.js", () => ({ payerTier: () => refs.tier() }))

import { queueInfoFor, resetQueueInfoWarningForTests } from "../queue-info.js"
import { mcpQueueText } from "../queue-copy.js"
import { __resetSurfaceProfileCacheForTests } from "../../surface-profile.js"
import type { WaitInfo } from "../types.js"

const wait = (over: Partial<WaitInfo> = {}): WaitInfo =>
  ({ lane: "provider", position: 3, limit: 4, running: 4, reason: "user_lane", waitedMs: 4_000, enqueuedAtMs: 0, ...over })
const gateAnswering = (waits: Record<string, { wait: WaitInfo; payer: string | null }>) => ({
  describeWaits: async (ids: readonly string[]) => new Map(ids.filter((id) => waits[id]).map((id) => [id, waits[id]!])),
})

function setBilling(billing: Record<string, unknown> | null): void {
  process.env.NODARO_SURFACE_PROFILE = billing ? JSON.stringify({ billing }) : ""
  __resetSurfaceProfileCacheForTests()
}

/** The hint and the MCP sentence for a user's own full line and a workspace's. */
async function hints(): Promise<Record<string, { hint: unknown; text: string }>> {
  refs.gate = gateAnswering({ own: { wait: wait(), payer: "user:U" }, ws: { wait: wait({ lane: "run", limit: 1, running: 1, position: 1 }), payer: "workspace:W" } })
  const q = await queueInfoFor(["own", "ws"].map((id) => ({ id, queuedAt: null })))
  return Object.fromEntries([...q].map(([id, info]) => [id, { hint: info.upgradeHint, text: mcpQueueText(info) }]))
}

beforeEach(() => {
  refs.tier = async () => "free"
  resetQueueInfoWarningForTests()
})
afterEach(() => setBilling(null))

describe("nothing configured: the hint and its sentence exactly as before", () => {
  it("a user's own full line names the plan, a workspace's its owner", async () => {
    expect(await hints()).toEqual({
      own: {
        hint: "plan",
        text: "Still waiting — 3rd in line (your plan runs 4 at once). Call wait_for_job again to keep waiting. Need more at once? Upgrade your plan.",
      },
      ws: {
        hint: "workspace",
        text: "Waiting to start — 1st in line, your plan allows 1 run at once. Call wait_for_job again to keep waiting. Need more at once? Ask your workspace owner to upgrade.",
      },
    })
  })
})

describe("a deployment without self-serve billing offers no upgrade, on any line", () => {
  it("no hint, and the sentence ends at what to do next", async () => {
    setBilling({ selfServe: false })
    const got = await hints()
    expect(got).toEqual({
      own: { hint: null, text: "Still waiting — 3rd in line (your plan runs 4 at once). Call wait_for_job again to keep waiting." },
      ws: { hint: null, text: "Waiting to start — 1st in line, your plan allows 1 run at once. Call wait_for_job again to keep waiting." },
    })
    for (const { text } of Object.values(got)) expect(text).not.toMatch(/upgrade|top up|\bbuy\b|purchase|pricing/i)
  })

  it("its own unit alone (self-serve left on) keeps the hint: a plan can still be bought there", async () => {
    setBilling({ unitLabel: "points", unitRate: 0.25, unitDecimals: 2 })
    expect(Object.values(await hints()).map((v) => v.hint)).toEqual(["plan", "workspace"])
  })
})
