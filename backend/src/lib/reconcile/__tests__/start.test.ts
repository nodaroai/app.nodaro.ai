import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), reconcile: vi.fn(), recover: vi.fn() }))
vi.mock("node-cron", () => ({ default: { schedule: mocks.schedule } }))
vi.mock("../cron.js", () => ({ reconcileInflightJobs: mocks.reconcile }))
vi.mock("../../../ee/billing/managed-job-recovery.js", () => ({ recoverManagedJobSettlements: mocks.recover }))
import { startReconcileCron } from "../start.js"

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe("reconciliation scheduling", () => {
  it("recovers settlement even if provider reconciliation failed", async () => {
    vi.stubEnv("NODE_ENV", "production")
    mocks.reconcile.mockRejectedValueOnce(new Error("provider scan failed"))
    mocks.recover.mockResolvedValue({ scanned: 1, recovered: 1, errors: 0 })
    startReconcileCron()
    const [schedule, tick] = mocks.schedule.mock.calls[0]!
    expect(schedule).toBe("*/5 * * * *")
    await tick()
    expect(mocks.recover).toHaveBeenCalledOnce()
  })
  it("does not schedule local development without explicit enablement", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("ENABLE_CLEANUP_CRON", "false")
    startReconcileCron()
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
})
