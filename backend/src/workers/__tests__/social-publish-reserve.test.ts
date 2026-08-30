// P14/W4e — the social worker's reserve carries the payload's payer.
//
// A separate file on purpose: the main social-publish-worker harness runs
// with hasCredits()=false ("keep the ee reserve path out of unit tests"), so
// a dropped options-carry there is invisible. This world flips credits ON
// and pins the one line that matters.
import { describe, it, expect, vi } from "vitest"

const mockReserveCredits = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ usageLogId: "log-1", creditsReserved: 2, watermark: false }),
)

vi.mock("../../lib/config.js", () => ({
  config: {},
  hasCredits: () => true,
}))

vi.mock("../../ee/services/credits.js", () => ({
  CreditsService: { reserveCredits: mockReserveCredits },
}))

// Heavy transitive deps of the worker module — inert stubs.
vi.mock("../../lib/queue.js", () => ({ redis: {} }))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../lib/insert-job.js", () => ({ insertInternalJob: vi.fn() }))
vi.mock("../../services/social/connection-lock.js", () => ({
  acquireConnectionLock: vi.fn(),
  releaseConnectionLock: vi.fn(),
}))

import { reserveScheduledCredits } from "../social-publish-worker.js"
import type { BillingContext } from "../../lib/billing-context.js"

const WS_CTX: BillingContext = {
  payer: "workspace",
  userId: "u-1",
  workspaceId: "ws-1",
  orgId: "org-1",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

describe("reserveScheduledCredits (P14)", () => {
  it("carries the payload's payer onto the reservation options", async () => {
    await reserveScheduledCredits("u-1", "job-1", WS_CTX)
    expect(mockReserveCredits).toHaveBeenCalledWith(
      "u-1",
      "job-1",
      "social-publish",
      0,
      0,
      { billingContext: WS_CTX },
    )
  })
})
