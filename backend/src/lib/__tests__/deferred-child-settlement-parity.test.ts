import { describe, it, expect, vi, beforeEach } from "vitest"
import { FakeDb } from "./helpers/fake-jobs-db.js"

/**
 * The figure a held child shows (`plannedCommitCredits`) is what its settle
 * then commits — held to the REAL settle (`settleFinalizedJobCredits` →
 * `commitJobCredits` / `refundLoopTrimAddon` in workers/shared.ts), branch by
 * branch, so the two cannot drift. Only the billing service at the bottom is
 * stubbed: it records the amount each commit asks for.
 */

const db = vi.hoisted(() => ({ current: null as unknown as { from: (t: string) => unknown } }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => db.current.from(t), rpc: vi.fn() } }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => true,
}))
const committed = vi.hoisted(() => ({ amounts: [] as Array<number | undefined> }))
const service = vi.hoisted(() => ({
  CreditsService: {
    trySettleManagedCredits: vi.fn(async () => false),
    commitCredits: vi.fn(async (_id: string, actual?: number, opts?: { collectOverHold?: boolean }) => {
      committed.amounts.push(actual)
      return opts?.collectOverHold ? { charged: actual, collectedOverHold: 0, shortfall: 0 } : undefined
    }),
  },
}))
vi.mock("@/ee/services/credits.js", () => service)
vi.mock("@/ee/billing/credits.js", () => service)
vi.mock("@/ee/billing/credit-anomaly.js", () => ({
  computeActualCredits: vi.fn(async (usd: number) => Math.round(usd * 100)),
  checkAndLogAnomaly: vi.fn(async () => undefined),
}))
vi.mock("@/ee/billing/service-margin.js", () => ({ applyServiceMarkup: vi.fn((base: number) => Math.ceil(base * 1.5)) }))
vi.mock("@/lib/app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAppSettings: vi.fn(async () => ({})),
}))

import { plannedCommitCredits, settleFinalizedJobCredits } from "../deferred-child-settlement.js"
import type { HeldCommitReplay } from "../job-policy.js"

const JOB = "00000000-0000-4000-8000-0000000000c1"
const LOG = "00000000-0000-4000-8000-0000000000f1"

beforeEach(() => {
  committed.amounts = []
  const fake = new FakeDb()
  db.current = fake
  fake.tables.jobs!.push({ id: JOB, credits_actual: null })
  fake.tables.usage_logs!.push({ id: LOG, job_id: JOB, status: "reserved", credits_used: 40, action: "seedance-2-5", metadata: {}, user_id: "u", provider: "kie" })
})

describe("the planned figure is what the settle commits", () => {
  it.each([
    ["a fixed price", {}, 0.5],
    ["a metered USD cost plus an add-on", { metered: true, extraNonProviderCredits: 3 }, 0.21],
    ["a metered USD cost collected over the hold", { metered: true, collectOverHold: true }, 0.5],
    ["a measured charge below the reservation", { meteredBaseCredits: 20 }, null],
    ["a measured charge above the reservation", { meteredBaseCredits: 100 }, null],
    ["an undelivered loop-trim add-on", { loopTrimAddonRefundCredits: 6 }, null],
  ] as Array<[string, HeldCommitReplay, number | null]>)("%s", async (_label, commit, cost) => {
    const planned = await plannedCommitCredits(LOG, commit, cost, null)
    await settleFinalizedJobCredits({ jobId: JOB, usageLogId: LOG, workflowExecutionId: null, commit, providerCost: cost })
    expect(committed.amounts).toHaveLength(1)
    // The fixed branch commits the reservation (no amount named): 40.
    expect(committed.amounts[0] ?? 40).toBe(planned)
  })
})
